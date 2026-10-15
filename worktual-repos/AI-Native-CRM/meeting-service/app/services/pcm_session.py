"""CCaaS-style PCM session — one transcoder per real Meet audio channel.

Vexa's bot forwarder relays every participant's audio on the SAME WebSocket, but
each active speaker is a genuinely separate audio CHANNEL at the bot's capture
layer (Google Meet gives the bot per-participant track separation — see
vendor/vexa's gmeet-pipeline). Every binary frame carries its channel index
inline (2-byte big-endian header) so demuxing is never ambiguous, even when two
channels' frames interleave on the wire (two people talking at once).

We used to route by the glow-highlight NAME string instead of the channel. That
string can flicker frame-to-frame — even for one continuous speaker, during a
brief pause or audio overlap — because it comes from Meet's active-speaker
highlight, not from a stable identity. Multiplexing by that flickering name
fragmented a single utterance across independent async pipelines and let their
Whisper calls finish out of order (a later, shorter utterance could commit to
the DB before an earlier, longer one) — visible as mislabeled/duplicated
captures and a Heard preview that jumped backward.

A channel index is far more stable (bound to a real audio track for the
duration of a speaking turn), but Meet CAN reassign a channel slot to a
different participant later in the call (tile reuse) — so we still treat the
bound NAME for a channel as mutable: `PcmTranscoder.set_speaker` finalizes
whatever is buffered under the old label before a name change applies, exactly
as it does for any other label switch. Channel-scoped names also fixes the
opposite failure mode of the old "hold the single global label" design: two
channels speaking genuinely at once (real overlap) are transcribed
independently and concurrently, instead of contending for one shared label.
"""

from __future__ import annotations

import json
import logging
import struct
from typing import Any

from fastapi import WebSocket
from sqlalchemy.orm import Session

from app.config import settings
from app.db import SessionLocal
from app.models import Meeting
from app.services.pcm_transcoder import PcmTranscoder
from app.services.segments import upsert_segments

log = logging.getLogger(__name__)

# Binary frame header: 2-byte big-endian channel index, then raw PCM16LE payload.
_CHANNEL_HEADER_SIZE = 2


class LivePcmSession:
    def __init__(self, meeting_id: str) -> None:
        self.meeting_id = meeting_id
        self._transcoders: dict[int, PcmTranscoder] = {}

    def _on_segment(self, event: dict[str, Any]) -> None:
        session = SessionLocal()
        try:
            meeting = session.get(Meeting, self.meeting_id)
            if meeting:
                upsert_segments(session, meeting, [event])
        finally:
            session.close()

    def _transcoder_for(self, channel: int) -> PcmTranscoder:
        existing = self._transcoders.get(channel)
        if existing:
            return existing

        async def on_segment(event: dict) -> None:
            self._on_segment(event)

        # stream_key keeps segment_ids globally unique across channels sharing
        # this meeting — see PcmTranscoder.stream_key.
        tc = PcmTranscoder(
            speaker="Speaker", on_segment=on_segment, stream_key=f"ch-{channel}"
        )
        self._transcoders[channel] = tc
        return tc

    async def start(self) -> None:
        return

    async def set_speaker(self, channel: int, speaker: str) -> None:
        name = (speaker or "").strip()
        if not name:
            return  # blank/unresolved glow — hold this channel's previous label
        tc = self._transcoder_for(channel)
        await tc.start()
        # In-band with that channel's audio queue: finalizes the utterance
        # buffered under the old label before this switches, so nothing spoken
        # under one label gets emitted tagged with a later one.
        await tc.set_speaker(name)

    async def push_pcm(self, channel: int, pcm: bytes) -> None:
        tc = self._transcoder_for(channel)
        await tc.start()
        await tc.push_pcm(pcm)

    async def stop(self) -> None:
        for tc in self._transcoders.values():
            await tc.stop()
        self._transcoders.clear()


def _split_channel_frame(data: bytes) -> tuple[int, bytes]:
    """Parse the 2-byte channel header off a binary frame.

    Backward-compatible fallback: a frame too short to carry the header (e.g.
    an older/unpatched sender, or a raw-PCM test fixture) is treated as
    channel 0 with the whole payload as PCM — never dropped.
    """
    if len(data) < _CHANNEL_HEADER_SIZE:
        return 0, data
    (channel,) = struct.unpack(">H", data[:_CHANNEL_HEADER_SIZE])
    return channel, data[_CHANNEL_HEADER_SIZE:]


async def run_live_pcm_session(websocket: WebSocket, meeting_id: str) -> None:
    await websocket.accept()
    await websocket.send_json(
        {
            "type": "ready",
            "meeting_id": meeting_id,
            "silence_ms": settings.live_pcm_silence_ms,
            "draft_ms": settings.live_pcm_draft_ms,
            "pre_speech_ms": settings.live_pcm_pre_speech_ms,
            "sample_rate": 16000,
            "encoding": "pcm16le",
        }
    )
    session = LivePcmSession(meeting_id)
    try:
        while True:
            msg = await websocket.receive()
            if msg.get("type") == "websocket.disconnect":
                break
            if msg.get("bytes"):
                channel, pcm = _split_channel_frame(msg["bytes"])
                await session.push_pcm(channel, pcm)
            elif msg.get("text"):
                try:
                    ctrl = json.loads(msg["text"])
                except json.JSONDecodeError:
                    continue
                if ctrl.get("type") == "ping":
                    await websocket.send_json({"type": "pong"})
                    continue
                speaker = ctrl.get("speaker") or ctrl.get("participant_name")
                if speaker:
                    channel = ctrl.get("channel")
                    channel = int(channel) if isinstance(channel, (int, float)) else 0
                    await session.set_speaker(channel, str(speaker))
    finally:
        await session.stop()
