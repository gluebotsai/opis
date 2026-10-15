-- Old unique was (campaign_id, seq). Multi-channel launches collide (email seq 0 + push seq 0).
-- Current unique is (campaign_id, channel, seq). Drop leftover index/constraint.

DROP INDEX IF EXISTS "campaign_send_batches_campaign_id_seq_key";
ALTER TABLE "campaign_send_batches"
  DROP CONSTRAINT IF EXISTS "campaign_send_batches_campaign_id_seq_key";
