-- Queue operational settings (handle time, wait policy, announcements) + per-queue prompt slots.

ALTER TABLE accounts.setup_ccaas_queues
  ADD COLUMN IF NOT EXISTS max_handle_minutes SMALLINT NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS wrap_up_minutes SMALLINT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS max_wait_mode VARCHAR(16) NOT NULL DEFAULT 'unlimited',
  ADD COLUMN IF NOT EXISTS max_wait_minutes SMALLINT,
  ADD COLUMN IF NOT EXISTS max_wait_callback BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS max_wait_voicemail BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS announcement_frequency_seconds SMALLINT NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS announcement_slot_id VARCHAR(64) NOT NULL DEFAULT 'queue_position',
  ADD COLUMN IF NOT EXISTS announcement_audio_path VARCHAR(512),
  ADD COLUMN IF NOT EXISTS announcement_audio_name VARCHAR(255);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'setup_ccaas_queues_max_handle_minutes_chk'
  ) THEN
    ALTER TABLE accounts.setup_ccaas_queues
      ADD CONSTRAINT setup_ccaas_queues_max_handle_minutes_chk
      CHECK (max_handle_minutes >= 1 AND max_handle_minutes <= 240);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'setup_ccaas_queues_wrap_up_minutes_chk'
  ) THEN
    ALTER TABLE accounts.setup_ccaas_queues
      ADD CONSTRAINT setup_ccaas_queues_wrap_up_minutes_chk
      CHECK (wrap_up_minutes >= 0 AND wrap_up_minutes <= 240);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'setup_ccaas_queues_announcement_frequency_chk'
  ) THEN
    ALTER TABLE accounts.setup_ccaas_queues
      ADD CONSTRAINT setup_ccaas_queues_announcement_frequency_chk
      CHECK (announcement_frequency_seconds >= 10 AND announcement_frequency_seconds <= 300);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'setup_ccaas_queues_announcement_slot_chk'
  ) THEN
    ALTER TABLE accounts.setup_ccaas_queues
      ADD CONSTRAINT setup_ccaas_queues_announcement_slot_chk
      CHECK (
        announcement_slot_id IN (
          'queue_position',
          'maximum_wait_time_announcement',
          'queue_announcement'
        )
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'setup_ccaas_queues_max_wait_policy_chk'
  ) THEN
    ALTER TABLE accounts.setup_ccaas_queues
      ADD CONSTRAINT setup_ccaas_queues_max_wait_policy_chk
      CHECK (
        (
          max_wait_mode = 'unlimited'
          AND max_wait_minutes IS NULL
          AND max_wait_callback IS FALSE
          AND max_wait_voicemail IS FALSE
        )
        OR (
          max_wait_mode = 'limited'
          AND max_wait_minutes IS NOT NULL
          AND max_wait_minutes >= 1
          AND max_wait_minutes <= 240
          AND (max_wait_callback OR max_wait_voicemail)
        )
      );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS accounts.setup_ccaas_queue_prompt_slots (
  id BIGSERIAL PRIMARY KEY,
  queue_id BIGINT NOT NULL REFERENCES accounts.setup_ccaas_queues(id) ON DELETE CASCADE,
  slot_id VARCHAR(64) NOT NULL,
  text TEXT,
  audio_path VARCHAR(512),
  audio_name VARCHAR(255),
  source VARCHAR(16) NOT NULL DEFAULT 'none',
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT setup_ccaas_queue_prompt_slots_queue_id_slot_id_key UNIQUE (queue_id, slot_id),
  CONSTRAINT setup_ccaas_queue_prompt_slots_slot_chk CHECK (
    slot_id IN ('connecting_audio', 'queue_greeting', 'queue_audio', 'hold_audio')
  ),
  CONSTRAINT setup_ccaas_queue_prompt_slots_source_chk CHECK (
    source IN ('none', 'tts', 'upload')
  ),
  CONSTRAINT setup_ccaas_queue_prompt_slots_status_chk CHECK (
    status IN ('pending', 'ready', 'failed')
  )
);

CREATE INDEX IF NOT EXISTS idx_setup_ccaas_queue_prompt_slots_queue
  ON accounts.setup_ccaas_queue_prompt_slots (queue_id);
