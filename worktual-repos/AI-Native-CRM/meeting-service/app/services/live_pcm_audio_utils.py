"""Shared PCM helpers for live capture (gain, energy)."""

from __future__ import annotations

import numpy as np


def rms_energy(chunk: bytes) -> float:
    if not chunk:
        return 0.0
    audio = np.frombuffer(chunk, dtype=np.int16).astype(np.float32)
    return float(np.sqrt(np.mean(audio**2)))


def apply_gain_bytes(audio_bytes: bytes, multiplier: float) -> bytes:
    samples = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32)
    amplified = np.clip(samples * multiplier, -32768, 32767).astype(np.int16)
    return amplified.tobytes()


def normalize_peak_bytes(
    audio_bytes: bytes,
    *,
    target_peak: float,
    max_gain: float,
) -> bytes:
    """Peak-normalize 16-bit PCM up toward `target_peak` (0-1 scale), capped at
    `max_gain`. No-op on silence/empty audio and never attenuates (gain >= 1).

    Whisper transcribes on quiet WebRTC-mirrored audio noticeably worse than
    on a normal mic level; this brings the STT input up near a normal speech
    level without touching the VAD's own gain or the raw-PCM energy filter,
    which are calibrated against the ORIGINAL (unamplified) buffer.
    """
    if not audio_bytes:
        return audio_bytes
    samples = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32)
    peak = float(np.max(np.abs(samples))) if samples.size else 0.0
    if peak <= 1.0:
        return audio_bytes
    target = max(0.0, min(1.0, target_peak)) * 32767.0
    gain = target / peak
    if gain <= 1.0:
        return audio_bytes
    gain = min(gain, max(1.0, max_gain))
    amplified = np.clip(samples * gain, -32768, 32767).astype(np.int16)
    return amplified.tobytes()
