"""Create the tables and the fictional demo accounts in the database from DATABASE_URL.

Usage:  python scripts/seed_teacher.py

Safe to run again: it updates the existing demo accounts instead of duplicating them
(handy after changing a demo password in .env). It never deletes meetings.
"""
import os
import sys

# Let this script import the backend/ package from the repo root.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend import db  # noqa: E402

# Fictional people only (synthetic-data rule in CLAUDE.md).
TEACHER_NAME = "Ms. Tremblay"
PARENT_NAME = "Mme Martin"
STUDENT_NAME = "Léo Martin"

db.create_tables()
print("Tables ready: users, students, meetings")

teacher_id = db.save_user(os.environ["DEMO_TEACHER_EMAIL"], TEACHER_NAME, "teacher",
                          os.environ["DEMO_TEACHER_PASSWORD"])
print(f"Teacher: {TEACHER_NAME} <{os.environ['DEMO_TEACHER_EMAIL']}> (id {teacher_id})")

parent_id = db.save_user(os.environ["DEMO_PARENT_EMAIL"], PARENT_NAME, "parent",
                         os.environ["DEMO_PARENT_PASSWORD"])
print(f"Parent:  {PARENT_NAME} <{os.environ['DEMO_PARENT_EMAIL']}> (id {parent_id})")

student_id = db.save_student(STUDENT_NAME, teacher_id, parent_id)
print(f"Student: {STUDENT_NAME} (id {student_id}), teacher {teacher_id}, parent {parent_id}")
