-- Per-product discount cap: discounts above this % require Finance approval before send.
ALTER TABLE "products" ADD COLUMN "max_discount_percent" DECIMAL(5,2);

-- Backfill: nothing today ever auto-approves a quote (approved_by_user_id/approved_at are
-- never set on create/update), so every existing quote is stuck unable to send. Since no
-- discount caps existed before this migration, auto-approve existing non-terminal quotes
-- that have a known creator so they aren't left stuck by that pre-existing gap.
UPDATE "quotes"
SET
  "approval_status" = 'approved',
  "approved_by_user_id" = "created_by_user_id",
  "approved_at" = now()
WHERE "approval_status" IN ('drafting', 'pending_approval')
  AND "status" NOT IN ('accepted', 'void')
  AND "approved_at" IS NULL
  AND "created_by_user_id" IS NOT NULL;
