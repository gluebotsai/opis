function runnerQuery(runner: any) {
  if (typeof runner?.query === "function") {
    return runner;
  }
  throw new Error("A database client or pool is required.");
}

export async function selectPaymentByQuotationId(runner: any, quotationId: any) {
  const { rows } = await runnerQuery(runner).query(`SELECT * FROM payments WHERE quotation_id = $1`, [
    quotationId,
  ]);
  return rows[0] || null;
}

export async function selectPaymentByProviderPaymentId(runner: any, providerPaymentId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM payments WHERE provider_payment_id = $1 LIMIT 1`,
    [providerPaymentId],
  );
  return rows[0] || null;
}

export async function selectQuotationLeadIdAndSnapshot(runner: any, quotationId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT lead_id, lead_snapshot FROM quotations WHERE id = $1`,
    [quotationId],
  );
  return rows[0] || null;
}

export async function confirmActiveProductsPayment(runner: any, quotationId: any) {
  await runnerQuery(runner).query(
    `UPDATE active_products
     SET payment_confirmed_at = COALESCE(payment_confirmed_at, NOW())
     WHERE quotation_id = $1`,
    [quotationId],
  );
}

export async function confirmActiveProductsPaymentForBranch(runner: any, quotationId: any, billingBranchId: any) {
  await runnerQuery(runner).query(
    `UPDATE active_products
     SET payment_confirmed_at = COALESCE(payment_confirmed_at, NOW())
     WHERE quotation_id = $1 AND billing_branch_id = $2`,
    [quotationId, billingBranchId],
  );
}

export async function selectPaymentForUpdate(runner: any, quotationId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM payments WHERE quotation_id = $1 FOR UPDATE`,
    [quotationId],
  );
  return rows[0] || null;
}

export async function updatePaymentPaid(runner: any, values: any) {
  const { rows } = await runnerQuery(runner).query(
    `UPDATE payments SET
       status = $2,
       paid_at = $3,
       provider = COALESCE($7, provider),
       provider_payment_id = COALESCE($4, provider_payment_id),
       provider_customer_id = COALESCE($5, provider_customer_id),
       last_provider_event_id = COALESCE($6, last_provider_event_id),
       finance_confirmed_at = COALESCE($8, finance_confirmed_at, NOW()),
       finance_confirmed_by = COALESCE($9, finance_confirmed_by),
       failure_reason = NULL,
       updated_at = NOW()
     WHERE quotation_id = $1
     RETURNING *`,
    values,
  );
  return rows[0] || null;
}

export async function updatePaymentReported(runner: any, values: any) {
  const { rows } = await runnerQuery(runner).query(
    `UPDATE payments SET
       status = $2,
       paid_at = COALESCE($3, paid_at),
       provider = COALESCE($7, provider),
       provider_payment_id = COALESCE($4, provider_payment_id),
       provider_customer_id = COALESCE($5, provider_customer_id),
       last_provider_event_id = COALESCE($6, last_provider_event_id),
       payment_reported_at = COALESCE($8, payment_reported_at, NOW()),
       payment_reported_by = COALESCE($9, payment_reported_by),
       failure_reason = NULL,
       updated_at = NOW()
     WHERE quotation_id = $1 AND status IN ('pending', 'reported', 'failed')
     RETURNING *`,
    values,
  );
  return rows[0] || null;
}

export async function updateQuotationStatusPaid(runner: any, quotationId: any, status: any) {
  await runnerQuery(runner).query(
    `UPDATE quotations
     SET status = $2, version = version + 1
     WHERE id = $1`,
    [quotationId, status],
  );
}

export async function updatePaymentFailed(runner: any, values: any) {
  const { rows } = await runnerQuery(runner).query(
    `UPDATE payments SET
       status = $2,
       failure_reason = $3,
       last_provider_event_id = COALESCE($4, last_provider_event_id),
       provider_payment_id = COALESCE($5, provider_payment_id),
       updated_at = NOW()
     WHERE quotation_id = $1 AND status IN ('pending', 'failed')
     RETURNING *`,
    values,
  );
  return rows[0] || null;
}

/** Clear online payment links after sales revert (provider links already cancelled). */
export async function clearPaymentLinksForSalesRevert(runner: any, quotationId: any, failureReason: any) {
  const { rows } = await runnerQuery(runner).query(
    `UPDATE payments SET
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
  return rows[0] || null;
}

