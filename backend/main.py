"""ParentBridge FastAPI app: API routes + serves the frontend as static files."""
import logging
import os
import threading
import time
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

load_dotenv()  # read keys from .env before anything else uses them

from backend.speech import synthesize, transcribe  # noqa: E402
from backend.translate import translate  # noqa: E402

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


@app.get("/api/health")
def health():
    return {"status": "ok"}


# TODO: POST /api/turn     (see API contract in CLAUDE.md)
# TODO: POST /api/summary  (see API contract in CLAUDE.md)


# Serve frontend/ at "/". This must be mounted LAST so it doesn't shadow /api routes.
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")
if os.path.isdir(FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
