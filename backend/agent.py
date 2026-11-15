"""The follow-up agent: after a meeting, Claude works through tools on its own to close the loop with the parent.

It reads the student's past meetings, decides which commitments are still open or overdue, looks up school terms
the parent may not know, and drafts a message to the parent in French (plus next-meeting questions).
Nothing is sent from here: the teacher reviews the draft and taps Send (POST /api/meetings/{id}/followup).

run_followup() is a generator: it yields one {"type": "step"} per thing the agent did, as it happens, then a
{"type": "result"} (or {"type": "error"}). main.py streams these to the browser as JSON lines.
"""
import json
import logging
from datetime import date
from typing import Literal

from anthropic import beta_tool
from pydantic import BaseModel

from backend import db
from backend.translate import GLOSSARY, SUMMARY_MODEL, client

log = logging.getLogger("uvicorn.error")


class OpenItem(BaseModel):
    owner: str  # "Teacher" | "Parent"
    task_en: str
    task_fr: str
    due: str    # as stated in the meeting, or ""
    status: Literal["open", "overdue"]


class FollowUp(BaseModel):
    open_items: list[OpenItem]
    message_en: str
    message_fr: str
    next_questions_en: list[str]
    next_questions_fr: list[str]


PROMPT = """You are ParentBridge's follow-up assistant. A teacher ({teacher}) just met with a parent ({parent})
about {student}. That meeting was on {meeting_date}; today is {today}.

Work in this order:
1. Call get_past_meetings to read every saved meeting about {student}.
2. Call explain_term for each school term or acronym (like IEP) that the message should explain to the parent.
3. Return:
- open_items: action items from these meetings that are not known to be done. status is "overdue" only if a
  stated due date is before today (read "Friday" etc. against the date of the meeting it was said in);
  otherwise "open". Keep "due" exactly as stated.
- message_fr: a short, warm message from the teacher to the parent, in French with "vous", at most 110 words.
  Thank them, remind them of the parent's open items with their dates, say what the teacher will do (own up
  to the teacher's overdue items), and explain any acronym in plain words. message_en: the same message in English.
- next_questions_en and next_questions_fr: 2 or 3 questions to ask at the next meeting, about these items.

The teacher and the parent are both men. In French write "Monsieur"/"M." and masculine forms (désolé);
in English write "Mr." (never "Mme", "Madame", "Ms." or "Mrs.").

Use only facts from the tool results. Never invent dates, services or owners."""


def run_followup(user: dict, meeting: dict):
    """user = the signed-in teacher; meeting = a row from db.list_meetings(user). Yields steps, then the result."""
    student_name = meeting["student"]
    first_name = student_name.split()[0]
    student = db.find_student(student_name, user["id"])
    parent = db.get_user_by_id(student["parent_id"])
    steps = []  # what the tools did, sent to the browser after each round of tool calls

    @beta_tool
    def get_past_meetings() -> str:
        """Every saved meeting about this student, oldest first: date, summary and action items (owner, task, due)."""
        rows = [m for m in db.list_meetings(user) if m["student"] == student_name][::-1]
        steps.append({"fr": f"{len(rows)} rencontres lues pour {first_name}",
                      "en": f"Read {len(rows)} meetings about {first_name}"})
        return json.dumps([
            {"date": m["created_at"].date().isoformat(), "summary": m["summary_json"]["summary_en"],
             "action_items": m["summary_json"]["action_items"]}
            for m in rows
        ], ensure_ascii=False)

    @beta_tool
    def explain_term(term: str) -> str:
        """Look up an English school term or acronym in the school's English-French glossary.

        Args:
            term: the term as said in the meeting, e.g. "IEP" or "below benchmark".
        """
        match = next((en for en in GLOSSARY if en.lower() == term.strip().lower()), None)
        steps.append({"fr": f"« {term} » vérifié dans le glossaire de l’école",
                      "en": f"Looked up “{term}” in the school glossary"})
        return f"{match} = {GLOSSARY[match]}" if match else "Not in the glossary: explain it in plain words."

    system = PROMPT.format(teacher=user["name"], parent=parent["name"].replace("M. ", "Mr. ", 1), student=student_name,
                           meeting_date=meeting["created_at"].date().isoformat(), today=date.today().isoformat())
    try:
        runner = client.beta.messages.tool_runner(
            model=SUMMARY_MODEL, max_tokens=8000, max_iterations=6,  # max_iterations: a guard against a runaway loop
            system=system, tools=[get_past_meetings, explain_term], output_format=FollowUp,
            messages=[{"role": "user", "content": f"Prepare the follow-up for {student_name}."}],
        )
        result = None
        for message in runner:
            if message.stop_reason == "tool_use":
                runner.generate_tool_call_response()  # run the tools now (cached: the runner reuses the results)
            for step in steps:
                yield {"type": "step", **step}
            steps.clear()
            result = message.parsed_output or result
        if result is None:
            raise RuntimeError("no structured answer")
        overdue = sum(item.status == "overdue" for item in result.open_items)
        yield {"type": "step", "fr": f"{len(result.open_items)} actions encore ouvertes, dont {overdue} en retard",
               "en": f"{len(result.open_items)} action items still open, {overdue} overdue"}
        yield {"type": "step", "fr": f"Message rédigé pour {parent['name']}, en français",
               "en": f"Drafted a message for {parent['name'].replace('M. ', 'Mr. ', 1)}, in French"}
        yield {"type": "result", **result.model_dump()}
    except Exception as e:  # the browser shows this; the details go to the server log
        log.warning(f"Follow-up agent failed: {e!r}")
        yield {"type": "error", "error": "Suivi impossible, réessayez · Follow-up failed, please try again"}
