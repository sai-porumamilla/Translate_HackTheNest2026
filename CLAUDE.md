# CLAUDE.md — ParentBridge (Hack The Nest 2026)

## What we're building
A live two-way voice interpreter for parent–teacher meetings. Demo pair: French-speaking parent ↔ English-speaking teacher.
Pipeline per turn: push-to-talk recording → ElevenLabs speech-to-text → Claude (Anthropic API) translation (with an education glossary + recent context) → ElevenLabs text-to-speech in the other language → captions in both languages. At the end of the meeting: a bilingual summary with action items.

Team: two people. Sai (frontend: UI, recorder, captions, summary screen, deploy) and Evan (backend, prompts, glossary, French QA). Both must be able to explain all the code to judges, so keep it simple and readable. No clever abstractions.

## Hard deadlines
- ~~**Sat 11:59 PM:** Devpost draft + event app submission~~ (done).
- **Sun 12:00 PM:** final submission on Devpost. No late entries.
- **Sun 1:00 PM:** demo table setup (table number in the event app). **1:15–2:15 PM:** demos and judging, science-fair style in the Student Center Ballroom; judges visit more than once. Show it working live in about 2 minutes, then questions. Judges may ask anyone to walk through any part of the code.
- **Sun 3:00 PM:** closing ceremony and awards.
- Devpost needs: name, short description, the problem it solves, a public GitHub repo, a demo video of 3 minutes or less (MLH requires it), every teammate added, tracks entered (main + partner + MLH), which AI tools were used.

