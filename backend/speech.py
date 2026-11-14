"""ElevenLabs speech-to-text (Scribe) and text-to-speech (Flash)."""


def transcribe(audio_bytes: bytes, lang: str) -> str:
    """Audio -> text. lang is "fr" or "en" (forced from the button pressed)."""
    raise NotImplementedError


def synthesize(text: str, voice_id: str) -> bytes:
    """Text -> mp3 bytes spoken by voice_id."""
    raise NotImplementedError
