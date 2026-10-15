-- Allow Instagram / Facebook as first-class automation policy channels
-- (parity with WhatsApp). Keep legacy 'social' for any existing rows.

ALTER TABLE ccass.channel_automation_policies
  DROP CONSTRAINT IF EXISTS chk_cap_channel;

ALTER TABLE ccass.channel_automation_policies
  ADD CONSTRAINT chk_cap_channel
  CHECK (
    channel IN (
      'webchat',
      'email',
      'whatsapp',
      'instagram',
      'facebook',
      'social'
    )
  );
