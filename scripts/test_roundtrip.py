"""Test the whole pipeline from the command line, without the browser.

Usage:  python scripts/test_roundtrip.py <audio_file> <fr|en>
Example: python scripts/test_roundtrip.py scripts/sample_fr.m4a fr

audio -> ElevenLabs speech-to-text -> Claude translation -> ElevenLabs speech -> out.mp3
"""
import os
import sys
import time

# Let this script import the backend/ package from the repo root.
REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, REPO_ROOT)

from backend.speech import synthesize, transcribe  # noqa: E402
from backend.translate import translate  # noqa: E402

if len(sys.argv) != 3 or sys.argv[2] not in ("fr", "en"):
    print(__doc__)
    sys.exit(1)

audio_path, src = sys.argv[1], sys.argv[2]
tgt = "en" if src == "fr" else "fr"
voice_id = os.environ["VOICE_ID_EN"] if tgt == "en" else os.environ["VOICE_ID_FR"]

with open(audio_path, "rb") as f:
    audio_bytes = f.read()

start = time.time()
source_text = transcribe(audio_bytes, src)
t_stt = time.time() - start
print(f"[speech-to-text {t_stt:.1f}s] ({src}) {source_text}")
if not source_text:
    print("No speech detected.")
    sys.exit(1)

start = time.time()
target_text = translate(source_text, src, tgt, history=[])
t_translate = time.time() - start
print(f"[translation    {t_translate:.1f}s] ({tgt}) {target_text}")

start = time.time()
mp3 = synthesize(target_text, voice_id)
t_tts = time.time() - start
out_path = os.path.join(REPO_ROOT, "out.mp3")
with open(out_path, "wb") as f:
    f.write(mp3)
print(f"[text-to-speech {t_tts:.1f}s] wrote {out_path} ({len(mp3) // 1024} KB)")

print(f"Total: {t_stt + t_translate + t_tts:.1f}s")
