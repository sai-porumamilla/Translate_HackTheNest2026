# CLAUDE.md — ParentBridge (Hack The Nest 2026)

## What we're building
A live two-way voice interpreter for parent–teacher meetings. Demo pair: French-speaking parent ↔ English-speaking teacher.
Pipeline per turn: push-to-talk recording → ElevenLabs speech-to-text → Claude (Anthropic API) translation (with an education glossary + recent context) → ElevenLabs text-to-speech in the other language → captions in both languages. At the end of the meeting: a bilingual summary with action items.

Team: two people. Sai (frontend: UI, recorder, captions, summary screen, deploy) and Evan (backend, prompts, glossary, French QA). Both must be able to explain all the code to judges, so keep it simple and readable. No clever abstractions.

## Hard deadlines
- **Sat 11:59 PM:** Devpost draft + event app submission (aim to submit by 11:45 PM).
- **Sun 12:00 PM:** final submission. No late entries.
- **Sun 1:15 PM:** live demo, about 2 minutes, science-fair style.
- Devpost needs: a public GitHub repo, a demo video of 3 minutes or less, every teammate added, tracks listed, AI tools used.
- Tracks: AI/ML (OpenAI + Exa), Best Use of ElevenLabs ("the voice is the product"), CS Department.

## Rules you must follow
- **Never commit API keys.** Keys live in `.env` only. `.env` is in `.gitignore` from the very first commit. Commit `.env.example` with key names and no values.
- **Synthetic data only.** Use the fictional student "Léo Martin, Grade 4, Maple Ridge Elementary." No real people, students or schools. The demo teacher account is fictional too.
- **Never store passwords in plain text, and never store audio or full transcripts.** The database holds only meeting summaries and action items.
- All code is written during the event. Don't add large prebuilt templates.

## Scope: MVP only (features 1–6)
1. Two push-to-talk buttons: "Parent speaks (FR)" and "Teacher speaks (EN)". Tap to start recording, tap again to send (changed from hold-to-talk; easier on a tablet). The button decides the language; there is no language detection or speaker diarization.
2. Speech-to-text with ElevenLabs (Scribe), with `language_code` forced from the button.
3. Translation with Claude (Anthropic API), using `glossary.json` plus the last 6 turns as context.
4. Text-to-speech with ElevenLabs Flash (multilingual, low latency). Use one voice for French output and a different voice for English output.
5. Live captions in two columns (EN / FR): speaker, original text, translation.
6. "End meeting" → `/api/summary` → a bilingual summary + an action-item table.

The MVP (1–6) is done and verified end to end.

## Phase 2 (agreed Sat night): teacher login + database + dashboard
Timebox: 2–3 hours. If it isn't working end to end on the live link by then, ship the dashboard with browser storage (`localStorage`) instead, so the demo stays safe.
7. **Login (teacher and parent):** one seeded demo teacher and one seeded demo parent (email + password), plus the student Léo Martin linking them. No sign-up page, no password reset, no SSO.
8. **Database:** Render free Postgres. Store only meeting summaries and action items, never audio or full transcripts.
9. **Dashboards (teacher and parent):** "Hello, {name}", a list of past meetings (newest first), open one to see its bilingual summary and action items. The teacher's dashboard has a "New meeting" button that opens the meeting screen; the parent's dashboard is view-only and shows meetings about their child.
- The meeting itself (`/api/turn`, `/api/summary`) still works without logging in.
- Split: Evan builds the database, endpoints and seed script; Sai builds the login page, dashboard and the save-after-summary call, using mock data until the endpoints are live.

**Out of scope for now. Don't build these unless asked:** video calling (paused), SSO, sign-up and multiple teachers, critical-fact confirmation, Exa rights lookup, voice follow-up, back-translation confidence, jargon coach, voice cloning, React.

## Stack
- Backend: Python 3.11+, FastAPI, uvicorn, python-multipart, python-dotenv, `elevenlabs` SDK, `anthropic` SDK. (Switched from OpenAI on Sat: no sponsor OpenAI credits.)
- Phase 2 adds: `psycopg[binary]` (Postgres driver), and Starlette's `SessionMiddleware` for a signed session cookie (requires `itsdangerous`). Passwords are hashed with the standard library (`hashlib.scrypt` + a random salt); no auth library.
- Frontend: a single `frontend/index.html` with plain JS and inline CSS. Recording uses `MediaRecorder`; the speaking glow uses the Web Audio API.
- FastAPI serves `frontend/` as static files at `/`. One server, one origin, no CORS setup.
- The frontend holds the live transcript in memory and sends history with each request. Postgres stores only finished meeting summaries (Phase 2).
- Deploy: Render (web service; start command `uvicorn backend.main:app --host 0.0.0.0 --port $PORT`).

