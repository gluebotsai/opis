function runnerQuery(runner) {
  if (typeof runner?.query === "function") {
    return runner;
  }
  throw new Error("A database client or pool is required.");
}

export async function selectPaymentByQuotationId(runner, quotationId) {
  const { rows } = await runnerQuery(runner).query(`SELECT * FROM payments WHERE quotation_id = $1`, [
    quotationId,
  ]);
  return rows[0] || null;
}

export async function selectPaymentByProviderPaymentId(runner, providerPaymentId) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM payments WHERE provider_payment_id = $1 LIMIT 1`,
    [providerPaymentId],
  );
  return rows[0] || null;
}

export async function selectQuotationLeadIdAndSnapshot(runner, quotationId) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT lead_id, lead_snapshot FROM quotations WHERE id = $1`,
    [quotationId],
  );
  return rows[0] || null;
}

export async function confirmActiveProductsPayment(runner, quotationId) {
  await runnerQuery(runner).query(
    `UPDATE active_products
     SET payment_confirmed_at = COALESCE(payment_confirmed_at, NOW())
     WHERE quotation_id = $1`,
    [quotationId],
  );
}

export async function selectPaymentForUpdate(runner, quotationId) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM payments WHERE quotation_id = $1 FOR UPDATE`,
    [quotationId],
  );
  return rows[0] || null;
}

export async function updatePaymentPaid(runner, values) {
  const { rows } = await runnerQuery(runner).query(
    `UPDATE payments SET
       status = $2,
       paid_at = $3,
       provider = COALESCE($7, provider),
       provider_payment_id = COALESCE($4, provider_payment_id),
       provider_customer_id = COALESCE($5, provider_customer_id),
       last_provider_event_id = COALESCE($6, last_provider_event_id),
       failure_reason = NULL,
       updated_at = NOW()
     WHERE quotation_id = $1
     RETURNING *`,
    values,
  );
  return rows[0] || null;
}

export async function updateQuotationStatusPaid(runner, quotationId, status) {
  await runnerQuery(runner).query(
    `UPDATE quotations
     SET status = $2, version = version + 1
     WHERE id = $1`,
    [quotationId, status],
  );
}

export async function updatePaymentFailed(runner, values) {
  const { rows } = await runnerQuery(runner).query(
    `UPDATE payments SET
       status = $2,
       failure_reason = $3,
       last_provider_event_id = COALESCE($4, last_provider_event_id),
       updated_at = NOW()
     WHERE quotation_id = $1 AND status = $5
     RETURNING *`,
    values,
  );
  return rows[0] || null;
}

export async function updatePaymentRefunded(runner, values) {
  const { rows } = await runnerQuery(runner).query(
    `UPDATE payments SET
       status = $2,
       failure_reason = $3,
       last_provider_event_id = COALESCE($4, last_provider_event_id),
       updated_at = NOW()
     WHERE quotation_id = $1 AND status = $5
     RETURNING *`,
    values,
  );
  return rows[0] || null;
}

export async function selectQuotationIdByPaymentLinkId(runner, paymentLinkId) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT quotation_id FROM payments WHERE payment_link_id = $1 LIMIT 1`,
    [paymentLinkId],
  );
  return rows[0]?.quotation_id || null;
}
