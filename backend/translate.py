"""Claude (Anthropic API) translation with glossary + recent context, and the end-of-meeting summary."""
import json
import os

import anthropic
from dotenv import load_dotenv
from pydantic import BaseModel

load_dotenv()  # so this file also works from scripts/, not just from main.py

client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY from the environment
# Translations use the fastest model; the end-of-meeting summary uses a stronger one.
TRANSLATE_MODEL = os.environ.get("TRANSLATE_MODEL") or "claude-haiku-5-5"
SUMMARY_MODEL = os.environ.get("SUMMARY_MODEL") or "claude-sonnet-5-5"

# Models that support the API's automatic fallback when they decline a message.
FALLBACK_MODELS = ("claude-sonnet-5-5", "claude-opus-5-5")

LANG_NAMES = {"fr": "French", "en": "English"}

GLOSSARY_PATH = os.path.join(os.path.dirname(__file__), "glossary.json")
with open(GLOSSARY_PATH, encoding="utf-8") as f:
    GLOSSARY = json.load(f)  # {"English term": "French term"}


def thinking_off(model: str) -> dict:
    """The setting that turns thinking off; each model family spells it differently."""
    if model == "claude-sonnet-5-5":
        return {"type": "between_tools"}
    return {"type": "disabled"}  # Haiku 5.5 (Opus 5.5 can't turn thinking off)


def ask_claude(system: str, user: str, model: str, effort: str,
               think: bool = True, output_format: dict | None = None) -> str:
    """Send one request to Claude and return the text of its answer."""
    extra = {"output_config": {"effort": effort}}
    if output_format:
        extra["output_config"]["format"] = output_format
    if not think:
        extra["thinking"] = thinking_off(model)  # skip reasoning = faster answer
    if model in FALLBACK_MODELS:
        # If the model declines a message, the API retries it on another model automatically.
        extra["betas"] = ["server-side-fallback-2026-07-01"]
        extra["fallbacks"] = "default"
    response = client.beta.messages.create(
        model=model,
        max_tokens=8000,
        system=system,
        messages=[{"role": "user", "content": user}],
        **extra,
    )
    if response.stop_reason == "refusal":
        raise RuntimeError("The translator could not process this message.")
    # The answer is in the "text" blocks (thinking blocks are skipped).
    return "".join(block.text for block in response.content if block.type == "text").strip()


# ---------- Translation ----------

TRANSLATE_PROMPT = """You are a professional school interpreter in a parent–teacher meeting.
Translate the latest message from {src} to {tgt}.
- Translate faithfully. Do not add, omit, or soften anything.
- Keep names, dates, times and numbers exactly.
- Use this glossary (English = French). For acronyms, keep the acronym and add a short
  explanation the first time it appears:
{glossary}
- Use a warm, respectful register (vous in French).
Return only the translation."""


def format_history(history: list[dict]) -> str:
    """Turn the last 6 turns into plain lines like 'Teacher: ... (translated: ...)'."""
    lines = []
    for turn in history[-6:]:
        speaker = turn.get("speaker", "").capitalize()
        lines.append(f"{speaker}: {turn.get('source_text', '')} (translated: {turn.get('target_text', '')})")
    return "\n".join(lines) or "(this is the first message)"


def translate(text: str, src: str, tgt: str, history: list[dict]) -> str:
    """Translate one message from src to tgt ("fr"/"en") using the glossary and last 6 turns."""
    glossary = "\n".join(f"  {en} = {fr}" for en, fr in GLOSSARY.items())
    system = TRANSLATE_PROMPT.format(src=LANG_NAMES[src], tgt=LANG_NAMES[tgt], glossary=glossary)
    user = f"Recent conversation for context:\n{format_history(history)}\n\nLatest message:\n{text}"
    # One sentence needs no reasoning: fastest model, low effort, thinking off.
    return ask_claude(system, user, TRANSLATE_MODEL, effort="low", think=False)


# ---------- Summary ----------

class ActionItem(BaseModel):
    owner: str
    task_en: str
    task_fr: str
    due: str


class Summary(BaseModel):
    summary_en: str
    summary_fr: str
    action_items: list[ActionItem]


# JSON schema Claude's answer must follow (same fields as the Pydantic models above).
SUMMARY_SCHEMA = {
    "type": "json_schema",
    "schema": {
        "type": "object",
        "properties": {
            "summary_en": {"type": "string"},
            "summary_fr": {"type": "string"},
            "action_items": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "owner": {"type": "string"},
                        "task_en": {"type": "string"},
                        "task_fr": {"type": "string"},
                        "due": {"type": "string"},
                    },
                    "required": ["owner", "task_en", "task_fr", "due"],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["summary_en", "summary_fr", "action_items"],
        "additionalProperties": False,
    },
}

SUMMARY_PROMPT = """You summarize a parent–teacher meeting that was interpreted between French and English.
- Write a short summary in English (summary_en) and the same summary in French (summary_fr). French uses "vous".
- List action items. Only include action items explicitly stated in the transcript.
  Never invent dates, owners or services.
- owner is "Teacher" or "Parent". task_en and task_fr describe the same task in each language.
- due is the date exactly as stated, or an empty string if no date was stated."""


def summarize(transcript: list[dict]) -> dict:
    """Return {"summary_en", "summary_fr", "action_items": [...]} for the whole meeting."""
    lines = []
    for turn in transcript:
        speaker = turn.get("speaker", "").capitalize()
        lines.append(f"{speaker} ({turn.get('source_lang')}): {turn.get('source_text', '')}")
        lines.append(f"  -> ({turn.get('target_lang')}): {turn.get('target_text', '')}")
    answer = ask_claude(SUMMARY_PROMPT, "Transcript:\n" + "\n".join(lines), SUMMARY_MODEL,
                        effort="medium", output_format=SUMMARY_SCHEMA)
    return Summary.model_validate_json(answer).model_dump()  # raises if the shape is wrong