export async function updatePaymentRefunded(runner: any, values: any) {
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

export async function selectQuotationIdByPaymentLinkId(runner: any, paymentLinkId: any) {
  const context = await resolvePaymentLinkContext(runner, paymentLinkId);
  return context?.quotationId || null;
}

export async function resolvePaymentLinkContext(runner: any, paymentLinkId: any) {
  if (!paymentLinkId) {
    return null;
  }

  const { rows: parentRows } = await runnerQuery(runner).query(
    `SELECT quotation_id FROM payments WHERE payment_link_id = $1 LIMIT 1`,
    [paymentLinkId],
  );
  if (parentRows[0]?.quotation_id) {
    return { quotationId: parentRows[0].quotation_id, billingBranchId: null };
  }

  const { rows: branchRows } = await runnerQuery(runner).query(
    `SELECT quotation_id, billing_branch_id FROM quotation_branch_payments WHERE payment_link_id = $1 LIMIT 1`,
    [paymentLinkId],
  );
  if (branchRows[0]?.quotation_id) {
    return {
      quotationId: branchRows[0].quotation_id,
      billingBranchId: branchRows[0].billing_branch_id,
    };
  }

  return null;
}

export async function updatePaymentPartial(runner: any, quotationId: any) {
  const { rows } = await runnerQuery(runner).query(
    `UPDATE payments SET status = 'partial', failure_reason = NULL, updated_at = NOW()
     WHERE quotation_id = $1 AND status IN ('pending', 'partial', 'reported', 'failed')
     RETURNING *`,
    [quotationId],
  );
  return rows[0] || null;
}

export async function updateWelcomeEmailDelivery(runner: any, values: any) {
  const [quotationId, status, lastError, incrementAttempts] = values;
  const { rows } = await runnerQuery(runner).query(
    `UPDATE payments SET
       welcome_email_status = $2::varchar,
       welcome_email_sent_at = CASE WHEN $2::text = 'sent' THEN NOW() ELSE welcome_email_sent_at END,
       welcome_email_last_error = $3::text,
       welcome_email_attempts = COALESCE(welcome_email_attempts, 0) + CASE WHEN $4 THEN 1 ELSE 0 END,
       updated_at = NOW()
     WHERE quotation_id = $1
     RETURNING *`,
    [quotationId, status, lastError, Boolean(incrementAttempts)],
  );
  return rows[0] || null;
}

export async function updateFinanceAlertDelivery(runner: any, values: any) {
  const [quotationId, status, lastError, incrementAttempts] = values;
  const { rows } = await runnerQuery(runner).query(
    `UPDATE payments SET
       finance_alert_status = $2::varchar,
       finance_alert_sent_at = CASE WHEN $2::text = 'sent' THEN NOW() ELSE finance_alert_sent_at END,
       finance_alert_last_error = $3::text,
       finance_alert_attempts = COALESCE(finance_alert_attempts, 0) + CASE WHEN $4 THEN 1 ELSE 0 END,
       updated_at = NOW()
     WHERE quotation_id = $1
     RETURNING *`,
    [quotationId, status, lastError, Boolean(incrementAttempts)],
  );
  return rows[0] || null;
}

export async function updateInternalCredentialsDelivery(runner: any, values: any) {
  const [quotationId, status, lastError] = values;
  const { rows } = await runnerQuery(runner).query(
    `UPDATE payments SET
       internal_credentials_status = $2::varchar,
       internal_credentials_sent_at = CASE WHEN $2::text = 'sent' THEN NOW() ELSE internal_credentials_sent_at END,
       internal_credentials_last_error = $3::text,
       updated_at = NOW()
     WHERE quotation_id = $1
     RETURNING *`,
    [quotationId, status, lastError],
  );
  return rows[0] || null;
}

export async function selectOverdueReportedPayments(runner: any, slaHours: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT p.quotation_id, p.payment_reported_at, q.lead_snapshot
     FROM payments p
     JOIN quotations q ON q.id = p.quotation_id
     WHERE p.status = 'reported'
       AND p.payment_reported_at IS NOT NULL
       AND p.payment_reported_at < NOW() - ($1::text || ' hours')::interval
     ORDER BY p.payment_reported_at ASC`,
    [String(slaHours)],
  );
  return rows;
}
