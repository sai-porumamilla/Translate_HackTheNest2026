"""ParentBridge FastAPI app: API routes + serves the frontend as static files."""
import base64
import json
import logging
import os
import threading
import time
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

load_dotenv()  # read keys from .env before anything else uses them

from backend.speech import synthesize, transcribe  # noqa: E402
from backend.translate import summarize, translate  # noqa: E402

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


def error(message: str, status: int) -> JSONResponse:
    """Every error uses the same shape, so the frontend can show it in the captions area."""
    return JSONResponse({"error": message}, status_code=status)


@app.exception_handler(RequestValidationError)
def bad_request(request, exc):
    # A missing or wrong field (e.g. no audio file) gives our error shape, not FastAPI's default.
    return error("Bad request: missing or invalid fields.", 400)


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


# Serve frontend/ at "/". This must be mounted LAST so it doesn't shadow /api routes.
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")
if os.path.isdir(FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
