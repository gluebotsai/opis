import asyncio

import numpy as np
import pytest

from app.services.live_pcm_hallucinations import is_whisper_hallucination
from app.services.live_pcm_audio_utils import normalize_peak_bytes
from app.config import settings
from app.services.pcm_transcoder import (
    PcmTranscoder,
    filter_hallucinations,
    normalize_text,
    rms_energy,
    split_sentences,
)


def test_rms_energy_silence_vs_tone():
    silent = (np.zeros(320, dtype=np.int16)).tobytes()
    tone = (np.sin(np.linspace(0, 8 * np.pi, 320)) * 20000).astype(np.int16).tobytes()
    assert rms_energy(silent) < 100
    assert rms_energy(tone) > 5000


def test_filter_hallucinations_rejects_empty():
    assert filter_hallucinations("um", pcm=None) is None


def test_normalize_text_strips_punct():
    assert normalize_text("Hello?") == "hello"


def test_whisper_hallucination_rejects_language_name():
    assert is_whisper_hallucination("Telugu") is True
    assert is_whisper_hallucination("English") is True
    assert filter_hallucinations("Telugu", pcm=None) is None


def test_whisper_hallucination_allows_real_question():
    assert is_whisper_hallucination("What are the products?") is False
    assert filter_hallucinations("What are the products?", pcm=None) == "What are the products?"


def test_filter_allows_quiet_silero_accepted_question():
    # STT receives raw PCM while VAD uses gained/cleaned PCM. Raw energy must
    # not veto speech that Silero already accepted.
    quiet = np.full(16_000, 100, dtype=np.int16).tobytes()
    assert filter_hallucinations("Am I audible?", pcm=quiet) == "Am I audible?"


def test_filter_keeps_short_customer_line():
    assert filter_hallucinations("I don't know", pcm=None) == "I don't know"
    assert filter_hallucinations("How much", pcm=None) == "How much"


def test_filter_hallucinations_rejects_be_back():
    assert is_whisper_hallucination("Be back.") is True
    assert filter_hallucinations("Be back", pcm=None) is None


def test_normalize_peak_bytes_boosts_quiet_meet_audio():
    # ~0.02 peak on a 0-1 scale — the level actually seen from Google Meet's
    # WebRTC-mirrored remote audio, quiet enough that Whisper garbles words.
    quiet = (np.full(3200, 650, dtype=np.int16)).tobytes()
    boosted = normalize_peak_bytes(quiet, target_peak=0.5, max_gain=12.0)
    boosted_peak = np.max(np.abs(np.frombuffer(boosted, dtype=np.int16)))
    assert boosted_peak > 600 * 5
    assert boosted_peak <= 32767


def test_normalize_peak_bytes_never_attenuates_loud_audio():
    loud = (np.full(3200, 30000, dtype=np.int16)).tobytes()
    boosted = normalize_peak_bytes(loud, target_peak=0.5, max_gain=12.0)
    assert boosted == loud


def test_normalize_peak_bytes_leaves_silence_untouched():
    silent = (np.zeros(3200, dtype=np.int16)).tobytes()
    assert normalize_peak_bytes(silent, target_peak=0.5, max_gain=12.0) == silent


def test_split_sentences_two_clauses():
    parts = split_sentences("Hi there. Can you explain CRM?")
    assert len(parts) == 2
    assert parts[0][0].endswith(".")
    assert parts[1][0].endswith("?")


def test_pcm_transcoder_utterance_only_defaults():
    tc = PcmTranscoder(speaker="Guest", on_segment=lambda _e: None)
    assert tc.PRE_SPEECH_CHUNKS == max(1, int(settings.live_pcm_pre_speech_ms / 20))
    assert tc.DRAFT_CHUNKS == 0


