import os
import logging
import requests
import numpy as np

logger = logging.getLogger("voicebot.tts")

LANG_TTS_ENDPOINTS = {
    "en": os.getenv("VOICEBOT_TTS_EN_URL", "http://173.234.75.165:7654/tts"),
    "ar": "http://173.234.75.165:7022/tts",
    "ta": "http://173.234.75.165:7023/tts",
    "hi": "http://173.234.75.165:7039/tts",
    "te": "http://173.234.75.165:7026/tts",
    "ml": "http://173.234.75.165:7006/tts",
    "kn": "http://173.234.75.165:7025/tts",
    "zh": "http://173.234.75.165:7654/tts",
    "ms": "http://173.234.75.165:7655/tts",
    "uk": "http://173.234.75.165:7857/tts",
}

def resample_24k_to_16k_chunk(pcm_bytes_24k_960: bytes) -> bytes:
    """
    Resamples exactly 960 bytes (480 samples = 20ms) of 24kHz S16LE PCM
    to exactly 640 bytes (320 samples = 20ms) of 16kHz S16BE PCM.
    """
    arr_24k = np.frombuffer(pcm_bytes_24k_960, dtype='<i2').astype(np.float32)
    n_in = len(arr_24k) # 480
    n_out = 320 # 320 samples for 16kHz 20ms
    x_in = np.arange(n_in)
    x_out = np.linspace(0, n_in - 1, n_out)
    arr_16k = np.interp(x_out, x_in, arr_24k)
    return arr_16k.astype('>i2').tobytes()

class WorktualTTSClient:
    def get_endpoint_and_payload(self, text: str, session_id: str, lang: str) -> tuple[str, dict]:
        lang_lower = (lang or "en").lower()
        endpoint = LANG_TTS_ENDPOINTS.get(lang_lower, LANG_TTS_ENDPOINTS["en"])

        if lang_lower in ("en", "zh", "ms"):
            payload = {"text": text, "session_id": session_id, "lang": lang_lower}
        else:
            payload = {"text": text, "session_id": session_id}

        return endpoint, payload

    def stream_tts_16k(self, text: str, session_id: str, lang: str = "en", stop_check_fn=None):
        """
        Calls Worktual TTS API, yields exact 640-byte 20ms 16kHz slin16 S16BE PCM frames.
        """
        endpoint, payload = self.get_endpoint_and_payload(text, session_id, lang)
        logger.info(f"Requesting TTS stream [{endpoint}] text='{text}' lang={lang} payload={payload}")

        try:
            resp = requests.post(endpoint, json=payload, stream=True, timeout=10)
            resp.raise_for_status()
        except Exception as e:
            logger.error(f"Error streaming TTS from {endpoint}: {e}. Falling back to default English TTS.")
            endpoint = LANG_TTS_ENDPOINTS["en"]
            payload = {"text": text, "session_id": session_id, "lang": "en"}
            try:
                resp = requests.post(endpoint, json=payload, stream=True, timeout=10)
                resp.raise_for_status()
            except Exception as fb_err:
                logger.error(f"Fallback English TTS failed: {fb_err}")
                return

        try:
            buffer_24k = bytearray()
            CHUNK_24K_SIZE = 960 # 480 samples at 24kHz = 20ms

            for chunk in resp.iter_content(chunk_size=4096):
                if stop_check_fn and stop_check_fn():
                    logger.info(f"TTS stream interrupted by stop_check_fn for session {session_id}")
                    break

                if not chunk:
                    continue

                buffer_24k.extend(chunk)

                while len(buffer_24k) >= CHUNK_24K_SIZE:
                    if stop_check_fn and stop_check_fn():
                        break
                    raw_24k = bytes(buffer_24k[:CHUNK_24K_SIZE])
                    buffer_24k = buffer_24k[CHUNK_24K_SIZE:]

                    pcm_16k_640 = resample_24k_to_16k_chunk(raw_24k)
                    yield pcm_16k_640

            # Flush remaining buffer at end of stream
            if len(buffer_24k) > 0 and not (stop_check_fn and stop_check_fn()):
                pad_len = CHUNK_24K_SIZE - len(buffer_24k)
                buffer_24k.extend(b'\x00' * pad_len)
                raw_24k = bytes(buffer_24k[:CHUNK_24K_SIZE])
                pcm_16k_640 = resample_24k_to_16k_chunk(raw_24k)
                yield pcm_16k_640

        except Exception as e:
            logger.error(f"Error reading TTS content stream from {endpoint}: {e}")
