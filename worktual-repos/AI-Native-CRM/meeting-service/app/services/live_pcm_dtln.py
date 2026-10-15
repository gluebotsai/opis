"""Streaming DTLN denoise (breizhn ONNX, 512 / 128 overlap-add @ 16 kHz)."""

from __future__ import annotations

import logging
from pathlib import Path

import numpy as np

log = logging.getLogger(__name__)

BLOCK_LEN = 512
BLOCK_SHIFT = 128


class StreamingDtln:
    def __init__(self, model_dir: Path) -> None:
        import onnxruntime

        model_1 = model_dir / "model_1.onnx"
        model_2 = model_dir / "model_2.onnx"
        if not model_1.is_file() or not model_2.is_file():
            raise FileNotFoundError(
                f"DTLN ONNX models missing under {model_dir} (need model_1.onnx, model_2.onnx)"
            )
        self._session_1 = onnxruntime.InferenceSession(
            str(model_1), providers=["CPUExecutionProvider"]
        )
        self._session_2 = onnxruntime.InferenceSession(
            str(model_2), providers=["CPUExecutionProvider"]
        )
        names_1 = [inp.name for inp in self._session_1.get_inputs()]
        names_2 = [inp.name for inp in self._session_2.get_inputs()]
        self._inputs_1 = {
            inp.name: np.zeros(
                [dim if isinstance(dim, int) else 1 for dim in inp.shape],
                dtype=np.float32,
            )
            for inp in self._session_1.get_inputs()
        }
        self._inputs_2 = {
            inp.name: np.zeros(
                [dim if isinstance(dim, int) else 1 for dim in inp.shape],
                dtype=np.float32,
            )
            for inp in self._session_2.get_inputs()
        }
        self._names_1 = names_1
        self._names_2 = names_2
        self._in_buffer = np.zeros(BLOCK_LEN, dtype=np.float32)
        self._out_buffer = np.zeros(BLOCK_LEN, dtype=np.float32)
        self._pending = np.array([], dtype=np.float32)

    def _process_shift(self) -> np.ndarray:
        in_block_fft = np.fft.rfft(self._in_buffer)
        in_mag = np.abs(in_block_fft)
        in_phase = np.angle(in_block_fft)
        in_mag = np.reshape(in_mag, (1, 1, -1)).astype(np.float32)
        self._inputs_1[self._names_1[0]] = in_mag
        out_1 = self._session_1.run(None, self._inputs_1)
        out_mask = out_1[0]
        self._inputs_1[self._names_1[1]] = out_1[1]
        estimated_complex = in_mag * out_mask * np.exp(1j * in_phase)
        estimated_block = np.fft.irfft(estimated_complex)
        estimated_block = np.reshape(estimated_block, (1, 1, -1)).astype(np.float32)
        self._inputs_2[self._names_2[0]] = estimated_block
        out_2 = self._session_2.run(None, self._inputs_2)
        out_block = out_2[0]
        self._inputs_2[self._names_2[1]] = out_2[1]
        self._out_buffer[:-BLOCK_SHIFT] = self._out_buffer[BLOCK_SHIFT:]
        self._out_buffer[-BLOCK_SHIFT:] = 0.0
        self._out_buffer += np.squeeze(out_block)
        return self._out_buffer[:BLOCK_SHIFT].copy()

    def feed_normalized(self, samples: np.ndarray) -> np.ndarray:
        """Append float32 mono samples in [-1, 1]; return denoised samples emitted this call."""
        if samples.size == 0:
            return np.array([], dtype=np.float32)
        self._pending = np.concatenate([self._pending, samples.astype(np.float32, copy=False)])
        out_parts: list[np.ndarray] = []
        while self._pending.size >= BLOCK_SHIFT:
            shift = self._pending[:BLOCK_SHIFT]
            self._pending = self._pending[BLOCK_SHIFT:]
            self._in_buffer[:-BLOCK_SHIFT] = self._in_buffer[BLOCK_SHIFT:]
            self._in_buffer[-BLOCK_SHIFT:] = shift
            out_parts.append(self._process_shift())
        if not out_parts:
            return np.array([], dtype=np.float32)
        return np.concatenate(out_parts)
