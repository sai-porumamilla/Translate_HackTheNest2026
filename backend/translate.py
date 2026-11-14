"""OpenAI translation (with glossary + recent context) and end-of-meeting summary."""


def translate(text: str, src: str, tgt: str, history: list[dict]) -> str:
    """Translate one message from src to tgt ("fr"/"en") using the glossary and last 6 turns."""
    raise NotImplementedError


def summarize(transcript: list[dict]) -> dict:
    """Return {"summary_en", "summary_fr", "action_items": [...]} for the whole meeting."""
    raise NotImplementedError
