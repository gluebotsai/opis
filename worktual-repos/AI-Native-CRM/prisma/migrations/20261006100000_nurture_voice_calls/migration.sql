CREATE TABLE IF NOT EXISTS crm.nurture_voice_calls (
  id text PRIMARY KEY,
  organization_id bigint NOT NULL,
  contact_id text NOT NULL,
  activity_id text NOT NULL,
  session_id text NOT NULL,
  triggered_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS nurture_voice_calls_session_id_uidx
  ON crm.nurture_voice_calls (session_id);

CREATE INDEX IF NOT EXISTS nurture_voice_calls_activity_id_idx
  ON crm.nurture_voice_calls (activity_id);

CREATE INDEX IF NOT EXISTS nurture_voice_calls_org_contact_idx
  ON crm.nurture_voice_calls (organization_id, contact_id);

-- Latest nurture call activity for jobs that already stored a cc-core session id.
INSERT INTO crm.nurture_voice_calls (
  id,
  organization_id,
  contact_id,
  activity_id,
  session_id,
  triggered_at
)
SELECT
  'nvc_' || j.id,
  j.organization_id,
  j.contact_id,
  a.id,
  j.result_summary->>'sessionId',
  COALESCE(j.last_sent_at, a.created_at, now())
FROM crm.lead_nurture_jobs j
JOIN LATERAL (
  SELECT ca.id, ca.created_at
  FROM crm.contact_activities ca
  WHERE ca.contact_id = j.contact_id
    AND ca.organization_id = j.organization_id
    AND ca.type = 'call'
    AND ca.subject ILIKE 'Nurture voice bot%'
  ORDER BY ca.created_at DESC
  LIMIT 1
) a ON true
WHERE COALESCE(j.result_summary->>'sessionId', '') <> ''
  AND COALESCE(j.result_summary->>'transport', '') = 'voice_auto_bot'
ON CONFLICT (session_id) DO NOTHING;
