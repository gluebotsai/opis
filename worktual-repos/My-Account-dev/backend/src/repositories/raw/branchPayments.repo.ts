function runnerQuery(runner: any) {
  if (typeof runner?.query === "function") {
    return runner;
  }
  throw new Error("A database client or pool is required.");
}

export async function selectBranchPaymentsByQuotationId(runner: any, quotationId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM quotation_branch_payments
     WHERE quotation_id = $1
     ORDER BY id ASC`,
    [quotationId],
  );
  return rows;
}

export async function selectBranchPaymentForUpdate(runner: any, quotationId: any, billingBranchId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM quotation_branch_payments
     WHERE quotation_id = $1 AND billing_branch_id = $2
     FOR UPDATE`,
    [quotationId, billingBranchId],
  );
  return rows[0] || null;
}

export async function selectBranchPaymentByLinkId(runner: any, paymentLinkId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM quotation_branch_payments WHERE payment_link_id = $1 LIMIT 1`,
    [paymentLinkId],
  );
  return rows[0] || null;
}

export async function upsertBranchPayment(runner: any, values: any) {
  const [
    quotationId,
    billingBranchId,
    branchLabel,
    provider,
    paymentLinkUrl,
    paymentLinkId,
    subtotal,
    grandTotal,
    currency,
    amountLabel,
    status,
    dryRun,
  ] = values;

  const { rows } = await runnerQuery(runner).query(
    `INSERT INTO quotation_branch_payments (
      quotation_id, billing_branch_id, branch_label, provider, payment_link_url, payment_link_id,
      subtotal, grand_total, currency, amount_label, status, dry_run, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
    ON CONFLICT (quotation_id, billing_branch_id) DO UPDATE SET
      branch_label = EXCLUDED.branch_label,
      provider = EXCLUDED.provider,
      payment_link_url = EXCLUDED.payment_link_url,
      payment_link_id = EXCLUDED.payment_link_id,
      subtotal = EXCLUDED.subtotal,
      grand_total = EXCLUDED.grand_total,
      currency = EXCLUDED.currency,
      amount_label = EXCLUDED.amount_label,
      status = CASE
        WHEN quotation_branch_payments.status = 'paid' THEN quotation_branch_payments.status
        ELSE EXCLUDED.status
      END,
      dry_run = EXCLUDED.dry_run,
      updated_at = NOW()
    RETURNING *`,
    [
      quotationId,
      billingBranchId,
      branchLabel,
      provider,
      paymentLinkUrl,
      paymentLinkId,
      subtotal,
      grandTotal,
      currency,
      amountLabel,
      status,
      dryRun,
    ],
  );
  return rows[0] || null;
}

export async function updateBranchPaymentReported(runner: any, values: any) {
  const [
    quotationId,
    billingBranchId,
    status,
    paidAt,
    providerPaymentId,
    providerCustomerId,
    providerEventId,
    provider,
    reportedAt,
    reportedBy,
  ] = values;

  const { rows } = await runnerQuery(runner).query(
    `UPDATE quotation_branch_payments SET
       status = $3,
       paid_at = COALESCE($4, paid_at),
       provider = COALESCE($8, provider),
       provider_payment_id = COALESCE($5, provider_payment_id),
       provider_customer_id = COALESCE($6, provider_customer_id),
       last_provider_event_id = COALESCE($7, last_provider_event_id),
       payment_reported_at = COALESCE($9, payment_reported_at, NOW()),
       payment_reported_by = COALESCE($10, payment_reported_by),
       failure_reason = NULL,
       updated_at = NOW()
     WHERE quotation_id = $1 AND billing_branch_id = $2 AND status IN ('pending', 'reported', 'failed')
     RETURNING *`,
    [
      quotationId,
      billingBranchId,
      status,
      paidAt,
      providerPaymentId,
      providerCustomerId,
      providerEventId,
      provider,
      reportedAt,
      reportedBy,
    ],
  );
  return rows[0] || null;
}

export async function updateBranchPaymentPaid(runner: any, values: any) {
  const [
    quotationId,
    billingBranchId,
    status,
    paidAt,
    providerPaymentId,
    providerCustomerId,
    providerEventId,
    provider,
    financeConfirmedAt,
    financeConfirmedBy,
  ] = values;

  const { rows } = await runnerQuery(runner).query(
    `UPDATE quotation_branch_payments SET
       status = $3,
       paid_at = $4,
       provider = COALESCE($8, provider),
       provider_payment_id = COALESCE($5, provider_payment_id),
       provider_customer_id = COALESCE($6, provider_customer_id),
       last_provider_event_id = COALESCE($7, last_provider_event_id),
       finance_confirmed_at = COALESCE($9, finance_confirmed_at, NOW()),
       finance_confirmed_by = COALESCE($10, finance_confirmed_by),
       failure_reason = NULL,
       updated_at = NOW()
     WHERE quotation_id = $1 AND billing_branch_id = $2
     RETURNING *`,
    [
      quotationId,
      billingBranchId,
      status,
      paidAt,
      providerPaymentId,
      providerCustomerId,
      providerEventId,
      provider,
      financeConfirmedAt,
      financeConfirmedBy,
    ],
  );
  return rows[0] || null;
}

/** Clear branch payment links after sales revert (provider links already cancelled). */
export async function clearBranchPaymentLinksForSalesRevert(
  runner: any,
  quotationId: any,
  failureReason: any,
) {
  const { rows } = await runnerQuery(runner).query(
    `UPDATE quotation_branch_payments SET
       payment_link_url = NULL,
       payment_link_id = NULL,
       status = 'failed',
       failure_reason = $2,
       updated_at = NOW()
     WHERE quotation_id = $1
       AND status IN ('pending', 'failed')
     RETURNING *`,
    [quotationId, failureReason],
  );
  return rows;
}

export async function updateBranchPaymentFailed(runner: any, values: any) {
  const [
    quotationId,
    billingBranchId,
    status,
    failureReason,
    providerEventId,
    providerPaymentId = null,
  ] = values;
  const { rows } = await runnerQuery(runner).query(
    `UPDATE quotation_branch_payments SET
       status = $3,
       failure_reason = $4,
       last_provider_event_id = COALESCE($5, last_provider_event_id),
       provider_payment_id = COALESCE($6, provider_payment_id),
       updated_at = NOW()
     WHERE quotation_id = $1
       AND billing_branch_id = $2
       AND status IN ('pending', 'failed')
     RETURNING *`,
    [quotationId, billingBranchId, status, failureReason, providerEventId, providerPaymentId],
  );
  return rows[0] || null;
}

export async function countBranchPaymentsByStatus(runner: any, quotationId: any, status: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT COUNT(*)::int AS count
     FROM quotation_branch_payments
     WHERE quotation_id = $1 AND status = $2`,
    [quotationId, status],
  );
  return rows[0]?.count || 0;
}

export async function countBranchPayments(runner: any, quotationId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT COUNT(*)::int AS count FROM quotation_branch_payments WHERE quotation_id = $1`,
    [quotationId],
  );
  return rows[0]?.count || 0;
}