@pytest.mark.asyncio
async def test_pcm_transcoder_transport_idle_finalizes_once(monkeypatch):
    import app.services.pcm_transcoder as mod

    class FakeVad:
        def __init__(self, **_kwargs):
            self.started = False
            self.reset_count = 0

        def feed_raw(self, _chunk):
            if not self.started:
                self.started = True
                return ["speech_start"]
            return []

        def reset(self):
            self.started = False
            self.reset_count += 1

    monkeypatch.setattr(mod, "LivePcmVadChain", FakeVad)
    monkeypatch.setattr(mod, "transcribe_pcm_sync", lambda _pcm: "Current question?")
    emitted = []
    tc = mod.PcmTranscoder(
        speaker="Customer",
        on_segment=lambda event: emitted.append(event),
        silence_ms=30,
        draft_ms=0,
        pre_speech_ms=20,
    )
    await tc.start()
    tone = (np.sin(np.linspace(0, 8 * np.pi, 320)) * 20000).astype(np.int16).tobytes()
    for _ in range(20):
        await tc.push_pcm(tone)
    await asyncio.sleep(0.08)
    await tc.stop()

    assert [event["text"] for event in emitted] == ["Current question?"]
    assert emitted[0]["completed"] is True
    assert tc._vad_chain.reset_count == 1


@pytest.mark.asyncio
async def test_pcm_transcoder_speaker_switch_finalizes_old_label_first(monkeypatch):
    """The first resolved glow binds the current turn in place (Meet often
    starts a channel as "Speaker", then lights the real tile). A later
    different glow is a new person on that channel: the buffered utterance
    is finalized under the old name and `speaker_key` advances.
    """
    import app.services.pcm_transcoder as mod

    class FakeVad:
        def __init__(self, **_kwargs):
            self.started = False

        def feed_raw(self, _chunk):
            if not self.started:
                self.started = True
                return ["speech_start"]
            return []

        def reset(self):
            self.started = False

    monkeypatch.setattr(mod, "LivePcmVadChain", FakeVad)
    monkeypatch.setattr(mod, "transcribe_pcm_sync", lambda _pcm: "Hello there?")
    emitted = []
    tc = mod.PcmTranscoder(
        speaker="Speaker",
        stream_key="ch-1",
        on_segment=lambda event: emitted.append(event),
        silence_ms=30,
        draft_ms=0,
        pre_speech_ms=20,
    )
    await tc.start()
    tone = (np.sin(np.linspace(0, 8 * np.pi, 320)) * 20000).astype(np.int16).tobytes()
    for _ in range(20):
        await tc.push_pcm(tone)
    # First glow binds this turn. A blank glow (overlap) must not move it.
    await tc.set_speaker("Yaswanth M G")
    await tc.set_speaker("")
    await asyncio.sleep(0.05)
    assert tc.speaker_key == "ch-1:1"
    # A different person reuses the channel: close the old turn first.
    for _ in range(20):
        await tc.push_pcm(tone)
    await tc.set_speaker("Ravi Kumar")
    await asyncio.sleep(0.05)
    await tc.stop()

    assert emitted
    assert emitted[0]["speaker"] == "Yaswanth M G"
    assert emitted[0]["speaker_key"] == "ch-1:1"
    assert tc.speaker == "Ravi Kumar"
    assert tc.speaker_key == "ch-1:2"


def test_live_pcm_vad_chain_energy_fallback(monkeypatch):
    monkeypatch.setattr(settings, "live_pcm_vad_mode", "energy")
    monkeypatch.setattr(settings, "live_pcm_dtln_enabled", False)
    from app.services.live_pcm_vad_chain import LivePcmVadChain

    silent = (np.zeros(320, dtype=np.int16)).tobytes()
    tone = (np.sin(np.linspace(0, 8 * np.pi, 320)) * 20000).astype(np.int16).tobytes()
    chain = LivePcmVadChain(gain=2.0, energy_threshold=7000.0)
    assert chain.feed_raw(silent) == []
    assert chain.feed_raw(tone) == ["speech_start"]
