function runnerQuery(runner: any) {
  if (typeof runner?.query === "function") {
    return runner;
  }
  throw new Error("A database client or pool is required.");
}

export async function selectInvoiceBySubscriptionAndSequence(runner: any, subscriptionId: any, sequence: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT id FROM subscription_invoices
     WHERE subscription_id = $1 AND sequence = $2
     LIMIT 1`,
    [subscriptionId, sequence],
  );
  return rows[0] || null;
}

export async function selectInvoiceRowBySubscriptionAndSequence(runner: any, subscriptionId: any, sequence: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM subscription_invoices
     WHERE subscription_id = $1 AND sequence = $2`,
    [subscriptionId, sequence],
  );
  return rows[0] || null;
}

export async function insertSubscriptionInvoice(runner: any, values: any) {
  const { rows } = await runnerQuery(runner).query(
    `INSERT INTO subscription_invoices (
      subscription_id, sequence, invoice_type, generation_date, status,
      service_period_start, service_period_end, remaining_days,
      monthly_price, subtotal, gst_rate, grand_total
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    RETURNING *`,
    values,
  );
  return rows[0] || null;
}

export async function selectInvoicesBySubscription(runner: any, subscriptionId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM subscription_invoices
     WHERE subscription_id = $1
     ORDER BY sequence ASC`,
    [subscriptionId],
  );
  return rows;
}

export async function markScheduledInvoicesGenerated(runner: any, generatedStatus: any, scheduledStatus: any) {
  const { rows } = await runnerQuery(runner).query(
    `UPDATE subscription_invoices
     SET status = $1
     WHERE status = $2
       AND generation_date <= CURRENT_DATE
     RETURNING *`,
    [generatedStatus, scheduledStatus],
  );
  return rows;
}
