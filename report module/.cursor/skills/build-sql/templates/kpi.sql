-- product/sql/<kpi_id>.sql
-- File name matches the card id.
-- Include EVERY accepted HITL filter slot.
-- Many-to-one joins (company) may be LEFT JOIN.
-- Many-to-many (products) must use EXISTS so COUNT(*) does not multiply deals.
-- Do not concatenate user text. Do not append a free WHERE. No {{filters_sql}} hole.

SELECT
  {{dimension_select}}
  COUNT(*) AS deal_count
FROM rpt.deals d
LEFT JOIN rpt.companies c ON c.id = d.company_id
WHERE 1 = 1
  AND (CAST(:start AS timestamptz) IS NULL OR d.created_at >= :start)
  AND (CAST(:end AS timestamptz) IS NULL OR d.created_at < :end)
  AND (CAST(:stage AS text) IS NULL OR d.stage = :stage)
  AND (CAST(:owner_id AS bigint) IS NULL OR d.owner_id = :owner_id)
  AND (CAST(:region AS text) IS NULL OR c.region = :region)
  AND (
    CAST(:product AS text) IS NULL
    OR EXISTS (
      SELECT 1
      FROM rpt.deal_products dp
      JOIN rpt.products p ON p.id = dp.product_id
      WHERE dp.deal_id = d.id AND p.name = :product
    )
  )
  AND (CAST(:customer_id AS bigint) IS NULL OR d.customer_id = :customer_id)
  AND (CAST(:contact_id AS bigint) IS NULL OR d.contact_id = :contact_id)
  AND (CAST(:amount_min AS numeric) IS NULL OR d.amount >= :amount_min)
{{group_by_sql}}
