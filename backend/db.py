"""Postgres (Render free tier): teacher + parent logins, students, and saved meeting summaries.

Privacy rules (see CLAUDE.md): passwords are never stored in plain text, and we never
store audio or full transcripts, only each meeting's summary and action items.
"""
import hashlib
import hmac
import os
import secrets

import psycopg
from dotenv import load_dotenv
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

load_dotenv()  # so this file also works from scripts/, not just from main.py

CREATE_TABLES = """
CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    role          TEXT NOT NULL CHECK (role IN ('teacher', 'parent')),
    password_hash TEXT NOT NULL,
    salt          TEXT NOT NULL
);

-- Links each student to their teacher and parent, so a saved meeting
-- shows up on both dashboards.
CREATE TABLE IF NOT EXISTS students (
    id         SERIAL PRIMARY KEY,
    name       TEXT NOT NULL,
    teacher_id INTEGER NOT NULL REFERENCES users(id),
    parent_id  INTEGER NOT NULL REFERENCES users(id),
    UNIQUE (name, teacher_id)
);

-- One row per finished meeting: only the summary and action items (no audio, no transcript).
CREATE TABLE IF NOT EXISTS meetings (
    id           SERIAL PRIMARY KEY,
    teacher_id   INTEGER NOT NULL REFERENCES users(id),
    student_id   INTEGER NOT NULL REFERENCES students(id),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    summary_json JSONB NOT NULL
);
"""


def connect():
    """Open a connection. Rows come back as dicts, e.g. row["name"]."""
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise psycopg.OperationalError("DATABASE_URL is not set")
    return psycopg.connect(url, row_factory=dict_row, connect_timeout=10)


def create_tables():
    with connect() as conn:
        conn.execute(CREATE_TABLES)


# ---------- Passwords ----------

def hash_password(password: str, salt: str) -> str:
    """scrypt from Python's standard library: slow on purpose, so stolen hashes are hard to crack."""
    digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=2**14, r=8, p=1, dklen=32)
    return digest.hex()


def check_password(password: str, user: dict) -> bool:
    # compare_digest takes the same time whether the first or last character differs.
    return hmac.compare_digest(hash_password(password, user["salt"]), user["password_hash"])


# ---------- Users ----------

def save_user(email: str, name: str, role: str, password: str) -> int:
    """Create the user, or update name/role/password if the email already exists. Returns the id."""
    salt = secrets.token_hex(16)  # a new random salt every time a password is set
    with connect() as conn:
        row = conn.execute(
            """INSERT INTO users (email, name, role, password_hash, salt)
               VALUES (%s, %s, %s, %s, %s)
               ON CONFLICT (email) DO UPDATE
               SET name = EXCLUDED.name, role = EXCLUDED.role,
                   password_hash = EXCLUDED.password_hash, salt = EXCLUDED.salt
               RETURNING id""",
            (email.lower(), name, role, hash_password(password, salt), salt),
        ).fetchone()
    return row["id"]


def get_user_by_email(email: str) -> dict | None:
    with connect() as conn:
        return conn.execute("SELECT * FROM users WHERE email = %s", (email.strip().lower(),)).fetchone()


def get_user_by_id(user_id: int) -> dict | None:
    with connect() as conn:
        return conn.execute("SELECT * FROM users WHERE id = %s", (user_id,)).fetchone()


# ---------- Students ----------

def save_student(name: str, teacher_id: int, parent_id: int) -> int:
    """Create the student (or update their parent if they already exist). Returns the id."""
    with connect() as conn:
        row = conn.execute(
            """INSERT INTO students (name, teacher_id, parent_id) VALUES (%s, %s, %s)
               ON CONFLICT (name, teacher_id) DO UPDATE SET parent_id = EXCLUDED.parent_id
               RETURNING id""",
            (name, teacher_id, parent_id),
        ).fetchone()
    return row["id"]


def find_student(name: str, teacher_id: int) -> dict | None:
    """Find one of this teacher's students by name (case-insensitive)."""
    with connect() as conn:
        return conn.execute(
            "SELECT * FROM students WHERE lower(name) = lower(%s) AND teacher_id = %s",
            (name.strip(), teacher_id),
        ).fetchone()


# ---------- Meetings ----------

def save_meeting(teacher_id: int, student_id: int, summary: dict) -> dict:
    """summary = {"summary_en", "summary_fr", "action_items"}. Returns {"id", "created_at"}."""
    with connect() as conn:
        return conn.execute(
            """INSERT INTO meetings (teacher_id, student_id, summary_json) VALUES (%s, %s, %s)
               RETURNING id, created_at""",
            (teacher_id, student_id, Jsonb(summary)),
        ).fetchone()


def list_meetings(user: dict) -> list[dict]:
    """Newest first. Teachers see meetings they saved; parents see meetings about their children."""
    # Safe to put in the SQL text: it's one of two fixed strings, never user input.
    column = "m.teacher_id" if user["role"] == "teacher" else "s.parent_id"
    with connect() as conn:
        return conn.execute(
            f"""SELECT m.id, m.created_at, s.name AS student, m.summary_json
                FROM meetings m JOIN students s ON s.id = m.student_id
                WHERE {column} = %s
                ORDER BY m.created_at DESC""",
            (user["id"],),
        ).fetchall()


def set_followup(meeting_id: int, teacher_id: int, followup: dict) -> bool:
    """Attach the message the teacher sent to the parent (from the follow-up agent) to a meeting they saved.

    It lives inside summary_json, so GET /api/meetings returns it with no schema change. Returns False if not found.
    """
    with connect() as conn:
        row = conn.execute(
            """UPDATE meetings SET summary_json = summary_json || jsonb_build_object('followup', %s::jsonb)
               WHERE id = %s AND teacher_id = %s RETURNING id""",
            (Jsonb(followup), meeting_id, teacher_id),
        ).fetchone()
    return row is not None
