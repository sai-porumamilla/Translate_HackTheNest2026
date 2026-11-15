"""ParentBridge FastAPI app: API routes + serves the frontend as static files."""
import base64
import json
import logging
import os
import secrets
import threading
import time
from contextlib import asynccontextmanager
from datetime import timezone

import psycopg
from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.middleware.sessions import SessionMiddleware

load_dotenv()  # read keys from .env before anything else uses them

from backend import db  # noqa: E402
from backend.speech import synthesize, transcribe  # noqa: E402
from backend.translate import Summary, summarize, translate  # noqa: E402

log = logging.getLogger("uvicorn.error")  # shows up in the uvicorn console


def warm_up():
    """Make one tiny call to each service so the first real turn isn't slow.

    The first request to an API is slower (new connection, DNS, TLS). Doing it here,
    at server start, means the first turn in the demo is as fast as every other one.
    """
    start = time.time()
    try:
        audio = synthesize("Bonjour.", os.environ["VOICE_ID_FR"])  # ElevenLabs text-to-speech
        transcribe(audio, "fr")                                     # ElevenLabs speech-to-text
        translate("Bonjour.", "fr", "en", history=[])               # Claude
        log.info(f"Warm-up done in {time.time() - start:.1f}s")
    except Exception as e:
        log.warning(f"Warm-up failed (the app still works, first turn may be slower): {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Run the warm-up in the background so the server starts accepting requests right away.
    threading.Thread(target=warm_up, daemon=True).start()
    yield


app = FastAPI(title="ParentBridge", lifespan=lifespan)

# Login session: a signed cookie that holds the user's id. Signed = it can't be forged
# without SESSION_SECRET.
SESSION_SECRET = os.environ.get("SESSION_SECRET")
if not SESSION_SECRET:
    SESSION_SECRET = secrets.token_urlsafe(32)
    log.warning("SESSION_SECRET is not set: using a temporary one (everyone is logged out on restart).")
app.add_middleware(
    SessionMiddleware,
    secret_key=SESSION_SECRET,
    same_site="lax",
    https_only=bool(os.environ.get("RENDER")),  # Render sets RENDER=true: cookie only over HTTPS there
)


def error(message: str, status: int) -> JSONResponse:
    """Every error uses the same shape, so the frontend can show it in the captions area."""
    return JSONResponse({"error": message}, status_code=status)


@app.exception_handler(RequestValidationError)
def bad_request(request, exc):
    # A missing or wrong field (e.g. no audio file) gives our error shape, not FastAPI's default.
    return error("Bad request: missing or invalid fields.", 400)


@app.exception_handler(psycopg.Error)
def database_error(request, exc):
    # Any database problem (down, bad DATABASE_URL, ...) gives one clear message instead of a crash.
    log.error(f"Database error: {type(exc).__name__}: {exc}")
    return error("Database error. Please try again.", 500)


@app.get("/api/health")
def health():
    return {"status": "ok"}


# speaker -> (source language, target language, voice the listener hears)
DIRECTIONS = {
    "parent": ("fr", "en", "VOICE_ID_EN"),
    "teacher": ("en", "fr", "VOICE_ID_FR"),
}
MAX_AUDIO_BYTES = 5 * 1024 * 1024  # ~5 MB, far more than a few seconds of speech


# A plain "def" (not "async def"): FastAPI runs it in a worker thread,
# so slow API calls don't block other requests.
@app.post("/api/turn")
def turn(audio: UploadFile = File(...), speaker: str = Form(...), history: str = Form("[]")):
    """One push-to-talk turn: audio -> text -> translation -> speech. See CLAUDE.md for the contract."""
    if speaker not in DIRECTIONS:
        return error('speaker must be "parent" or "teacher".', 400)
    src, tgt, voice_env = DIRECTIONS[speaker]

    try:
        past_turns = json.loads(history)
        if not isinstance(past_turns, list):
            raise ValueError
    except ValueError:
        return error("history must be a JSON list of turns.", 400)

    audio_bytes = audio.file.read()
    if not audio_bytes:
        return error("No audio received.", 400)
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        return error("Recording is too long. Please speak in shorter turns.", 400)

    # Each stage is timed and logged, so a slow stage is easy to spot.
    try:
        start = time.time()
        source_text = transcribe(audio_bytes, src)
        t_stt = time.time() - start
    except Exception as e:
        log.exception(f"Speech-to-text failed: {e}")
        return error("Speech recognition failed. Please try again.", 502)

    if not source_text:
        return error("No speech detected", 400)  # skip translation and TTS: saves time and money

    try:
        start = time.time()
        target_text = translate(source_text, src, tgt, past_turns[-6:])
        t_translate = time.time() - start
    except Exception as e:
        log.exception(f"Translation failed: {e}")
        return error("Translation failed. Please try again.", 502)

    try:
        start = time.time()
        mp3 = synthesize(target_text, os.environ[voice_env])
        t_tts = time.time() - start
    except Exception as e:
        log.exception(f"Text-to-speech failed: {e}")
        return error("Voice playback failed. Please try again.", 502)

    log.info(f"Turn ({speaker} {src}->{tgt}): speech-to-text {t_stt:.1f}s, "
             f"translation {t_translate:.1f}s, text-to-speech {t_tts:.1f}s, "
             f"total {t_stt + t_translate + t_tts:.1f}s")

    return {
        "speaker": speaker,
        "source_lang": src,
        "target_lang": tgt,
        "source_text": source_text,
        "target_text": target_text,
        "audio_b64": base64.b64encode(mp3).decode("ascii"),
    }


class SummaryRequest(BaseModel):
    transcript: list[dict]  # turn objects, without audio_b64


@app.post("/api/summary")
def summary(body: SummaryRequest):
    """End of meeting: bilingual summary + action items. See CLAUDE.md for the contract."""
    if not body.transcript:
        return error("The meeting has no turns yet.", 400)
    try:
        start = time.time()
        result = summarize(body.transcript)
        log.info(f"Summary: {len(body.transcript)} turns, {time.time() - start:.1f}s")
        return result
    except Exception as e:
        log.exception(f"Summary failed: {e}")
        return error("Could not create the summary. Please try again.", 502)


# ---------- Phase 2: login + saved meetings (see the API contract in CLAUDE.md) ----------
# /api/turn and /api/summary above stay open: the meeting works without logging in.

class LoginRequest(BaseModel):
    email: str
    password: str


class MeetingRequest(Summary):  # summary_en, summary_fr, action_items (same as /api/summary) ...
    student: str                # ... plus the student's name, e.g. "Léo Martin"


def logged_in_user(request: Request) -> dict | None:
    """The user from the session cookie, or None if nobody is logged in."""
    user_id = request.session.get("user_id")
    return db.get_user_by_id(user_id) if user_id else None


def iso(dt) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")  # e.g. 2026-11-14T21:30:00Z


@app.post("/api/login")
def login(body: LoginRequest, request: Request):
    user = db.get_user_by_email(body.email)
    if not user or not db.check_password(body.password, user):
        # Same message either way, so nobody can find out which emails exist.
        return error("Wrong email or password", 401)
    request.session.clear()
    request.session["user_id"] = user["id"]
    return {"name": user["name"], "role": user["role"]}


@app.post("/api/logout")
def logout(request: Request):
    request.session.clear()
    return {}


@app.get("/api/me")
def me(request: Request):
    user = logged_in_user(request)
    if not user:
        return error("Not logged in", 401)
    return {"name": user["name"], "role": user["role"]}


@app.post("/api/meetings")
def save_meeting(body: MeetingRequest, request: Request):
    """Teacher saves a finished meeting's summary (never audio or the full transcript)."""
    user = logged_in_user(request)
    if not user:
        return error("Not logged in", 401)
    if user["role"] != "teacher":
        return error("Only teachers can save meetings", 403)
    student = db.find_student(body.student, user["id"])
    if not student:
        return error(f"No student named {body.student} in your class.", 400)
    row = db.save_meeting(user["id"], student["id"], body.model_dump(exclude={"student"}))
    return {"id": row["id"], "created_at": iso(row["created_at"])}


@app.get("/api/meetings")
def list_meetings(request: Request):
    """Newest first. Teachers see the meetings they saved; parents see their child's meetings."""
    user = logged_in_user(request)
    if not user:
        return error("Not logged in", 401)
    return [
        {"id": row["id"], "created_at": iso(row["created_at"]), "student": row["student"],
         **row["summary_json"]}  # adds summary_en, summary_fr, action_items
        for row in db.list_meetings(user)
    ]


# Serve frontend/ at "/". This must be mounted LAST so it doesn't shadow /api routes.
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")
if os.path.isdir(FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
