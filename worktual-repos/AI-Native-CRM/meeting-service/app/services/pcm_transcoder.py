"""
Live PCM segmentation: 20 ms frames, VAD on gain → HP → DTLN → Silero,
Whisper once per utterance on raw PCM with ~500 ms pre-speech ring.
"""

from __future__ import annotations

import asyncio
import collections
import logging
import re
import time
import unicodedata
from dataclasses import dataclass, field
from typing import Awaitable, Callable

import numpy as np

from app.config import settings
from app.services.live_timing import append_mark, latency_mark, utc_now_iso
from app.services.live_pcm_hallucinations import is_whisper_hallucination
from app.services.live_pcm_vad_chain import LivePcmVadChain
from app.services.stt_client import SAMPLE_RATE, transcribe_pcm_sync

log = logging.getLogger(__name__)

OnSegment = Callable[[dict], Awaitable[None] | None]

FILLER_SET = frozenset(
    {"amen", "thank you", "no i mean", "okay", "ok", "yeah", "hmm", "uh", "um", "huh", "you", "bye"}
)


from app.services.live_pcm_audio_utils import normalize_peak_bytes, rms_energy

def normalize_text(text: str | None) -> str:
    if not text:
        return ""
    return re.sub(
        r"[^\w\s]",
        "",
        unicodedata.normalize("NFKC", text.lower().strip()),
    )


def compute_audio_energy_pcm(pcm: bytes) -> float:
    if not pcm:
        return 0.0
    wav = np.frombuffer(pcm, dtype=np.int16).astype(np.float32) / 32768.0
    return float(np.sqrt(np.mean(wav**2)))


def filter_hallucinations(text: str, pcm: bytes | None = None) -> str | None:
    text_clean = normalize_text(text)
    energy = compute_audio_energy_pcm(pcm) if pcm else 0.25
    threshold = settings.live_pcm_energy_filter
    # Silero already accepted this raw buffer as speech after the configured
    # gain → high-pass → DTLN control chain. Do not reject Whisper's text using
    # raw-PCM energy here: quiet but valid speech is expected to be below the
    # control-path level because STT deliberately receives the unmodified PCM.
    if text_clean in FILLER_SET and energy < threshold * 5:
        return None
    if len(text_clean) < 2:
        return None
    cleaned = re.sub(r"\s+", " ", text).strip()
    if cleaned.lower() in ("you", "you."):
        return None
    if is_whisper_hallucination(cleaned):
        return None
    # Keep short customer lines. Live VAD often emits one or two words
    # ("I don't know", "How much"); dropping those left the assist panel empty
    # even though Whisper had already transcribed the call.
    return cleaned


# Terminal punctuation followed by whitespace/EOS — avoids false-splitting on
# things like "3.14" or "Mr." mid-word, though the latter is a known minor
# miss for a heuristic this simple.
_SENTENCE_END_RE = re.compile(r"[.?!]+[\"')\]]*(?=\s|$)")


def split_sentences(text: str) -> list[tuple[str, bool]]:
    """Split a block of text into `(sentence, ends_with_terminal_punct)` chunks."""
    stripped = text.strip()
    if not stripped:
        return []
    out: list[tuple[str, bool]] = []
    start = 0
    for m in _SENTENCE_END_RE.finditer(stripped):
        end = m.end()
        chunk = stripped[start:end].strip()
        if chunk:
            out.append((chunk, True))
        start = end
    tail = stripped[start:].strip()
    if tail:
        out.append((tail, False))
    return out


