-- Voice recording settings: direction, consent notice, prompt, agent access.
-- Additive columns on accounts.setup_organization_recording_settings.
-- Does not wire live media capture.

ALTER TABLE accounts.setup_organization_recording_settings
  ADD COLUMN IF NOT EXISTS inbound_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS outbound_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS consent_notice_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS consent_prompt_id BIGINT,
  ADD COLUMN IF NOT EXISTS agent_access_enabled BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'setup_organization_recording_settings_consent_prompt_fk'
  ) THEN
    ALTER TABLE accounts.setup_organization_recording_settings
      ADD CONSTRAINT setup_organization_recording_settings_consent_prompt_fk
      FOREIGN KEY (consent_prompt_id)
      REFERENCES accounts.setup_voice_prompt_profiles(id)
      ON DELETE SET NULL;
  END IF;
END $$;

COMMENT ON TABLE accounts.setup_organization_recording_settings IS
  'Organization-level voice recording: master switch, inbound/outbound, consent notice, prompt, and agent access.';
COMMENT ON COLUMN accounts.setup_organization_recording_settings.recording_enabled IS
  'Master voice recording switch for the organization.';
COMMENT ON COLUMN accounts.setup_organization_recording_settings.inbound_enabled IS
  'Record inbound voice calls when recording is on.';
COMMENT ON COLUMN accounts.setup_organization_recording_settings.outbound_enabled IS
  'Record outbound voice calls when recording is on.';
COMMENT ON COLUMN accounts.setup_organization_recording_settings.consent_notice_enabled IS
  'Play a consent notice (prompt) before recording.';
COMMENT ON COLUMN accounts.setup_organization_recording_settings.consent_prompt_id IS
  'Voice prompt profile played as the consent notice; NULL when unset.';
COMMENT ON COLUMN accounts.setup_organization_recording_settings.agent_access_enabled IS
  'Whether agents can access recordings for this organization.';
