function runnerQuery(runner: any) {
  if (typeof runner?.query === "function") {
    return runner;
  }
  throw new Error("A database client or pool is required.");
}

export async function selectLatestOpenRenewalEvent(runner: any, subscriptionId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT id FROM renewal_events
     WHERE subscription_id = $1 AND status IN ('scheduled', 'pending_quote')
     ORDER BY due_at DESC
     LIMIT 1`,
    [subscriptionId],
  );
  return rows[0] || null;
}

export async function updateRenewalEventDueAt(runner: any, renewalEventId: any, dueAt: any) {
  await runnerQuery(runner).query(
    `UPDATE renewal_events SET due_at = $2, updated_at = NOW() WHERE id = $1`,
    [renewalEventId, dueAt],
  );
}

export async function insertRenewalEvent(runner: any, subscriptionId: any, dueAt: any) {
  const { rows } = await runnerQuery(runner).query(
    `INSERT INTO renewal_events (subscription_id, due_at, status)
     VALUES ($1, $2, 'scheduled')
     RETURNING id`,
    [subscriptionId, dueAt],
  );
  return rows[0]?.id || null;
}

export async function selectUpcomingRenewals(runner: any, withinDays: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT re.*, s.product_id, s.organization_id, o.company_name
     FROM renewal_events re
     JOIN subscriptions s ON s.id = re.subscription_id
     JOIN organizations o ON o.id = s.organization_id
     WHERE re.status = 'scheduled'
       AND re.due_at <= NOW() + ($1 || ' days')::interval
     ORDER BY re.due_at ASC`,
    [String(withinDays)],
  );
  return rows;
}

export async function markRenewalsPendingQuote(runner: any) {
  const { rows } = await runnerQuery(runner).query(
    `UPDATE renewal_events
     SET status = 'pending_quote', updated_at = NOW()
     WHERE status = 'scheduled'
       AND due_at <= NOW() + INTERVAL '30 days'
       AND due_at > NOW()
     RETURNING *`,
  );
  return rows;
}

export async function attachRenewalQuotation(runner: any, subscriptionId: any, quotationId: any) {
  await runnerQuery(runner).query(
    `UPDATE renewal_events
     SET renewal_quotation_id = $2, status = 'quoted', updated_at = NOW()
     WHERE subscription_id = $1 AND status IN ('scheduled', 'pending_quote')`,
    [subscriptionId, quotationId],
  );
}

export async function completeRenewalEvents(runner: any, subscriptionId: any) {
  await runnerQuery(runner).query(
    `UPDATE renewal_events
     SET status = 'completed', updated_at = NOW()
     WHERE subscription_id = $1 AND status IN ('quoted', 'pending_quote', 'scheduled')`,
    [subscriptionId],
  );
}

export async function selectRenewalsReadyForAutoQuote(runner: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT re.id AS renewal_event_id,
            re.due_at,
            re.status AS renewal_status,
            s.id AS subscription_id,
            s.source_lead_id,
            s.product_id,
            s.branch_id,
            s.billing_branch_id,
            s.entitlement_config,
            s.price_label,
            s.mrr,
            s.change_type,
            s.cancel_at_period_end,
            s.organization_id,
            o.company_name
     FROM renewal_events re
     JOIN subscriptions s ON s.id = re.subscription_id
     JOIN organizations o ON o.id = s.organization_id
     WHERE re.status IN ('scheduled', 'pending_quote')
       AND re.renewal_quotation_id IS NULL
       AND s.status = 'active'
       AND COALESCE(s.cancel_at_period_end, FALSE) = FALSE
     ORDER BY re.due_at ASC`,
  );
  return rows;
}

export async function cancelRenewalEventsForSubscription(runner: any, subscriptionId: any) {
  await runnerQuery(runner).query(
    `UPDATE renewal_events
     SET status = 'cancelled', updated_at = NOW()
     WHERE subscription_id = $1 AND status NOT IN ('completed', 'cancelled')`,
    [subscriptionId],
  );
}
