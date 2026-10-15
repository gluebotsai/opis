"""
Control path for live PCM: gain → high-pass → DTLN → Silero VAD.
STT uses raw PCM elsewhere; this module only emits speech boundary events.
"""

from __future__ import annotations

import logging
from enum import Enum
from pathlib import Path
from typing import Literal

import numpy as np

from app.config import ROOT_DIR, settings
from app.services.live_pcm_dtln import StreamingDtln
from app.services.live_pcm_audio_utils import apply_gain_bytes, rms_energy

log = logging.getLogger(__name__)

VadEvent = Literal["speech_start", "speech_end"]

SILERO_WINDOW = 512


class VadMode(str, Enum):
    SILERO = "silero"
    ENERGY = "energy"


class LivePcmVadChain:
    def __init__(
        self,
        *,
        gain: float | None = None,
        energy_threshold: float | None = None,
        hp_alpha: float = 0.90,
    ) -> None:
        self.gain = gain if gain is not None else settings.live_pcm_gain
        self.energy_threshold = (
            energy_threshold
            if energy_threshold is not None
            else settings.live_pcm_energy_threshold
        )
        self._hp_alpha = hp_alpha
        self._hp_x_prev = 0.0
        self._hp_y_prev = 0.0
        self._mode = VadMode(settings.live_pcm_vad_mode.lower())
        self._dtln: StreamingDtln | None = None
        self._vad_iterator = None
        self._silero_buffer = np.array([], dtype=np.float32)
        self._energy_speeching = False
        self._energy_silence_chunks = 0
        self._energy_silence_chunks_limit = max(
            1, int(settings.live_pcm_silence_ms / settings.live_pcm_chunk_ms)
        )
        self._init_backends()

    def _default_dtln_dir(self) -> Path:
        configured = (settings.live_pcm_dtln_model_dir or "").strip()
        if configured:
            return Path(configured)
        return ROOT_DIR / "models" / "dtln"

    def _init_backends(self) -> None:
        if self._mode == VadMode.SILERO:
            if settings.live_pcm_dtln_enabled:
                try:
                    self._dtln = StreamingDtln(self._default_dtln_dir())
                except Exception as exc:
                    log.warning(
                        "live_pcm_dtln_unavailable",
                        extra={"error": str(exc)[:300], "vad": "passthrough"},
                    )
                    self._dtln = None
            try:
                from silero_vad import VADIterator, load_silero_vad

                model = load_silero_vad(onnx=True)
                self._vad_iterator = VADIterator(
                    model,
                    threshold=settings.live_pcm_silero_threshold,
                    sampling_rate=16000,
                    min_silence_duration_ms=settings.live_pcm_silero_min_silence_ms,
                    speech_pad_ms=settings.live_pcm_silero_speech_pad_ms,
                )
                log.info(
                    "live_pcm_vad_chain_ready",
                    extra={
                        "mode": "silero",
                        "dtln": bool(self._dtln),
                        "dtln_dir": str(self._default_dtln_dir()),
                    },
                )
            except Exception as exc:
                log.warning(
                    "live_pcm_vad_silero_unavailable",
                    extra={"error": str(exc)[:300], "fallback": "energy"},
                )
                self._mode = VadMode.ENERGY
                self._dtln = None
                self._vad_iterator = None
        if self._mode == VadMode.ENERGY:
            log.info("live_pcm_vad_chain_ready", extra={"mode": "energy", "dtln": False})

    def apply_highpass_bytes(self, audio_bytes: bytes) -> bytes:
        samples = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32)
        out = np.empty_like(samples)
        x_prev = self._hp_x_prev
        y_prev = self._hp_y_prev
        alpha = self._hp_alpha
        for i, x in enumerate(samples):
            y = alpha * (y_prev + x - x_prev)
            out[i] = y
            x_prev = x
            y_prev = y
        self._hp_x_prev = x_prev
        self._hp_y_prev = y_prev
        out = np.clip(out, -32768, 32767).astype(np.int16)
        return out.tobytes()

    def _denoise_for_vad(self, gained_hp: bytes) -> np.ndarray:
        samples = np.frombuffer(gained_hp, dtype=np.int16).astype(np.float32) / 32768.0
        if self._dtln is None:
            return samples
        return self._dtln.feed_normalized(samples)

    def _silero_events(self, cleaned: np.ndarray) -> list[VadEvent]:
        if self._vad_iterator is None:
            return []
        import torch

        events: list[VadEvent] = []
        self._silero_buffer = np.concatenate([self._silero_buffer, cleaned.astype(np.float32)])
        while self._silero_buffer.size >= SILERO_WINDOW:
            block = self._silero_buffer[:SILERO_WINDOW]
            self._silero_buffer = self._silero_buffer[SILERO_WINDOW:]
            speech_dict = self._vad_iterator(
                torch.from_numpy(block),
                return_seconds=False,
            )
            if not speech_dict:
                continue
            if "start" in speech_dict:
                events.append("speech_start")
            if "end" in speech_dict:
                events.append("speech_end")
        return events

    def _energy_events(self, gained_hp: bytes) -> list[VadEvent]:
        events: list[VadEvent] = []
        energy = rms_energy(gained_hp)
        if energy > self.energy_threshold:
            if not self._energy_speeching:
                self._energy_speeching = True
                self._energy_silence_chunks = 0
                events.append("speech_start")
        elif self._energy_speeching:
            self._energy_silence_chunks += 1
            if self._energy_silence_chunks > self._energy_silence_chunks_limit:
                self._energy_speeching = False
                self._energy_silence_chunks = 0
                events.append("speech_end")
        return events

    def feed_raw(self, raw_chunk: bytes) -> list[VadEvent]:
        """Run gain → HP → DTLN → Silero on raw 16-bit PCM; return boundary events."""
        if not raw_chunk:
            return []
        gained = apply_gain_bytes(raw_chunk, self.gain)
        gained_hp = self.apply_highpass_bytes(gained)
        if self._mode == VadMode.SILERO and self._vad_iterator is not None:
            cleaned = self._denoise_for_vad(gained_hp)
            return self._silero_events(cleaned)
        return self._energy_events(gained_hp)

    def reset(self) -> None:
        self._silero_buffer = np.array([], dtype=np.float32)
        self._energy_speeching = False
        self._energy_silence_chunks = 0
        if self._vad_iterator is not None:
            self._vad_iterator.reset_states()