@dataclass
class PcmTranscoder:
    """One speaker stream → optional drafts + final segment events."""

    speaker: str
    on_segment: OnSegment
    # Unique per stream (e.g. "ch-2") when multiple PcmTranscoder instances share
    # one meeting — see pcm_session.py. Without this, two channels' independent
    # per-instance sequence counters would both emit "pcm-final-1" etc., and
    # upsert_segments' dedup-by-segment_id would collide two different people's
    # utterances into one row. Empty by default for single-stream callers/tests.
    stream_key: str = ""
    energy_threshold: float = field(default_factory=lambda: settings.live_pcm_energy_threshold)
    silence_ms: int = field(default_factory=lambda: settings.live_pcm_silence_ms)
    draft_ms: int = field(default_factory=lambda: settings.live_pcm_draft_ms)
    chunk_ms: int = 20
    pre_speech_ms: int = field(default_factory=lambda: settings.live_pcm_pre_speech_ms)
    gain: float = field(default_factory=lambda: settings.live_pcm_gain)

    RATE: int = SAMPLE_RATE
    CHUNK_SIZE: int = field(init=False)
    SILENCE_CHUNKS: int = field(init=False)
    PRE_SPEECH_CHUNKS: int = field(init=False)
    DRAFT_CHUNKS: int = field(init=False)

    def __post_init__(self) -> None:
        self.CHUNK_SIZE = int(self.RATE * self.chunk_ms / 1000)
        self.SILENCE_CHUNKS = max(1, int(self.silence_ms / self.chunk_ms))
        self.PRE_SPEECH_CHUNKS = max(1, int(self.pre_speech_ms / self.chunk_ms))
        self.DRAFT_CHUNKS = (
            max(1, int(self.draft_ms / self.chunk_ms)) if self.draft_ms > 0 else 0
        )
        # Frames are `bytes` (PCM), `None` (stream end), or a `("__speaker__", name)`
        # control tuple — see `set_speaker`. All go through this one ordered queue
        # so a speaker-label switch is always processed at its correct position
        # relative to the audio around it (never a second, parallel pipeline).
        self._queue: asyncio.Queue = asyncio.Queue()
        self._task: asyncio.Task | None = None
        self._segment_seq = 0
        # Turn counter for `speaker_key` (`ch-<n>:<turn>`). The first resolved
        # glow binds turn 1 in place. A later different glow is a new person on
        # this channel and opens the next turn — the previous utterance keeps
        # the old key.
        self._turn = 1
        self._turn_named = (self.speaker or "").strip().lower() not in ("", "speaker")
        self._vad_chain = LivePcmVadChain(
            gain=self.gain,
            energy_threshold=self.energy_threshold,
        )
        self._pending = b""
        self._stt_busy = False
        self._speech_started_at: str | None = None
        self._pending_latency: dict | None = None
        self._emitted_sentence_count = 0

    async def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._process())

    async def stop(self) -> None:
        await self._queue.put(None)
        if self._task:
            await self._task
            self._task = None

    async def push_pcm(self, data: bytes) -> None:
        if not data:
            return
        await self._queue.put(data)

    async def set_speaker(self, name: str) -> None:
        """Queue a speaker-label switch in-band with the audio.

        This is processed by `_process()` at its correct position in the
        ordered stream: any utterance already buffered under the old label is
        finalized first, then the label switches for audio that follows. This
        keeps a single sequential pipeline instead of spinning up a second,
        unordered transcoder for the new label (which caused mid-sentence
        fragmentation and out-of-order Whisper completions).
        """
        clean = (name or "").strip()
        if not clean or clean == self.speaker:
            return
        await self._queue.put(("__speaker__", clean))

    @property
    def speaker_key(self) -> str:
        """Stable id for this channel-turn. Empty when the stream has no channel."""
        if not self.stream_key:
            return ""
        return f"{self.stream_key}:{self._turn}"

    def _next_segment_id(self, kind: str) -> str:
        self._segment_seq += 1
        prefix = f"pcm-{self.stream_key}" if self.stream_key else "pcm"
        return f"{prefix}-{kind}-{self._segment_seq}"

    async def _emit(
        self,
        *,
        text: str,
        completed: bool,
        pcm: bytes,
        latency: dict | None,
    ) -> None:
        filtered = filter_hallucinations(text, pcm)
        if not filtered:
            log.info(
                "live_pcm_segment_filtered",
                extra={
                    "speaker": self.speaker,
                    "completed": completed,
                    "text_preview": text[:80],
                    "raw_energy": f"{compute_audio_energy_pcm(pcm):.6f}",
                },
            )
            return
        kind = "final" if completed else "draft"
        seg_id = self._next_segment_id(kind)
        trace = dict(latency) if latency else {"marks": []}
        trace["segmentId"] = seg_id
        trace["completed"] = completed
        trace = append_mark(
            trace,
            latency_mark("segment_emit", started_at=utc_now_iso()),
        )
        event = {
            "segment_id": seg_id,
            "speaker": self.speaker,
            "speaker_key": self.speaker_key,
            "text": filtered,
            "completed": completed,
            "latency": trace,
            # Wall clock of the first speech frame on this turn. This is not
            # join time — the channel has no join signal. CRM uses it as the
            # activity timestamp for roster correlation.
            "speech_started_at": self._speech_started_at,
        }
        result = self.on_segment(event)
        if asyncio.iscoroutine(result):
            await result

    async def _emit_sentences(
        self,
        *,
        text: str,
        utterance_completed: bool,
        pcm: bytes,
        latency: dict | None,
    ) -> None:
        sentences = split_sentences(text)
        if not sentences:
            return
        new_sentences = sentences[self._emitted_sentence_count :]
        if not new_sentences:
            return
        last_idx = len(new_sentences) - 1
        for i, (sentence, ends_with_punct) in enumerate(new_sentences):
            is_forming_tail = (
                i == last_idx and not ends_with_punct and not utterance_completed
            )
            await self._emit(
                text=sentence,
                completed=not is_forming_tail,
                pcm=pcm,
                latency=latency,
            )
            if not is_forming_tail:
                self._emitted_sentence_count += 1

    async def _transcribe_and_emit(
        self,
        audio_buffer: bytearray,
        *,
        completed: bool,
    ) -> None:
        if self._stt_busy and not completed:
            return
        pcm = bytes(audio_buffer)
        min_bytes = int(self.RATE * 0.35) * 2
        if len(pcm) < min_bytes:
            return
        self._stt_busy = True
        whisper_start = utc_now_iso()
        # Google Meet's WebRTC-mirrored audio arrives much quieter than a
        # normal mic (~0.01-0.03 peak) — quiet enough that Whisper garbles or
        # hallucinates words. Peak-normalize ONLY this copy; `pcm` (raw) still
        # goes to _emit_sentences/filter_hallucinations below unchanged, so
        # the energy-filter threshold keeps its original calibrated meaning.
        whisper_pcm = normalize_peak_bytes(
            pcm,
            target_peak=settings.live_pcm_whisper_target_peak,
            max_gain=settings.live_pcm_whisper_max_gain,
        )
        try:
            text = await asyncio.to_thread(transcribe_pcm_sync, whisper_pcm)
            whisper_end = utc_now_iso()
            if text:
                log.info(
                    "live_pcm_whisper_result",
                    extra={
                        "speaker": self.speaker,
                        "completed": completed,
                        "text_len": len(text),
                        "raw_energy": f"{compute_audio_energy_pcm(pcm):.6f}",
                        "audio_sec": f"{len(pcm) / (self.RATE * 2):.3f}",
                    },
                )
                trace = dict(self._pending_latency or {"marks": []})
                trace = append_mark(
                    trace,
                    latency_mark("whisper", started_at=whisper_start, ended_at=whisper_end),
                )
                await self._emit_sentences(
                    text=text,
                    utterance_completed=completed,
                    pcm=pcm,
                    latency=trace,
                )
                if completed:
                    self._speech_started_at = None
                    self._pending_latency = None
                    self._emitted_sentence_count = 0
            else:
                log.info(
                    "live_pcm_whisper_empty",
                    extra={
                        "speaker": self.speaker,
                        "completed": completed,
                        "raw_energy": f"{compute_audio_energy_pcm(pcm):.6f}",
                        "audio_sec": f"{len(pcm) / (self.RATE * 2):.3f}",
                    },
                )
        finally:
            self._stt_busy = False

    async def _process(self) -> None:
        raw_ring: collections.deque[bytes] = collections.deque(maxlen=self.PRE_SPEECH_CHUNKS)
        raw_utterance = bytearray()
        speeching = False
        since_draft = 0

        async def finalize_utterance(reason: str) -> None:
            nonlocal raw_utterance, speeching, since_draft
            if not speeching or not raw_utterance:
                return
            speech_end = utc_now_iso()
            if self._pending_latency:
                self._pending_latency = append_mark(
                    self._pending_latency,
                    latency_mark(
                        "speech_end",
                        started_at=speech_end,
                        ended_at=speech_end,
                    ),
                )
            t0 = time.perf_counter()
            await self._transcribe_and_emit(raw_utterance, completed=True)
            log.info(
                "live_pcm_utterance",
                extra={
                    "sec": f"{time.perf_counter() - t0:.3f}",
                    "speaker": self.speaker,
                    "boundary": reason,
                },
            )
            raw_utterance = bytearray()
            speeching = False
            since_draft = 0
            if reason == "transport_idle":
                # The source stopped sending frames, so Silero never received
                # trailing silence and remains internally in its speech state.
                self._vad_chain.reset()

        while True:
            try:
                frame = await asyncio.wait_for(
                    self._queue.get(),
                    timeout=self.silence_ms / 1000 if speeching else None,
                )
            except asyncio.TimeoutError:
                # Vexa's per-speaker capture may stop delivering a channel as
                # soon as that speaker goes quiet. Treat that transport-idle
                # interval as the missing speech_end edge; transcribe once.
                await finalize_utterance("transport_idle")
                continue
            if frame is None:
                await finalize_utterance("stream_end")
                break
            if isinstance(frame, tuple) and frame and frame[0] == "__speaker__":
                new_name = frame[1]
                if not self._turn_named:
                    # First real glow on this channel. Bind it onto the current
                    # turn — including audio already buffered — instead of
                    # splitting the utterance under the "Speaker" placeholder.
                    self.speaker = new_name
                    self._turn_named = True
                    continue
                if new_name == self.speaker:
                    continue
                # A different confident glow is a new person on this channel.
                # Close the old turn first so its text keeps the old speaker_key.
                await finalize_utterance("speaker_change")
                self._turn += 1
                self.speaker = new_name
                continue

            self._pending += frame
            while len(self._pending) >= self.CHUNK_SIZE * 2:
                raw_chunk = self._pending[: self.CHUNK_SIZE * 2]
                self._pending = self._pending[self.CHUNK_SIZE * 2 :]
                vad_events = self._vad_chain.feed_raw(raw_chunk)

                for ev in vad_events:
                    if ev == "speech_start" and not speeching:
                        self._speech_started_at = utc_now_iso()
                        self._pending_latency = {
                            "marks": [
                                latency_mark(
                                    "speech_start",
                                    started_at=self._speech_started_at,
                                    ended_at=self._speech_started_at,
                                )
                            ]
                        }
                        raw_utterance.extend(b"".join(raw_ring))
                        raw_ring.clear()
                        speeching = True
                        since_draft = 0
                        self._emitted_sentence_count = 0

                if speeching:
                    raw_utterance.extend(raw_chunk)
                    if self.DRAFT_CHUNKS > 0:
                        since_draft += 1
                        if since_draft >= self.DRAFT_CHUNKS:
                            since_draft = 0
                            asyncio.create_task(
                                self._transcribe_and_emit(
                                    bytearray(raw_utterance), completed=False
                                )
                            )
                else:
                    raw_ring.append(raw_chunk)

                for ev in vad_events:
                    if ev != "speech_end" or not speeching:
                        continue
                    await finalize_utterance("vad")
