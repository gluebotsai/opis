-- PostgreSQL routines for Worktual Accounts
-- Layer guide:
--   fn_*  = read-only or atomic DB logic with a return value (use via callDbFunction)
--   sp_*  = multi-step writes with no rich return (use via callDbProcedure)
-- Business rules with Stripe/email/OAuth stay in server/*.js domain modules.

-- ---------------------------------------------------------------------------
-- Analytics / reads
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_lead_status_counts(p_created_by_user_id UUID DEFAULT NULL)
RETURNS TABLE(status TEXT, count INTEGER)
LANGUAGE sql
STABLE
AS $$
  SELECT l.status::text, COUNT(*)::int
  FROM leads l
  WHERE p_created_by_user_id IS NULL OR l.created_by_user_id = p_created_by_user_id
  GROUP BY l.status
  ORDER BY COUNT(*) DESC, l.status ASC;
$$;

-- ---------------------------------------------------------------------------
-- Duplicate-purchase validation (data load only; renewal math stays in JS)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_duplicate_purchase_context(
  p_lead_id UUID,
  p_exclude_quotation_id UUID DEFAULT NULL,
  p_pending_statuses TEXT[] DEFAULT ARRAY['Pending', 'Approved']
)
RETURNS JSONB
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'activeProducts',
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'productId', ap.product_id,
            'branchId', ap.branch_id,
            'changeType', ap.change_type,
            'config', ap.config,
            'approvedAt', ap.approved_at,
            'paymentConfirmedAt', ap.payment_confirmed_at
          )
        )
        FROM active_products ap
        WHERE ap.lead_id = p_lead_id
      ),
      '[]'::jsonb
    ),
    'pendingLines',
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', q.id,
            'status', q.status,
            'productId', pa.product_id,
            'branchId', pa.branch_id,
            'changeType', pa.change_type
          )
        )
        FROM quotations q
        INNER JOIN product_assignments pa ON pa.quotation_id = q.id
        WHERE q.lead_id = p_lead_id
          AND q.status = ANY (p_pending_statuses)
          AND (p_exclude_quotation_id IS NULL OR q.id <> p_exclude_quotation_id)
      ),
      '[]'::jsonb
    )
  );
$$;

-- ---------------------------------------------------------------------------
-- Quotation status transitions (atomic row update)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_transition_quotation_status(
  p_quotation_id UUID,
  p_from_status TEXT,
  p_to_status TEXT,
  p_finance_note TEXT DEFAULT '',
  p_reviewed_by TEXT DEFAULT NULL,
  p_clear_review BOOLEAN DEFAULT FALSE
)
RETURNS quotations
LANGUAGE plpgsql
AS $$
DECLARE
  result quotations%ROWTYPE;
  current_status TEXT;
BEGIN
  IF p_clear_review THEN
    UPDATE quotations
    SET status = p_to_status,
        finance_note = COALESCE(NULLIF(p_finance_note, ''), finance_note),
        reviewed_by = NULL,
        reviewed_at = NULL,
        version = version + 1
    WHERE id = p_quotation_id
      AND status = p_from_status
    RETURNING * INTO result;
  ELSE
    UPDATE quotations
    SET status = p_to_status,
        finance_note = COALESCE(NULLIF(p_finance_note, ''), finance_note),
        reviewed_by = p_reviewed_by,
        reviewed_at = NOW(),
        version = version + 1
    WHERE id = p_quotation_id
      AND status = p_from_status
    RETURNING * INTO result;
  END IF;

  IF NOT FOUND THEN
    SELECT q.status INTO current_status FROM quotations q WHERE q.id = p_quotation_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'QUOTATION_NOT_FOUND';
    END IF;
    IF current_status = p_to_status AND p_to_status = 'Approved' THEN
      RAISE EXCEPTION 'ALREADY_APPROVED';
    END IF;
    RAISE EXCEPTION 'INVALID_STATUS:%', current_status;
  END IF;

  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION fn_update_lead_status(p_lead_id UUID, p_status TEXT)
RETURNS VOID
LANGUAGE sql
AS $$
  UPDATE leads
  SET status = p_status,
      updated_at = NOW()
  WHERE id = p_lead_id;
$$;

-- ---------------------------------------------------------------------------
-- Support ticket creation (ticket + first message atomically)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_create_support_ticket_with_message(
  p_ticket_number TEXT,
  p_organization_id UUID,
  p_customer_user_id UUID,
  p_subscription_id UUID,
  p_product_id TEXT,
  p_subscription_key TEXT,
  p_product_label TEXT,
  p_category TEXT,
  p_priority TEXT,
  p_subject TEXT,
  p_description TEXT,
  p_unable_to_use BOOLEAN,
  p_started_after_change BOOLEAN,
  p_tenant_id TEXT,
  p_company_name TEXT,
  p_contact_email TEXT,
  p_author_label TEXT
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE
  v_ticket_id UUID;
BEGIN
  INSERT INTO support_tickets (
    ticket_number, organization_id, customer_user_id, subscription_id,
    product_id, subscription_key, product_label, category, priority,
    subject, description, unable_to_use, started_after_change,
    tenant_id, company_name, contact_email
  ) VALUES (
    p_ticket_number, p_organization_id, p_customer_user_id, p_subscription_id,
    p_product_id, p_subscription_key, p_product_label, p_category, p_priority,
    p_subject, p_description, p_unable_to_use, p_started_after_change,
    p_tenant_id, p_company_name, p_contact_email
  )
  RETURNING id INTO v_ticket_id;

  INSERT INTO support_ticket_messages (ticket_id, author_type, author_label, body)
  VALUES (v_ticket_id, 'customer', p_author_label, p_description);

  RETURN v_ticket_id;
END;
$$;

-- ---------------------------------------------------------------------------
-- Webhook idempotency helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_webhook_event_exists(p_provider TEXT, p_event_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM payment_webhook_events
    WHERE provider = p_provider AND event_id = p_event_id
  );
$$;

CREATE OR REPLACE FUNCTION fn_record_webhook_event(
  p_provider TEXT,
  p_event_id TEXT,
  p_event_type TEXT,
  p_quotation_id UUID,
  p_payload JSONB
)
RETURNS VOID
LANGUAGE sql
AS $$
  INSERT INTO payment_webhook_events (provider, event_id, event_type, quotation_id, payload)
  VALUES (p_provider, p_event_id, p_event_type, p_quotation_id, p_payload)
  ON CONFLICT (provider, event_id) DO NOTHING;
$$;

CREATE OR REPLACE FUNCTION fn_try_claim_webhook_event(
  p_provider TEXT,
  p_event_id TEXT,
  p_event_type TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO payment_webhook_events (provider, event_id, event_type)
  VALUES (p_provider, p_event_id, p_event_type);
  RETURN TRUE;
EXCEPTION
  WHEN unique_violation THEN
    RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION fn_update_webhook_event_payload(
  p_provider TEXT,
  p_event_id TEXT,
  p_quotation_id UUID,
  p_payload JSONB
)
RETURNS VOID
LANGUAGE sql
AS $$
  UPDATE payment_webhook_events
  SET quotation_id = COALESCE(p_quotation_id, quotation_id),
      payload = p_payload,
      processed_at = NOW()
  WHERE provider = p_provider AND event_id = p_event_id;
$$;

-- ---------------------------------------------------------------------------
-- Sales oversight analytics (read-only aggregates)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION fn_sales_oversight_period_summary(
  p_paid_status TEXT,
  p_since TIMESTAMPTZ,
  p_until TIMESTAMPTZ DEFAULT NULL,
  p_pipeline_statuses TEXT[] DEFAULT ARRAY['Pending Finance Review', 'Approved']
)
RETURNS TABLE(
  revenue NUMERIC,
  pipeline_value NUMERIC,
  quotations_submitted BIGINT,
  paid_quotations BIGINT,
  total_leads BIGINT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    COALESCE(SUM(q.grand_total) FILTER (
      WHERE q.status = p_paid_status
        AND q.submitted_at >= p_since
        AND (p_until IS NULL OR q.submitted_at < p_until)
    ), 0) AS revenue,
    COALESCE(SUM(q.grand_total) FILTER (
      WHERE q.status = ANY (p_pipeline_statuses)
        AND q.submitted_at >= p_since
        AND (p_until IS NULL OR q.submitted_at < p_until)
    ), 0) AS pipeline_value,
    COUNT(DISTINCT q.id) FILTER (
      WHERE q.submitted_at >= p_since
        AND (p_until IS NULL OR q.submitted_at < p_until)
    ) AS quotations_submitted,
    COUNT(DISTINCT q.id) FILTER (
      WHERE q.status = p_paid_status
        AND q.submitted_at >= p_since
        AND (p_until IS NULL OR q.submitted_at < p_until)
    ) AS paid_quotations,
    (
      SELECT COUNT(*)::bigint
      FROM leads
      WHERE created_at >= p_since
        AND (p_until IS NULL OR created_at < p_until)
    ) AS total_leads
  FROM quotations q;
$$;

CREATE OR REPLACE FUNCTION fn_sales_oversight_pipeline_funnel(
  p_statuses TEXT[] DEFAULT ARRAY['New', 'Pending Finance Review', 'Approved', 'Paid']
)
RETURNS TABLE(status TEXT, value NUMERIC)
LANGUAGE sql
STABLE
AS $$
  SELECT l.status::text,
         COALESCE(SUM(latest_q.grand_total), 0) AS value
  FROM leads l
  LEFT JOIN LATERAL (
    SELECT grand_total
    FROM quotations q
    WHERE q.lead_id = l.id
    ORDER BY q.submitted_at DESC NULLS LAST
    LIMIT 1
  ) latest_q ON TRUE
  WHERE l.status = ANY (p_statuses)
  GROUP BY l.status;
$$;

CREATE OR REPLACE FUNCTION fn_sales_oversight_dashboard_meta()
RETURNS TABLE(
  sales_agents BIGINT,
  total_leads_all BIGINT,
  unassigned_leads BIGINT
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    (SELECT COUNT(*)::bigint FROM users WHERE role = 'sales' AND is_active = TRUE) AS sales_agents,
    (SELECT COUNT(*)::bigint FROM leads) AS total_leads_all,
    (SELECT COUNT(*)::bigint FROM leads WHERE assigned_user_id IS NULL) AS unassigned_leads;
$$;

CREATE OR REPLACE FUNCTION fn_sales_oversight_stale_leads(
  p_paid_status TEXT,
  p_rejected_status TEXT DEFAULT 'Rejected',
  p_stale_days INTEGER DEFAULT 14,
  p_limit INTEGER DEFAULT 10
)
RETURNS TABLE(
  id UUID,
  tenant_id VARCHAR,
  company_name VARCHAR,
  status VARCHAR,
  updated_at TIMESTAMPTZ,
  assigned_agent_name VARCHAR
)
LANGUAGE sql
STABLE
AS $$
  SELECT l.id,
         l.tenant_id,
         l.company_name,
         l.status,
         l.updated_at,
         u.display_name AS assigned_agent_name
  FROM leads l
  LEFT JOIN users u ON u.id = l.assigned_user_id
  WHERE l.assigned_user_id IS NOT NULL
    AND l.status NOT IN (p_paid_status, p_rejected_status)
    AND l.updated_at < NOW() - (p_stale_days::text || ' days')::interval
    AND NOT EXISTS (
      SELECT 1 FROM quotations q
      WHERE q.lead_id = l.id
        AND q.submitted_at >= NOW() - (p_stale_days::text || ' days')::interval
    )
  ORDER BY l.updated_at ASC
  LIMIT p_limit;
$$;