## Repo layout
```
backend/
  main.py          # FastAPI app, routes, static mount
  speech.py        # transcribe(), synthesize()
  translate.py     # translate(), summarize()
  db.py            # Phase 2: Postgres tables, password hashing, queries
  glossary.json    # EN -> FR education terms
  requirements.txt
frontend/
  index.html
scripts/
  test_roundtrip.py   # CLI: audio file -> STT -> translate -> TTS -> out.mp3
  seed_teacher.py     # Phase 2: creates the tables + demo teacher, demo parent and student from env vars
.env.example
.gitignore
README.md
```

## Environment variables
```
ELEVENLABS_API_KEY=
ANTHROPIC_API_KEY=
EXA_API_KEY=            # not used in the MVP
VOICE_ID_FR=            # voice the parent hears
VOICE_ID_EN=            # voice the teacher hears
TRANSLATE_MODEL=        # optional; defaults to claude-haiku-5-5 (fastest, thinking off)
SUMMARY_MODEL=          # optional; defaults to claude-sonnet-5-5
DATABASE_URL=           # Phase 2: Render Postgres connection string
SESSION_SECRET=         # Phase 2: long random string that signs the session cookie
DEMO_TEACHER_EMAIL=     # Phase 2: used only by scripts/seed_teacher.py
DEMO_TEACHER_PASSWORD=  # Phase 2: used only by scripts/seed_teacher.py; never commit it
DEMO_PARENT_EMAIL=      # Phase 2: used only by scripts/seed_teacher.py
DEMO_PARENT_PASSWORD=   # Phase 2: used only by scripts/seed_teacher.py; never commit it
```
On Render, set these in the dashboard's environment variables, never in the repo.
`DATABASE_URL`: use Render's **External** URL in your local `.env` (for the seed script and local testing) and the **Internal** URL on the Render web service. Both point at the same database.

## API contract (do not change without telling both teammates)

### POST /api/turn (multipart/form-data)
- `audio`: file (webm/opus from MediaRecorder; mp4 fallback)
- `speaker`: `"parent"` | `"teacher"`
- `history`: a JSON string, a list of up to 6 prior turns in the same shape as the response

`parent` → source `fr`, target `en`, voice `VOICE_ID_EN`.
`teacher` → source `en`, target `fr`, voice `VOICE_ID_FR`.

Response 200:
```json
{
  "speaker": "parent",
  "source_lang": "fr",
  "target_lang": "en",
  "source_text": "Est-ce que mon fils a besoin d'un IEP ?",
  "target_text": "Does my son need an IEP?",
  "audio_b64": "<base64 mp3>"
}
```
Errors: return `{"error": "<human-readable message>"}` with a 4xx/5xx status. The frontend shows that message in the captions area.
If the transcription is empty (silence), return 400 `{"error": "No speech detected"}` and skip the translation and TTS calls.

### POST /api/summary (JSON)
Request: `{"transcript": [<turn objects without audio_b64>]}`
Response 200:
```json
{
  "summary_en": "...",
  "summary_fr": "...",
  "action_items": [
    {"owner": "Teacher", "task_en": "...", "task_fr": "...", "due": "March 3"}
  ]
}
```
Use Claude structured outputs (`output_config.format` with a JSON schema). Validate the result with a Pydantic model.

### Phase 2: login and meetings (JSON)
All of these except `POST /api/login` return 401 `{"error": "Not logged in"}` without a valid session cookie. Errors use the same `{"error": "..."}` shape as above.

| Endpoint | Request | Response 200 |
|---|---|---|
| `POST /api/login` | `{"email": "...", "password": "..."}` (email is case-insensitive) | `{"name": "Ms. Tremblay", "role": "teacher"}` (or `"role": "parent"`) and sets the session cookie. Wrong email or password: 401 `{"error": "Wrong email or password"}` |
| `POST /api/logout` | none | `{}` and clears the cookie |
| `GET /api/me` | none | `{"name": "...", "role": "teacher" \| "parent"}`. Use `role` to pick which dashboard to show |
| `POST /api/meetings` | `{"student": "Léo Martin", "summary_en": "...", "summary_fr": "...", "action_items": [...]}` (same shape as the `/api/summary` response, plus `student`) | `{"id": 1, "created_at": "2026-11-14T21:30:00Z"}`. **Teachers only**: a parent gets 403 `{"error": "Only teachers can save meetings"}`. `student` must be one of the teacher's students (case-insensitive), else 400 |
| `GET /api/meetings` | none | `[{"id", "created_at", "student", "summary_en", "summary_fr", "action_items"}]`, newest first. A teacher gets the meetings they saved; a parent gets the meetings about their child |

