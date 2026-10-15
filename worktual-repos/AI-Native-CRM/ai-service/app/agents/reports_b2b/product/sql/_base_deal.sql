-- Base Scoped Deal CTE with Dynamic Currency Resolution Hierarchy & Stage Weights
WITH user_channel_companies AS (
  SELECT id AS company_id
  FROM crm.companies
  WHERE organization_id = :tenant_id
    AND (owner_user_id = :current_user_id OR :can_view_all = true)
  UNION
  SELECT child.id AS company_id
  FROM crm.companies child
  JOIN crm.companies parent ON child.parent_company_id = parent.id
  WHERE child.organization_id = :tenant_id
    AND parent.channel_role IN ('franchise', 'owned_store', 'brand_hq')
    AND (parent.owner_user_id = :current_user_id OR :can_view_all = true)
),
picked_quote AS (
  SELECT DISTINCT ON (deal_id) deal_id, currency, status, updated_at
  FROM crm.quotes
  WHERE organization_id = :tenant_id
  ORDER BY deal_id, (status = 'accepted') DESC, updated_at DESC
),
country_currency AS (
  SELECT * FROM (VALUES 
    ('GB', 'GBP'), ('UK', 'GBP'), ('UNITED KINGDOM', 'GBP'), ('GREAT BRITAIN', 'GBP'),
    ('IN', 'INR'), ('INDIA', 'INR'),
    ('US', 'USD'), ('USA', 'USD'), ('UNITED STATES', 'USD'),
    ('DE', 'EUR'), ('GERMANY', 'EUR'), ('FR', 'EUR'), ('FRANCE', 'EUR'),
    ('IT', 'EUR'), ('ITALY', 'EUR'), ('ES', 'EUR'), ('SPAIN', 'EUR'),
    ('NL', 'EUR'), ('NETHERLANDS', 'EUR'), ('IE', 'EUR'), ('IRELAND', 'EUR'),
    ('AU', 'AUD'), ('AUSTRALIA', 'AUD'), ('CA', 'CAD'), ('CANADA', 'CAD'),
    ('SG', 'SGD'), ('SINGAPORE', 'SGD'),
    ('AE', 'AED'), ('UAE', 'AED'), ('UNITED ARAB EMIRATES', 'AED'),
    ('SA', 'SAR'), ('ZA', 'ZAR'),
    ('JP', 'JPY'), ('CH', 'CHF'), ('SE', 'SEK'), ('NO', 'NOK'), ('DK', 'DKK')
  ) AS t(country, curr)
),
base_deals AS (
  SELECT 
    d.id,
    d.organization_id,
    d.title,
    d.stage,
    COALESCE(d.amount, 0) AS amount,
    CASE
      -- 1 & 2: Quote exists and is non-USD
      WHEN pq.currency IS NOT NULL AND pq.currency <> 'USD' THEN pq.currency
      -- 3 & 4: Quote is USD or missing, tenant country is non-US -> derive from country
      WHEN o.country IS NOT NULL AND o.country <> 'US' AND cc.curr IS NOT NULL THEN cc.curr
      -- Quote is USD and country is US or unmapped
      WHEN pq.currency = 'USD' THEN 'USD'
      -- No quote, country is US
      WHEN o.country = 'US' THEN 'USD'
      -- 5: No quote and no known country -> plain number
      ELSE NULL
    END AS currency_code,
    CASE d.stage
      WHEN 'qualification' THEN 0.10
      WHEN 'discover' THEN 0.25
      WHEN 'propose' THEN 0.50
      WHEN 'negotiate' THEN 0.75
      WHEN 'closed_won' THEN 1.00
      WHEN 'closed_lost' THEN 0.00
      ELSE 0.00
    END AS stage_weight,
    ROUND(COALESCE(d.amount, 0) * (
      CASE d.stage
        WHEN 'qualification' THEN 0.10
        WHEN 'discover' THEN 0.25
        WHEN 'propose' THEN 0.50
        WHEN 'negotiate' THEN 0.75
        WHEN 'closed_won' THEN 1.00
        WHEN 'closed_lost' THEN 0.00
        ELSE 0.00
      END
    ), 2) AS weighted_amount,
    d.company_id,
    c.name AS company_name,
    COALESCE(c.industry, 'Unknown') AS industry,
    COALESCE(c.channel_role::text, 'standard') AS channel_role,
    d.location_id,
    d.contact_id,
    COALESCE(d.contact_name, TRIM(CONCAT(cp_usr.first_name, ' ', cp_usr.last_name))) AS contact_name,
    d.contact_email AS contact_email,
    d.owner_user_id,
    TRIM(CONCAT(u.first_name, ' ', u.last_name)) AS owner_name,
    d.closed_at,
    COALESCE(d.closed_at, d.created_at) AS close_ts,
    d.created_at,
    d.updated_at,
    d.expected_close_date,
    COALESCE(d.lost_reason, 'Unspecified') AS lost_reason,
    (d.stage IN ('qualification', 'discover', 'propose', 'negotiate')) AS is_open,
    (d.stage = 'closed_won') AS is_won,
    (d.stage = 'closed_lost') AS is_lost,
    GREATEST(0, EXTRACT(DAY FROM (:as_of_ts::timestamp - d.created_at)))::int AS aging_days,
    (GREATEST(0, EXTRACT(DAY FROM (:as_of_ts::timestamp - d.created_at))) >= 14) AS is_stale,
    TO_CHAR(d.created_at, 'YYYY-MM') AS created_month,
    TO_CHAR(COALESCE(d.closed_at, d.created_at), 'YYYY-MM') AS close_month
  FROM crm.deals d
  JOIN accounts.organizations o ON d.organization_id = o.id
  LEFT JOIN crm.companies c ON d.company_id = c.id
  LEFT JOIN accounts.setup_users u ON d.owner_user_id = u.id
  LEFT JOIN cdp.customer_profile cp_usr ON d.contact_id = cp_usr.cdp_id
  LEFT JOIN picked_quote pq ON d.id = pq.deal_id
  LEFT JOIN country_currency cc ON upper(btrim(o.country)) = cc.country
  WHERE d.organization_id = :tenant_id
    AND (:can_view_all = true OR d.owner_user_id = :current_user_id OR d.company_id IN (SELECT company_id FROM user_channel_companies))
)
