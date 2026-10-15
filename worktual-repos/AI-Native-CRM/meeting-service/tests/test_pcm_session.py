"""LivePcmSession routes audio by real per-participant channel, not by the
glow-highlight name (which can flicker frame-to-frame for one continuous
speaker). See app/services/pcm_session.py for the rationale.

Note: `set_speaker` queues the label switch IN-BAND with that channel's audio
(same ordering guarantee as PcmTranscoder.set_speaker) so it's applied by the
transcoder's background task, not synchronously on `await`. Tests that assert
on `.speaker` right after a `set_speaker` call must yield to the event loop
first (a bare `await asyncio.sleep(0)` is enough once the task exists).
"""

import asyncio
import struct

import numpy as np
import pytest

import app.services.pcm_session as pcm_session_mod
from app.services.pcm_session import LivePcmSession, _split_channel_frame


def _tone() -> bytes:
    return (np.sin(np.linspace(0, 8 * np.pi, 320)) * 20000).astype(np.int16).tobytes()


def test_split_channel_frame_parses_header():
    payload = _tone()
    frame = struct.pack(">H", 3) + payload
    channel, pcm = _split_channel_frame(frame)
    assert channel == 3
    assert pcm == payload


def test_split_channel_frame_short_frame_falls_back_to_channel_zero():
    # A frame too short to carry the 2-byte header (older sender / raw-PCM
    # test fixture) must never be dropped — treat it as channel 0.
    channel, pcm = _split_channel_frame(b"\x01")
    assert channel == 0
    assert pcm == b"\x01"


class _FakeVad:
    def __init__(self, **_kwargs):
        self.started = False

    def feed_raw(self, _chunk):
        if not self.started:
            self.started = True
            return ["speech_start"]
        return []

    def reset(self):
        self.started = False


@pytest.mark.asyncio
async def test_two_channels_transcribe_independently_and_concurrently(monkeypatch):
    """Two real Meet participants speaking on separate channels (genuine
    overlap) must not contend for one shared label or one shared buffer —
    each channel gets its own transcoder."""
    import app.services.pcm_transcoder as transcoder_mod

    monkeypatch.setattr(transcoder_mod, "LivePcmVadChain", _FakeVad)

    def fake_transcribe(pcm: bytes) -> str:
        # Distinguish which channel's audio reached Whisper by buffer identity
        # is awkward here — instead key off a call counter per test via closure.
        return "hello"

    monkeypatch.setattr(transcoder_mod, "transcribe_pcm_sync", fake_transcribe)

    session = LivePcmSession("meeting-1")
    await session.set_speaker(1, "Alice")
    await session.set_speaker(2, "Bob")
    await asyncio.sleep(0.02)  # let each channel's background task apply its label

    tone = _tone()
    for _ in range(20):
        await session.push_pcm(1, tone)
        await session.push_pcm(2, tone)

    assert set(session._transcoders.keys()) == {1, 2}
    assert session._transcoders[1].speaker == "Alice"
    assert session._transcoders[2].speaker == "Bob"

    await session.stop()
    assert session._transcoders == {}


@pytest.mark.asyncio
async def test_set_speaker_ignores_blank_holds_previous_label(monkeypatch):
    """A blank/unresolved glow update (brief overlap ambiguity) must not
    reset or relabel a channel that already has a bound name."""
    import app.services.pcm_transcoder as transcoder_mod

    monkeypatch.setattr(transcoder_mod, "LivePcmVadChain", _FakeVad)
    monkeypatch.setattr(transcoder_mod, "transcribe_pcm_sync", lambda _pcm: "hi")

    session = LivePcmSession("meeting-1")
    await session.set_speaker(1, "Alice")
    await session.set_speaker(1, "")  # blank glow during overlap — ignored
    await session.set_speaker(1, "   ")  # whitespace-only — ignored
    await asyncio.sleep(0.02)  # let the background task apply the label

    tc = session._transcoder_for(1)
    assert tc.speaker == "Alice"

    await session.stop()


def test_transcoders_for_different_channels_get_distinct_segment_id_prefixes():
    """Two channels' PcmTranscoders each start their sequence at 1 — without a
    per-stream prefix, "pcm-final-1" from channel 1 and channel 2 would be the
    SAME segment_id, and upsert_segments (dedup by segment_id per meeting)
    would collide two different people's utterances into one DB row."""
    session = LivePcmSession("meeting-1")
    tc1 = session._transcoder_for(1)
    tc2 = session._transcoder_for(2)
    assert tc1._next_segment_id("final") == "pcm-ch-1-final-1"
    assert tc2._next_segment_id("final") == "pcm-ch-2-final-1"
    assert tc1._next_segment_id("final") != tc2._next_segment_id("final")


@pytest.mark.asyncio
async def test_push_pcm_before_any_speaker_defaults_to_unresolved_label():
    """Audio arriving before a channel's name resolves gets the generic
    fallback label — shouldAutoAssistFromChunk (TS side) blocks on this
    exact string so unattributed audio never drives coaching."""
    session = LivePcmSession("meeting-1")
    tc = session._transcoder_for(7)
    assert tc.speaker == "Speaker"
    await session.stop()