Tables (see `backend/db.py`): `users (id, email unique, name, role 'teacher'|'parent', password_hash, salt)`, `students (id, name, teacher_id, parent_id)` and `meetings (id, teacher_id, student_id, created_at, summary_json)`. The `students` row is what links a saved meeting to the parent's dashboard. Demo data (from `scripts/seed_teacher.py`): teacher "Ms. Tremblay", parent "Mme Martin", student "Léo Martin".

## Reference code (speech.py)
Confirm the current model IDs in the ElevenLabs docs before relying on these.
```python
from elevenlabs.client import ElevenLabs
import io, os

client = ElevenLabs(api_key=os.environ["ELEVENLABS_API_KEY"])

def transcribe(audio_bytes: bytes, lang: str) -> str:  # "fr" | "en"
    r = client.speech_to_text.convert(
        file=io.BytesIO(audio_bytes), model_id="scribe_v1", language_code=lang)
    return r.text.strip()

def synthesize(text: str, voice_id: str) -> bytes:
    chunks = client.text_to_speech.convert(
        voice_id=voice_id, text=text,
        model_id="eleven_flash_v2_5", output_format="mp3_44100_128")
    return b"".join(chunks)
```

## Translation prompt (translate.py)
```
You are a professional school interpreter in a parent–teacher meeting.
Translate the latest message from {src} to {tgt}.
- Translate faithfully. Do not add, omit, or soften anything.
- Keep names, dates, times and numbers exactly.
- Use this glossary. For acronyms, keep the acronym and add a short
  explanation the first time it appears: {glossary}
- Use a warm, respectful register (vous in French).
Recent conversation for context: {history}
Latest message: {text}
Return only the translation.
```
Current Claude models reject `temperature`, so leave it out; faithfulness comes from the prompt. Only pass glossary entries relevant to the direction; the whole file is small, so passing all of it is fine.

## Summary prompt rules
- Write a summary in English and in French (French uses "vous").
- Only include action items explicitly stated in the transcript. Never invent dates, owners or services.
- `due` is an empty string if no date was stated.

## Glossary seed (backend/glossary.json). Evan verifies and expands to about 20 terms
```json
{
  "IEP": "plan d'éducation individualisé (IEP)",
  "504 plan": "plan 504 (aménagements scolaires pour un élève handicapé)",
  "credits": "unités de valeur (crédits)",
  "below benchmark": "en dessous du niveau attendu",
  "parent-teacher conference": "rencontre parents-enseignant"
}
```

## Frontend requirements (index.html)
- Two large buttons. Tap to start recording, tap again to send. The other button and "End meeting" are disabled while one side records, and both mics stay locked while a request is in flight and until the translated audio finishes playing.
- Recorder: request the mic once on page load. Use `audio/webm;codecs=opus` if `MediaRecorder.isTypeSupported` says yes, otherwise `audio/mp4`. Ignore clips shorter than 0.5 s.
- On response: append the turn to the in-memory `transcript`, render the caption **first**, then play `audio_b64` with `new Audio("data:audio/mpeg;base64,...")`.
- Captions: two columns (English | Français). For each turn, put the original in its language's column and the translation in the other, labeled with the speaker. Auto-scroll to the newest turn.
- A status line: "Recording…", "Translating…", or the error text.
- "End meeting": POST the transcript (without audio) to `/api/summary` → show a summary view with both summaries side by side and an action-item table (Owner | Task EN | Tâche FR | Due).
- Mock mode: if the URL has `?mock=1`, return a fake turn response without calling the backend. This lets the frontend be built before the backend is ready.
- A clean, legible look with large text for a demo table. No framework.
- Phase 2: a login page (bilingual error message), the dashboard, a logout button, and redirect to login when `/api/me` returns 401. After a summary arrives, the meeting is saved with `POST /api/meetings` when a teacher is logged in.

