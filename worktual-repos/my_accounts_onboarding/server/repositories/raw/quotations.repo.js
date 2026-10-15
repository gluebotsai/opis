function runnerQuery(runner) {
  if (typeof runner?.query === "function") {
    return runner;
  }
  throw new Error("A database client or pool is required.");
}

export async function selectAssignmentsByQuotation(runner, quotationId) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM product_assignments WHERE quotation_id = $1`,
    [quotationId],
  );
  return rows;
}

export async function selectProductSummaryByQuotation(runner, quotationId) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM product_summary_items WHERE quotation_id = $1 ORDER BY id`,
    [quotationId],
  );
  return rows;
}

export async function selectInvoicesByQuotation(runner, quotationId) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM quotation_invoices WHERE quotation_id = $1 ORDER BY id`,
    [quotationId],
  );
  return rows;
}

export async function selectPaymentByQuotation(runner, quotationId) {
  const { rows } = await runnerQuery(runner).query(`SELECT * FROM payments WHERE quotation_id = $1`, [
    quotationId,
  ]);
  return rows[0] || null;
}

export async function upsertActiveProduct(runner, values) {
  await runnerQuery(runner).query(
    `INSERT INTO active_products (
      key, lead_id, product_id, branch_id, billing_target_id, change_type, config,
      implementation_purchased, price_label, quotation_id, approved_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    ON CONFLICT (key) DO UPDATE SET
      lead_id = EXCLUDED.lead_id,
      product_id = EXCLUDED.product_id,
      branch_id = EXCLUDED.branch_id,
      billing_target_id = EXCLUDED.billing_target_id,
      change_type = EXCLUDED.change_type,
      config = EXCLUDED.config,
      implementation_purchased = EXCLUDED.implementation_purchased,
      price_label = EXCLUDED.price_label,
      quotation_id = EXCLUDED.quotation_id,
      approved_at = EXCLUDED.approved_at`,
    values,
  );
}

export async function selectQuotationById(runner, quotationId) {
  const { rows } = await runnerQuery(runner).query(`SELECT * FROM quotations WHERE id = $1`, [
    quotationId,
  ]);
  return rows[0] || null;
}

export async function countActiveProductsForQuotation(runner, quotationId, leadId) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT COUNT(*)::int AS count
     FROM active_products
     WHERE quotation_id = $1 AND lead_id = $2`,
    [quotationId, leadId],
  );
  return rows[0]?.count || 0;
}

export async function selectAllQuotations(runner) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM quotations ORDER BY submitted_at DESC NULLS LAST`,
  );
  return rows;
}

export async function selectQuotationStatusRows(runner) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT DISTINCT ON (lead_id)
      q.id AS quotation_id,
      q.lead_id,
      q.status,
      q.finance_note,
      q.reviewed_at,
      q.reviewed_by,
      q.submitted_at,
      p.grand_total,
      p.currency,
      pay.payment_link_url,
      pay.grand_total AS payment_grand_total,
      pay.currency AS payment_currency,
      pay.status AS payment_status,
      pay.paid_at AS payment_paid_at
     FROM quotations q
     LEFT JOIN quotations p ON p.id = q.id
     LEFT JOIN payments pay ON pay.quotation_id = q.id
     ORDER BY lead_id, submitted_at DESC NULLS LAST`,
  );
  return rows;
}

export async function selectActiveProductsByLead(runner, leadId) {
  const { rows } = await runnerQuery(runner).query(`SELECT * FROM active_products WHERE lead_id = $1`, [
    leadId,
  ]);
  return rows;
}

export async function selectApprovedQuotationWithPayment(runner, leadId, statuses) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT q.*
     FROM quotations q
     INNER JOIN payments p ON p.quotation_id = q.id
     WHERE q.lead_id = $1 AND q.status = ANY($2::text[])
     ORDER BY q.submitted_at DESC NULLS LAST
     LIMIT 1`,
    [leadId, statuses],
  );
  return rows[0] || null;
}

export async function selectDuplicateQuotation(runner, leadId, fileName, pdfBase64) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT id FROM quotations
     WHERE lead_id = $1 AND file_name = $2 AND pdf_base64 = $3
     LIMIT 1`,
    [leadId, fileName, pdfBase64],
  );
  return rows[0] || null;
}

export async function insertQuotation(runner, values) {
  const { rows } = await runnerQuery(runner).query(
    `INSERT INTO quotations (
      id, lead_id, lead_snapshot, file_name, pdf_base64, invoice_mode, branch_summary,
      subtotal, grand_total, currency, gst_rate, status, finance_note, submitted_by, submitted_at, version
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'',$13,$14,1)
    RETURNING *`,
    values,
  );
  return rows[0] || null;
}

export async function insertProductAssignment(runner, values) {
  await runnerQuery(runner).query(
    `INSERT INTO product_assignments (
      id, quotation_id, lead_id, product_id, branch_id, billing_target_id, change_type, config
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    values,
  );
}

export async function insertProductSummaryItem(runner, values) {
  await runnerQuery(runner).query(
    `INSERT INTO product_summary_items (
      quotation_id, product_id, name, price_label, branch_label, billing_label, change_type_label
    ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    values,
  );
}

export async function insertQuotationInvoice(runner, values) {
  await runnerQuery(runner).query(
    `INSERT INTO quotation_invoices (
      quotation_id, file_name, pdf_base64, billing_target_id, branch_label, subtotal, grand_total
    ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    values,
  );
}

export async function upsertPayment(runner, values) {
  await runnerQuery(runner).query(
    `INSERT INTO payments (
      quotation_id, provider, payment_link_url, payment_link_id, subtotal, grand_total,
      currency, gst_rate, amount_label, status, dry_run, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())
    ON CONFLICT (quotation_id) DO UPDATE SET
      provider = EXCLUDED.provider,
      payment_link_url = EXCLUDED.payment_link_url,
      payment_link_id = EXCLUDED.payment_link_id,
      subtotal = EXCLUDED.subtotal,
      grand_total = EXCLUDED.grand_total,
      currency = EXCLUDED.currency,
      gst_rate = EXCLUDED.gst_rate,
      amount_label = EXCLUDED.amount_label,
      status = CASE
        WHEN payments.status = 'paid' THEN payments.status
        ELSE EXCLUDED.status
      END,
      dry_run = EXCLUDED.dry_run,
      updated_at = NOW()`,
    values,
  );
}

export async function deleteActiveProductsByQuotation(runner, quotationId) {
  await runnerQuery(runner).query(`DELETE FROM active_products WHERE quotation_id = $1`, [quotationId]);
}
