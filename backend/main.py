"""ParentBridge FastAPI app: API routes + serves the frontend as static files."""
import os

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

load_dotenv()  # read keys from .env before anything else uses them

app = FastAPI(title="ParentBridge")


@app.get("/api/health")
def health():
    return {"status": "ok"}


# TODO: POST /api/turn     (see API contract in CLAUDE.md)
# TODO: POST /api/summary  (see API contract in CLAUDE.md)


# Serve frontend/ at "/". This must be mounted LAST so it doesn't shadow /api routes.
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), "..", "frontend")
if os.path.isdir(FRONTEND_DIR):
    app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
