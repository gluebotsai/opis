import os
import logging
import numpy as np
import torch

logger = logging.getLogger("voicebot.vad")

class SileroVADDetector:
    def __init__(self, sample_rate: int = 16000, threshold: float = 0.35, min_silence_ms: int = 770, speech_pad_ms: int = 600):
        self.sample_rate = sample_rate
        self.threshold = threshold
        self.min_silence_ms = min_silence_ms
        self.speech_pad_ms = speech_pad_ms

        logger.info("Loading Silero VAD model...")
        try:
            self.model, utils = torch.hub.load(
                repo_or_dir='snakers4/silero-vad',
                model='silero_vad',
                force_reload=False,
                trust_repo=True
            )
            self.model.eval()
            self.get_speech_timestamps = utils[0]
            logger.info("Silero VAD model loaded successfully.")
        except Exception as e:
            logger.error(f"Failed to load Silero VAD via torch.hub: {e}. Falling back to energy VAD.")
            self.model = None

        self.reset()

    def reset(self):
        self.triggered = False
        self.speech_samples = 0
        self.silence_samples = 0
        self.speech_buffer = bytearray()
        self.pcm_accum_buffer = bytearray()
        if self.model is not None and hasattr(self.model, 'reset_states'):
            self.model.reset_states()

    def pcm_to_float32(self, pcm_bytes: bytes) -> np.ndarray:
        audio_int16 = np.frombuffer(pcm_bytes, dtype='>i2')
        return audio_int16.astype(np.float32) / 32768.0

    def process_chunk(self, pcm_bytes: bytes) -> tuple[bool, bool, bytes | None]:
        """
        Processes incoming 16kHz S16LE PCM audio.
        Buffers audio into 512-sample chunks (1024 bytes) for Silero VAD requirements.
        Returns (is_speech_active, speech_ended, completed_audio_bytes)
        """
        if not pcm_bytes:
            return False, False, None

        self.pcm_accum_buffer.extend(pcm_bytes)

        # 512 samples at 16kHz = 1024 bytes (32ms)
        CHUNK_BYTES = 1024
        CHUNK_SAMPLES = 512

        speech_ended = False
        completed_audio = None
        is_speech_active = self.triggered

        while len(self.pcm_accum_buffer) >= CHUNK_BYTES:
            chunk = bytes(self.pcm_accum_buffer[:CHUNK_BYTES])
            self.pcm_accum_buffer = self.pcm_accum_buffer[CHUNK_BYTES:]

            audio_float = self.pcm_to_float32(chunk)

            # Fallback energy-based VAD if PyTorch model failed to load
            if self.model is None:
                energy = float(np.sqrt(np.mean(audio_float**2))) if len(audio_float) > 0 else 0.0
                is_speech = energy > 0.02
            else:
                try:
                    with torch.no_grad():
                        tensor = torch.from_numpy(audio_float)
                        speech_prob = self.model(tensor, self.sample_rate).item()
                    is_speech = speech_prob >= self.threshold
                except Exception as e:
                    logger.error(f"Error evaluating Silero VAD: {e}")
                    is_speech = False

            if is_speech:
                self.silence_samples = 0
                if not self.triggered:
                    self.triggered = True
                    logger.debug("VAD: Speech started")
                self.speech_buffer.extend(chunk)
                is_speech_active = True
            else:
                if self.triggered:
                    self.silence_samples += CHUNK_SAMPLES
                    self.speech_buffer.extend(chunk)
                    is_speech_active = True
                    min_silence_samples = int(self.sample_rate * (self.min_silence_ms / 1000.0))

                    if self.silence_samples >= min_silence_samples:
                        logger.info(f"VAD: Speech ended (buffered {len(self.speech_buffer)} bytes)")
                        completed_audio = bytes(self.speech_buffer)
                        self.reset()
                        speech_ended = True
                        is_speech_active = False
                        break

        return is_speech_active, speech_ended, completed_audio
