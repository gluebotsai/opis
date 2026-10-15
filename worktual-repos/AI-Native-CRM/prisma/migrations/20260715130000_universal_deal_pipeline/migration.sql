-- Universal B2B default pipeline:
-- Qualify → Discover → Propose → Negotiate → Won / Lost

CREATE TYPE "DealStage_new" AS ENUM (
  'qualification',
  'discover',
  'propose',
  'negotiate',
  'closed_won',
  'closed_lost'
);

ALTER TABLE "deals" ALTER COLUMN "stage" DROP DEFAULT;

ALTER TABLE "deals"
  ALTER COLUMN "stage" TYPE "DealStage_new"
  USING (
    CASE "stage"::text
      WHEN 'lead' THEN 'qualification'::"DealStage_new"
      WHEN 'qualification' THEN 'qualification'::"DealStage_new"
      WHEN 'demo' THEN 'discover'::"DealStage_new"
      WHEN 'proposal_quote' THEN 'propose'::"DealStage_new"
      WHEN 'negotiation_review' THEN 'negotiate'::"DealStage_new"
      WHEN 'sales_order_commitment' THEN 'negotiate'::"DealStage_new"
      WHEN 'closed_won' THEN 'closed_won'::"DealStage_new"
      WHEN 'closed_lost' THEN 'closed_lost'::"DealStage_new"
      ELSE 'qualification'::"DealStage_new"
    END
  );

DROP TYPE "DealStage";
ALTER TYPE "DealStage_new" RENAME TO "DealStage";

ALTER TABLE "deals"
  ALTER COLUMN "stage" SET DEFAULT 'qualification'::"DealStage";
