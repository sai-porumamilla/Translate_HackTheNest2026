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
TEACHER_NAME = "Mr. Tremblay"  # both demo adults are men: "M." in French, "Mr." in English
PARENT_NAME = "M. Martin"
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

# Two earlier meetings about Léo, so the follow-up agent has history to work with (fictional, like everything here).
# Marked "seed": "history" and added only once, so rerunning the script doesn't duplicate them.
HISTORY = [
    (21, {"summary_en": "Léo enjoys reading. The family and the teacher agreed on a weekly reading log.",
          "summary_fr": "Léo aime lire. La famille et l'enseignant ont convenu d'un carnet de lecture hebdomadaire.",
          "action_items": [{"owner": "Parent", "task_en": "Sign Léo's reading log every week",
                            "task_fr": "Signer le carnet de lecture de Léo chaque semaine", "due": ""}]}),
    (7, {"summary_en": "The teacher is concerned about Léo's math: he struggles with multiplication. "
                       "The teacher will send practice sheets; the parent will practise times tables at home.",
         "summary_fr": "L'enseignant s'inquiète des mathématiques de Léo : il a du mal avec la multiplication. "
                       "Il enverra des fiches d'exercices; le parent pratiquera les tables à la maison.",
         "action_items": [{"owner": "Teacher", "task_en": "Send math practice sheets home",
                           "task_fr": "Envoyer des fiches d'exercices de mathématiques à la maison", "due": "November 10"},
                          {"owner": "Parent", "task_en": "Practise times tables with Léo 10 minutes a day",
                           "task_fr": "Pratiquer les tables de multiplication avec Léo 10 minutes par jour", "due": ""}]}),
]
with db.connect() as conn:
    seeded = conn.execute("SELECT count(*) AS n FROM meetings WHERE student_id = %s AND summary_json->>'seed' = 'history'",
                          (student_id,)).fetchone()["n"]
    if not seeded:
        for days_ago, summary in HISTORY:
            conn.execute("""INSERT INTO meetings (teacher_id, student_id, created_at, summary_json)
                            VALUES (%s, %s, now() - make_interval(days => %s), %s)""",
                         (teacher_id, student_id, days_ago, db.Jsonb({**summary, "seed": "history"})))
print("Past meetings for Léo:", "already there" if seeded else f"added {len(HISTORY)}")