## Backend requirements (Evan)
Done: `/api/turn`, `/api/summary`, startup warm-up, per-stage timing logs, glossary seed.

**Tonight, in this order (ship first, then Phase 2):**
- [ ] **Render deploy.** Evan takes it tonight so Sai can stay on the frontend. New Web Service from `main`. Build: `pip install -r backend/requirements.txt`. Start: `uvicorn backend.main:app --host 0.0.0.0 --port $PORT`. Health check: `/api/health`. Env vars: the 4 keys from `.env` plus `PYTHON_VERSION=3.11.16`, set in Render's dashboard only. Free tier sleeps after 15 min idle (about 1 min to wake), so open the link a few minutes before judging.
- [ ] **iPad and phone test on the HTTPS link.** Safari records `audio/mp4`, which is untested with Scribe. If it fails, fix it in the backend (for example, pass a filename/content type Scribe accepts). This is the riskiest open item.
- [ ] **Summary prompt uses the glossary**, so French terms match the translations (the summary said "plan d'enseignement individualisé" while the glossary says "plan d'éducation individualisé").
- [ ] **Glossary to about 20 terms**, plus French QA on the demo script.
- [ ] **README:** setup, architecture diagram in text, how to run.
- [ ] **Devpost draft by 11:45 PM:** paste the write-up, make the repo public, add both teammates, list tracks and AI tools used.

**Phase 2 (2–3 h timebox):**
- [x] Render free Postgres; tables `users`, `students` and `meetings` as in the API contract.
- [x] `/api/login`, `/api/logout`, `/api/me`, `GET`/`POST /api/meetings`, exactly as in the API contract. Every route except login returns 401 without a session. (Tested locally against the Render database.)
- [x] Passwords: `hashlib.scrypt` with a random salt per user. Session: Starlette `SessionMiddleware` signed with `SESSION_SECRET`.
- [x] `scripts/seed_teacher.py`: creates the tables, the demo teacher and parent, and Léo Martin, from the `DEMO_*` env vars. Safe to rerun.
- [x] Add the new variable names (no values) to `.env.example`. [ ] Set the values in Render (with the deploy).
- [ ] The frontend is already built against this contract (`?mock=1` fakes it). When the endpoints work locally, tell Sai so the two can be tested together.

## Build order and checkpoints
1. Scaffold the repo, `.gitignore`, `.env.example`, a FastAPI hello world, and the static mount. Commit.
2. `scripts/test_roundtrip.py <audio_file> fr` writes `out.mp3` and prints the source text and translation. **This is the riskiest piece; get it working first.**
3. `/api/turn` for the parent direction. Frontend in mock mode, in parallel.
4. **Checkpoint (target 5:30 PM):** speak French in the browser → hear English.
5. Teacher direction, glossary, history context, two-column captions.
6. `/api/summary` + the summary screen. **Checkpoint (target 9:00 PM):** a full demo meeting runs from start to finish.
7. Deploy to Render, test the live link, write the README (setup, architecture diagram in text, how to run).
8. Phase 2, hour 1: endpoints + seed script (Evan) and login page + dashboard against mock data (Sai), in parallel.
9. Phase 2, hour 2: connect them locally and test with the real demo login.
10. Phase 2, hour 3: create the Render Postgres database, set the new env vars, deploy, and test on the live link. **Not working end to end by now → switch to the `localStorage` dashboard.**

## Troubleshooting
- STT rejects webm → try `audio/mp4` from MediaRecorder, or test the endpoint with an `.mp3` file to isolate the problem.
- A round trip over about 4 s → show the caption before the audio loads, keep the prompt short, confirm the Flash TTS model is in use, and log the timing of each stage on the server.
- Never print keys in logs.

## Demo script (fictional)
1. Teacher: "Léo is doing well in reading, but he's below benchmark in math."
2. Parent: « Qu'est-ce que ça veut dire, en dessous du niveau ? Est-ce qu'il a besoin d'aide ? »
3. Teacher: "We'd like to start math support twice a week beginning March 3, and we can discuss an IEP evaluation."
4. Parent: « D'accord. Qu'est-ce que je dois faire de mon côté ? »
5. Teacher: "Please sign the consent form by Friday."
6. End meeting → bilingual summary + action items.

## Working style for Claude Code
- Make small, runnable steps. Run the code after each step and commit with a clear message.
- Before writing code that uses a model ID or SDK method, check the installed SDK version or the docs; the names above may be out of date.
- Ask before adding any dependency not listed in the Stack section.
