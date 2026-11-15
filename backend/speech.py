"""ElevenLabs speech-to-text (Scribe) and text-to-speech (Flash)."""
import io
import os

from dotenv import load_dotenv
from elevenlabs.client import ElevenLabs

load_dotenv()  # so this file also works from scripts/, not just from main.py

client = ElevenLabs(api_key=os.environ["ELEVENLABS_API_KEY"])

STT_MODEL = "scribe_v2"          # ElevenLabs Scribe (batch speech-to-text)
TTS_MODEL = "eleven_flash_v2_5"  # ElevenLabs Flash: multilingual, low latency


def transcribe(audio_bytes: bytes, lang: str) -> str:
    """Audio -> text. lang is "fr" or "en" (forced from the button pressed)."""
    result = client.speech_to_text.convert(
        file=io.BytesIO(audio_bytes),
        model_id=STT_MODEL,
        language_code=lang,
        tag_audio_events=False,  # don't add "(laughs)" style tags to the text
    )
    return result.text.strip()


def synthesize(text: str, voice_id: str) -> bytes:
    """Text -> mp3 bytes spoken by voice_id."""
    chunks = client.text_to_speech.convert(
        voice_id=voice_id,
        text=text,
        model_id=TTS_MODEL,
        output_format="mp3_44100_128",
    )
    return b"".join(chunks)  # the SDK returns the audio in pieces
