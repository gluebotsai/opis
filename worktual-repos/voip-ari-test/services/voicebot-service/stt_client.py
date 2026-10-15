import io
import wave
import logging
import os
import re
import unicodedata
import numpy as np
from openai import OpenAI

logger = logging.getLogger("voicebot.stt")

def normalize_text(s: str) -> str:
    if not s:
        return ""
    s = re.sub(r"[^\w\s]", "", unicodedata.normalize("NFKC", s.lower().strip()))
    return s

def clean_text(text: str) -> str:
    if not text:
        return "NOTEXT"
    text = text.strip().lower()
    words = text.split()
    if not words:
        return "NOTEXT"

    for word in words:
        if re.search(r"(.)\1{5,}", word):
            return "NOTEXT"

    if len(words) > 0 and all(len(word) > 1 and len(set(word)) == 1 for word in words):
        return "NOTEXT"

    cleaned = []
    count = 1
    for i, word in enumerate(words):
        if i > 0 and words[i] == words[i-1]:
            count += 1
        else:
            count = 1
        if len(word) < 2 or count <= 3:
            cleaned.append(word)

    res = " ".join(cleaned).strip()
    return res if res else "NOTEXT"

class WorktualSTTClient:
    def __init__(self, base_url: str = None, model: str = None, api_key: str = "EMPTY"):
        self.base_url = base_url or os.getenv("VOICEBOT_STT_BASE_URL", "http://173.234.75.165:7789/v1")
        self.model = model or os.getenv("VOICEBOT_STT_MODEL", "worktual-large-v3")
        self.api_key = api_key
        logger.info(f"Initializing Worktual STT client endpoint={self.base_url} model={self.model}")
        self.client = OpenAI(api_key=self.api_key, base_url=self.base_url)

    def pcm_to_wav_bytes(self, pcm_bytes: bytes, sample_rate: int = 16000, channels: int = 1, sample_width: int = 2) -> io.BytesIO:
        wav_io = io.BytesIO()
        # Convert big-endian RTP PCM samples to little-endian WAV samples for RIFF WAV header
        arr_int16 = np.frombuffer(pcm_bytes, dtype='>i2').astype('<i2')
        le_pcm = arr_int16.tobytes()
        with wave.open(wav_io, 'wb') as wf:
            wf.setnchannels(channels)
            wf.setsampwidth(sample_width)
            wf.setframerate(sample_rate)
            wf.writeframes(le_pcm)
        wav_io.name = "speech.wav"
        wav_io.seek(0)
        return wav_io

    def transcribe(self, pcm_bytes: bytes, caller_num: str = "", ccaas_num: str = "") -> dict:
        if not pcm_bytes or len(pcm_bytes) < 3200: # Less than 100ms
            logger.debug("Audio clip too short for STT")
            return {"text": "NOTEXT", "lang": "en"}

        try:
            wav_file = self.pcm_to_wav_bytes(pcm_bytes)
            logger.info(f"Sending audio clip ({len(pcm_bytes)} bytes) to STT endpoint {self.base_url}")

            response = self.client.audio.translations.create(
                file=wav_file,
                model=self.model,
                response_format="json",
                temperature=0.0,
                extra_body={"language": "en"}
            )

            raw_text = getattr(response, "text", "") or ""
            logger.info(f"Raw STT response: '{raw_text}'")

            cleaned = clean_text(raw_text)
            logger.info(f"Cleaned STT response: '{cleaned}'")
            return {"text": cleaned, "lang": "en"}

        except Exception as e:
            logger.error(f"Error calling STT API ({self.base_url}): {e}")
            return {"text": "NOTEXT", "lang": "en"}
