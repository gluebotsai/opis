-- Sales & Pre-sales Coach Agent: private per-interaction coaching feedback.
-- Never a performance rating; overallImpression is qualitative (strong|solid|needs_work).
-- Managers/admins only ever see aggregate counts computed from this table — never the
-- raw coaching_note / highlighted_moment text (enforced in the DAO layer, not here).

CREATE TABLE IF NOT EXISTS coaching_insights (
  id                   TEXT PRIMARY KEY,
  organization_id      BIGINT NOT NULL,
  activity_id          TEXT NOT NULL UNIQUE,
  contact_id           TEXT,
  deal_id              TEXT,
  rep_user_id          BIGINT NOT NULL,
  interaction_type     VARCHAR(16) NOT NULL,
  overall_impression   VARCHAR(16) NOT NULL,
  discovery_quality    TEXT,
  objection_handling   TEXT,
  methodology_note     TEXT,
  talk_balance_note    TEXT,
  strengths            JSONB NOT NULL DEFAULT '[]',
  growth_areas         JSONB NOT NULL DEFAULT '[]',
  highlighted_moment   TEXT,
  coaching_note        TEXT,
  analyzed_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS coaching_insights_org_rep_created_idx
  ON coaching_insights (organization_id, rep_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS coaching_insights_contact_idx
  ON coaching_insights (contact_id);