## Tracks (from the Hacker Packet + the Sun update)
- **Future of Intelligence** (main track, AI/ML). **Updated:** no model restrictions anymore (Exa credits fell through), so Claude is fine. Judged on creativity, innovation, technical implementation, real-world impact and meaningful AI integration; **agentic AI and integrations across AI fields are strongly encouraged**. The packet's "skip the clichés": no "chatbot over your notes" or thin wrapper around one API.
- **Best Use of ElevenLabs** (partner): "judged on whether the voice is the product, not a feature bolted on". Our strongest fit.
- **Best Use of SSOJet** (partner, optional): "how naturally sign-in fits your product". Not built; would need SSOJet setup + an OIDC callback.
- **Best Domain Name from GoDaddy Registry** (MLH, optional): register a domain and select it on Devpost.
- AI tools to list on Devpost: Claude (Anthropic API: translation, summaries, and the **follow-up agent** with tool use), ElevenLabs (Scribe speech-to-text, Flash text-to-speech, the parent's spoken follow-up), Claude Code (development).
- Pitch line: speech recognition → translation with memory → voice → structured summary → **an agent that closes the loop with the parent, in their language.**

## Rules you must follow
- **Never commit API keys.** Keys live in `.env` only. `.env` is in `.gitignore` from the very first commit. Commit `.env.example` with key names and no values.
- **Synthetic data only.** Use the fictional student "Léo Martin, Grade 4, Maple Ridge Elementary." No real people, students or schools. The demo teacher account is fictional too.
- **Never store passwords in plain text, and never store audio or full transcripts.** The database holds only meeting summaries, action items, and the follow-up message the teacher chose to send.
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

**Out of scope for now. Don't build these unless asked:** SSO, sign-up and multiple teachers, critical-fact confirmation, Exa rights lookup, back-translation confidence, jargon coach, voice cloning.

## Frontend = React app (`web/`, Sun): this is what's deployed
The plain-JS `frontend/index.html` is retired (it's in git history). The source is `web/`; **`frontend/` is now build output**.
- **Never edit `frontend/` by hand.** Change `web/src/`, then run `cd web && npx vite build`, which rewrites `frontend/` (`index.html` + `assets/`). Commit both. FastAPI and Render serve `frontend/` exactly as before: no backend or Render build change, no Node on Render.
- Pages (HashRouter, so URLs look like `/#/dashboard` and FastAPI can keep serving plain static files): `/login`, `/dashboard`, `/meeting`, `/summary`, `/meetings/:id`. Same API contract as above; `?mock=1` fakes everything (mock password `demo`).
- Roles: a teacher's dashboard has "New meeting" and their saved meetings; a parent's dashboard is a read-only list of their child's meetings. Only a teacher's meeting is saved; guests (no sign-in) and parents never call `POST /api/meetings`.
- **Viewer-first language:** whoever is looking reads their own language first; the other language is a quieter echo after it (smaller, `--grey`). Teacher = English, parent = French, signed out = the browser's language. Use `<Bi fr="…" en="…" />` and `useLang()` from `web/src/lang.jsx`; `<Bi text={error} />` reorders the server's "Français · English" messages. Don't hard-code "FR · EN" labels in pages.
- Design: "Paper & Ink" palette (warm paper, ink text, terracotta = a person talking, deep teal = the interpreter talking; all white text ≥ 4.5:1). The handoff light travels from the speaker's mic to the listener's and lands when the ElevenLabs audio starts. **Face-to-face layout** on portrait phones/tablets (English half rotated 180° for the teacher across the table, French half for the parent).
- Dev: `cd web && npm install && npx vite` → http://localhost:5173. Vite forwards `/api` to uvicorn on :8000, so run the backend too for real turns.

## Stack
- Backend: Python 3.11+, FastAPI, uvicorn, python-multipart, python-dotenv, `elevenlabs` SDK, `anthropic` SDK. (Switched from OpenAI on Sat: no sponsor OpenAI credits.)
- Phase 2 adds: `psycopg[binary]` (Postgres driver), and Starlette's `SessionMiddleware` for a signed session cookie (requires `itsdangerous`). Passwords are hashed with the standard library (`hashlib.scrypt` + a random salt); no auth library.
- Frontend: React 19, React Router 7, Vite 8 in `web/` (dependencies in `web/package.json`; `web/node_modules/` is gitignored). Built into `frontend/`. Recording uses `MediaRecorder`; the speaking glow uses the Web Audio API.
- FastAPI serves `frontend/` as static files at `/`. One server, one origin, no CORS setup.
- The frontend holds the live transcript in memory and sends history with each request. Postgres stores only finished meeting summaries (Phase 2).
- Deploy: Render (web service; start command `uvicorn backend.main:app --host 0.0.0.0 --port $PORT`).

## Repo layout
```
backend/
  main.py          # FastAPI app, routes, static mount
  speech.py        # transcribe(), synthesize()
  translate.py     # translate(), summarize()
  agent.py         # follow-up agent: Claude tool runner (get_past_meetings, explain_term) → FollowUp
  db.py            # Phase 2: Postgres tables, password hashing, queries
  glossary.json    # EN -> FR education terms
  requirements.txt
frontend/             # BUILD OUTPUT of web/ (served by FastAPI/Render); don't edit by hand
  index.html
  assets/
web/                  # React source (Vite)
  src/api.js          # real + mock API (same contract)
  src/audio.js        # Web Audio + speaking glow loop
  src/lang.jsx        # viewer-first language: useLang(), <Bi>, say(), dateFor()
  src/pages/          # Login, Dashboard, Meeting, Summary, PastMeeting
  src/styles.css
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
TURN_URLS=              # video calls, optional: TURN relay URL(s), comma-separated (needed for phones on cellular / strict school Wi-Fi)
TURN_USERNAME=          # video calls, optional
TURN_CREDENTIAL=        # video calls, optional
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

### Error messages (all endpoints)
The frontend shows `error` as-is, so user-facing messages are bilingual in the UI's style, French first: `"Traduction échouée, réessayez · Translation failed, please try again"`. Three strings are fixed and never translated, because the frontend or this contract depends on the exact text: `"No speech detected"` (the frontend matches it), `"Not logged in"` and `"Wrong email or password"` (the frontend checks the 401 status and shows its own bilingual text). Branch on the status code, not on the text, for everything else.

### Phase 2: login and meetings (JSON)
All of these except `POST /api/login` return 401 `{"error": "Not logged in"}` without a valid session cookie. Errors use the same `{"error": "..."}` shape as above.

| Endpoint | Request | Response 200 |
|---|---|---|
| `POST /api/login` | `{"email": "...", "password": "..."}` (email is case-insensitive) | `{"name": "Mr. Tremblay", "role": "teacher"}` (or `"role": "parent"`) and sets the session cookie. Wrong email or password: 401 `{"error": "Wrong email or password"}` |
| `POST /api/logout` | none | `{}` and clears the cookie |
| `GET /api/me` | none | `{"name": "...", "role": "teacher" \| "parent"}`. Use `role` to pick which dashboard to show |
| `POST /api/meetings` | `{"student": "Léo Martin", "summary_en": "...", "summary_fr": "...", "action_items": [...]}` (same shape as the `/api/summary` response, plus `student`) | `{"id": 1, "created_at": "2026-11-14T21:30:00Z"}`. **Teachers only**: a parent gets 403 `{"error": "Seul l'enseignant peut enregistrer une rencontre · Only teachers can save meetings"}`. `student` must be one of the teacher's students (case-insensitive), else 400 |
| `GET /api/meetings` | none | `[{"id", "created_at", "student", "summary_en", "summary_fr", "action_items"}]`, newest first. A teacher gets the meetings they saved; a parent gets the meetings about their child |

Tables (see `backend/db.py`): `users (id, email unique, name, role 'teacher'|'parent', password_hash, salt)`, `students (id, name, teacher_id, parent_id)` and `meetings (id, teacher_id, student_id, created_at, summary_json)`. The `students` row is what links a saved meeting to the parent's dashboard. Demo data (from `scripts/seed_teacher.py`): teacher "Mr. Tremblay", parent "M. Martin" (both men; French shows "M.", English "Mr."), student "Léo Martin".

### Follow-up agent (Sun)
On a saved meeting (`/#/meetings/:id`) the teacher taps "Prepare follow-up". `backend/agent.py` runs Claude (`SUMMARY_MODEL`) with the SDK's tool runner and two read-only tools scoped to that teacher and student: `get_past_meetings` and `explain_term` (the glossary). It returns open/overdue action items, a message to the parent (FR + EN) and next-meeting questions, never sends anything itself. The teacher reviews and taps Send; the parent sees "Nouveau message" on their dashboard and can hear it in French (ElevenLabs, generated on each tap, never stored).

| Endpoint | Request | Response 200 |
|---|---|---|
| `POST /api/meetings/{id}/agent` | none (the teacher who saved it) | `application/x-ndjson` stream, one object per line: `{"type":"step","fr","en"}` as the agent works, then `{"type":"result","open_items":[{owner,task_en,task_fr,due,status:"open"\|"overdue"}],"message_en","message_fr","next_questions_en":[],"next_questions_fr":[]}`, or `{"type":"error","error"}` |
| `POST /api/meetings/{id}/followup` | `{"message_en","message_fr"}` (teacher) | the stored follow-up `{message_en, message_fr, teacher, sent_at}`. It lives in `summary_json.followup`, so `GET /api/meetings` returns it as `followup` |
| `GET /api/meetings/{id}/followup/audio` | none (that teacher or the student's parent) | `audio/mpeg`: `message_fr` read by `VOICE_ID_FR` |

Parent on the agent or followup POST: 403 bilingual. Unknown meeting or no follow-up yet: 404 `"Rencontre introuvable · Meeting not found"`.
Demo history: `scripts/seed_teacher.py` adds two synthetic past meetings for Léo (marked `"seed": "history"`, added once) so the agent has commitments to check.

### Video calls (Sun)
Teacher (signed in) starts a call from the dashboard and sends the link `/#/call/{code}` to the parent (who can be a guest).
The server only does **signaling** (helping two browsers find each other), via a polled mailbox. Video goes peer to peer over
WebRTC, and so does everything else in the call (turns, translated audio, who's talking, end) over a WebRTC data channel.
The call carries **video only**: each person hears only the ElevenLabs translation, never the other's raw voice.
Push-to-talk works as in person: the speaker's device calls `POST /api/turn` (speaker = its role) and sends the turn to the other device, which plays it.
Calls live in memory for 2 hours (one Render instance; a restart ends open calls). No new dependency.

| Endpoint | Request | Response 200 |
|---|---|---|
| `POST /api/calls` | none (teacher session) | `{"code": "8 chars", "ice_servers": [...]}`. Not signed in: 401; parent: 403 bilingual |
| `GET /api/calls/{code}` | none | `{"teacher_name": "...", "ice_servers": [...]}`; unknown/expired: 404 `"Appel introuvable ou terminé · Call not found or ended"` |
| `POST /api/calls/{code}/signal` | `{"role": "teacher"\|"parent", "type": "hello"\|"offer"\|"answer"\|"ice"\|"bye"\|"end", "data": {...}}` | `{"n": 12}`. `role: "teacher"` requires the session of the teacher who created the call (else 401) |
| `GET /api/calls/{code}/signal?role=...&after=N` | none | messages from the *other* side newer than `N`: `[{"n", "from", "type", "data"}]` |

`ice_servers` = Google STUN, plus a TURN relay when `TURN_URLS` is set. Data channel messages (JSON, chunked at 16 KB because Safari caps messages):
`hi`, `floor` (I'm talking; the teacher wins a tie), `free`, `translating`, `turn` (`{turn, audio}`), `playing`, `done`, `end`.

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
