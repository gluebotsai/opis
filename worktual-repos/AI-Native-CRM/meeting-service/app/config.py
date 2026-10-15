from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT_DIR = Path(__file__).resolve().parent.parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(ROOT_DIR / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    database_url: str = f"sqlite:///{ROOT_DIR / 'data' / 'meeting_service.db'}"
    crm_service_jwt_secret: str = "dev-only-change-me"
    passcode_fernet_key: str = ""

    vexa_api_base: str = "http://localhost:18056"
    vexa_api_key: str = ""
    webhook_secret: str = "dev-webhook-secret"
    public_base_url: str = "http://localhost:8030/internal/vexa/webhook"

    whisper_base_url: str = "http://localhost:8000"
    whisper_api_token: str = ""
    whisper_model: str = "whisper-1"

    llm_base_url: str = "http://localhost:8000/v1"
    llm_api_key: str = ""
    llm_model: str = "local"
    llm_timeout_sec: float = 60.0

    redis_url: str = ""

    host: str = "0.0.0.0"
    port: int = 8030
    testing: bool = False

    max_concurrent_meetings: int = 2
    max_concurrent_per_org: int = 2
    max_queued_meetings: int = 1000
    max_queued_per_org: int = 100
    lobby_timeout_sec: int = 1200
    # When true, keep bot in Meet lobby until CRM expected_end_at (or slot fallback), not only lobby_timeout_sec.
    lobby_timeout_until_slot_end: bool = True
    # CRM default slot length when expected_end_at is not sent (seconds).
    meeting_slot_duration_sec: int = 1800
    # After expected end, stop bot and finalize (host-ended policy).
    host_ended_grace_sec: int = 90
    # Quiet after last speech must NOT stop the bot (0). The notetaker stays until
    # the host ends or leaves the Meet. A positive value is an emergency backstop only.
    host_ended_silence_sec: int = 0
    # Ignore "bot alone" / empty participant snapshots until this long after admit.
    host_ended_alone_grace_sec: int = 90
    # When false, do not end capture just because CRM slot time passed (wait for host / Vexa end).
    finalize_on_scheduled_slot_end: bool = False
    # Bot-alone / empty-room snapshots are noisy in Meet — default off.
    finalize_on_bot_alone: bool = False
    consent_required: bool = True
    live_tips_enabled: bool = False
    notetaker_provider: str = "vexa"
    # CRM notes only need STT. Vexa recording muxes audio+video to MinIO.
    vexa_recording_enabled: bool = False
    post_meetings_rate_per_min: int = 30

    transcript_retention_days: int = 90
    audio_retention_days: int = 30
    webhook_skew_sec: int = 300
    retry_after_sec: int = 15
    extract_max_attempts: int = 3
    default_bot_name: str = "Worktual Notetaker"
    crm_completed_webhook_url: str = ""
    llm_circuit_failures: int = 3
    llm_circuit_open_sec: float = 30.0
    enable_test_ui: bool = False
    crm_bot_base_url: str = ""
    crm_bot_api_key: str = ""
    crm_bot_openai_base_url: str = ""
    crm_bot_openai_api_key: str = ""
    crm_bot_openai_model: str = "worktual-gemma"
    google_addon_client_id: str = ""
    google_addon_cloud_project_number: str = ""
    # Optional: CRM login Web client when it differs from GOOGLE_ADDON_CLIENT_ID (comma-separated OK).
    google_client_id: str = ""
    google_oauth_extra_client_ids: str = ""
    crm_users_base_url: str = ""
    crm_users_api_key: str = ""
    crm_assist_dummy_org_id: str = "1003"
    assist_session_ttl_sec: int = 28800

    # CCaaS-style live PCM WebSocket (/v1/meetings/{id}/live-pcm)
    live_pcm_enabled: bool = True
    live_pcm_chunk_ms: int = 20
    live_pcm_silence_ms: int = 600
    # 0 = one Whisper call after VAD end (no cumulative rolling transcript).
    live_pcm_draft_ms: int = 0
    live_pcm_pre_speech_ms: int = 500
    live_pcm_energy_threshold: float = 7000.0
    # Applied on the VAD chain only; STT buffer stays raw PCM (+ pre-roll).
    live_pcm_gain: float = 2.0
    live_pcm_vad_mode: str = "silero"
    live_pcm_dtln_enabled: bool = True
    live_pcm_dtln_model_dir: str = ""
    live_pcm_silero_threshold: float = 0.5
    live_pcm_silero_min_silence_ms: int = 600
    live_pcm_silero_speech_pad_ms: int = 30
    live_pcm_energy_filter: float = 0.005
    live_pcm_whisper_timeout_sec: float = 8.0
    # Match whisper-adapter default (CCaaS forced English). Empty = omit (auto-detect).
    live_pcm_whisper_language: str = "en"
    # Google Meet's WebRTC remote-audio tracks (captured via the injected
    # <audio data-vexa-injected> mirror, not Meet's own AGC'd output) arrive
    # much quieter than a headset mic (~0.01-0.03 peak on a 0-1 scale) —
    # low enough that Whisper hallucinates/garbles words ("Prava Prava Prava").
    # Peak-normalize ONLY the copy sent to Whisper; the VAD chain's own gain
    # (live_pcm_gain) and the raw-PCM energy filter stay untouched so their
    # calibrated thresholds keep meaning what they meant before.
    live_pcm_whisper_target_peak: float = 0.5
    live_pcm_whisper_max_gain: float = 12.0


settings = Settings()


def ensure_dirs() -> None:
    if settings.database_url.startswith("sqlite"):
        (ROOT_DIR / "data").mkdir(parents=True, exist_ok=True)
