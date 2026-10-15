function runnerQuery(runner: any) {
  if (typeof runner?.query === "function") {
    return runner;
  }
  throw new Error("A database client or pool is required.");
}

export async function selectAssignmentsByQuotation(runner: any, quotationId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM product_assignments WHERE quotation_id = $1`,
    [quotationId],
  );
  return rows;
}

export async function selectProductSummaryByQuotation(runner: any, quotationId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM product_summary_items WHERE quotation_id = $1 ORDER BY id`,
    [quotationId],
  );
  return rows;
}

export async function selectInvoicesByQuotation(runner: any, quotationId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM quotation_invoices WHERE quotation_id = $1 ORDER BY id`,
    [quotationId],
  );
  return rows;
}

/** Invoice metadata without pdf_base64. */
export async function selectInvoicesByQuotationForList(runner: any, quotationId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT
       id,
       quotation_id,
       file_name,
       billing_branch_id,
       branch_label,
       subtotal,
       grand_total,
       (pdf_base64 IS NOT NULL AND btrim(pdf_base64) <> '') AS has_pdf
     FROM quotation_invoices
     WHERE quotation_id = $1
     ORDER BY id`,
    [quotationId],
  );
  return rows;
}

export async function selectPaymentByQuotation(runner: any, quotationId: any) {
  const { rows } = await runnerQuery(runner).query(`SELECT * FROM payments WHERE quotation_id = $1`, [
    quotationId,
  ]);
  return rows[0] || null;
}

export async function upsertActiveProduct(runner: any, values: any) {
  await runnerQuery(runner).query(
    `INSERT INTO active_products (
      key, lead_id, product_id, branch_id, billing_branch_id, change_type, config,
      implementation_purchased, price_label, quotation_id, approved_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
    ON CONFLICT (key) DO UPDATE SET
      lead_id = EXCLUDED.lead_id,
      product_id = EXCLUDED.product_id,
      branch_id = EXCLUDED.branch_id,
      billing_branch_id = EXCLUDED.billing_branch_id,
      change_type = EXCLUDED.change_type,
      config = EXCLUDED.config,
      implementation_purchased = EXCLUDED.implementation_purchased,
      price_label = EXCLUDED.price_label,
      quotation_id = EXCLUDED.quotation_id,
      approved_at = EXCLUDED.approved_at`,
    values,
  );
}

export async function selectQuotationById(runner: any, quotationId: any) {
  const { rows } = await runnerQuery(runner).query(`SELECT * FROM quotations WHERE id = $1`, [
    quotationId,
  ]);
  return rows[0] || null;
}

/** All quotations in a finance submission batch for one lead (includes PDF payloads). */
export async function selectQuotationsBySubmissionBatch(runner: any, leadId: any, submissionBatchId: any) {
  if (!submissionBatchId) {
    return [];
  }
  const { rows } = await runnerQuery(runner).query(
    `SELECT *
     FROM quotations
     WHERE lead_id = $1 AND submission_batch_id = $2
     ORDER BY submitted_at ASC NULLS LAST, id ASC`,
    [leadId, submissionBatchId],
  );
  return rows;
}

/** Latest quotation per lead (no PDF payloads). */
export async function selectLatestQuotationsForLeadIds(runner: any, leadIds: any) {
  if (!Array.isArray(leadIds) || leadIds.length === 0) {
    return [];
  }
  const { rows } = await runnerQuery(runner).query(
    `SELECT DISTINCT ON (q.lead_id)
       q.id,
       q.lead_id,
       q.status,
       q.file_name,
       q.grand_total,
       q.subtotal,
       q.currency,
       q.submitted_at,
       q.reviewed_at,
       (q.pdf_base64 IS NOT NULL AND btrim(q.pdf_base64) <> '') AS has_pdf,
       pay.paid_at AS payment_paid_at
     FROM quotations q
     LEFT JOIN payments pay ON pay.quotation_id = q.id
     WHERE q.lead_id = ANY($1::uuid[])
     ORDER BY q.lead_id, q.submitted_at DESC NULLS LAST`,
    [leadIds],
  );
  return rows;
}

/** All quotations for one lead (no PDF payloads). */
export async function selectQuotationsByLeadId(runner: any, leadId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT
       q.id,
       q.lead_id,
       q.status,
       q.file_name,
       q.grand_total,
       q.subtotal,
       q.currency,
       q.submitted_at,
       q.reviewed_at,
       (q.pdf_base64 IS NOT NULL AND btrim(q.pdf_base64) <> '') AS has_pdf,
       pay.paid_at AS payment_paid_at
     FROM quotations q
     LEFT JOIN payments pay ON pay.quotation_id = q.id
     WHERE q.lead_id = $1
     ORDER BY q.submitted_at DESC NULLS LAST`,
    [leadId],
  );
  return rows;
}

/**
 * Customer-portal invoice list rows with resolved billing_branch_id
 * (quotation_invoices → product_assignments → branch_summary → hq).
 * When a quotation has multiple branch PDFs, prefers metadata for `billingBranchId`.
 *
 * `billingBranchIds`: one or more allowed ids for the portal user (strict own-branch).
 * Head-office callers may pass both `"hq"` and the primary location id. Empty / omitted
 * means no rows (never unscoped).
 */
export async function selectQuotationsByLeadIdWithBillingBranch(
  runner: any,
  leadId: any,
  billingBranchIds: any = null,
) {
  const scopedBranches = (
    Array.isArray(billingBranchIds) ? billingBranchIds : [billingBranchIds]
  )
    .map((entry: any) => String(entry || "").trim())
    .filter(Boolean);

  if (!scopedBranches.length) {
    return [];
  }

  const { rows } = await runnerQuery(runner).query(
    `SELECT
       q.id,
       q.lead_id,
       q.status,
       COALESCE(scoped_invoice.file_name, q.file_name) AS file_name,
       COALESCE(scoped_invoice.grand_total, q.grand_total) AS grand_total,
       COALESCE(scoped_invoice.subtotal, q.subtotal) AS subtotal,
       q.currency,
       q.submitted_at,
       q.reviewed_at,
       (
         (q.pdf_base64 IS NOT NULL AND btrim(q.pdf_base64) <> '')
         OR EXISTS (
           SELECT 1
           FROM quotation_invoices qi_pdf
           WHERE qi_pdf.quotation_id = q.id
             AND qi_pdf.pdf_base64 IS NOT NULL
             AND btrim(qi_pdf.pdf_base64) <> ''
             AND COALESCE(NULLIF(TRIM(qi_pdf.billing_branch_id), ''), 'hq') = ANY($2::text[])
         )
       ) AS has_pdf,
       pay.paid_at AS payment_paid_at,
       COALESCE(
         NULLIF(TRIM(scoped_invoice.billing_branch_id), ''),
         NULLIF(TRIM((
           SELECT qi.billing_branch_id
           FROM quotation_invoices qi
           WHERE qi.quotation_id = q.id
             AND COALESCE(NULLIF(TRIM(qi.billing_branch_id), ''), 'hq') = ANY($2::text[])
           ORDER BY qi.id
           LIMIT 1
         )), ''),
         NULLIF(TRIM((
           SELECT COALESCE(NULLIF(TRIM(pa.billing_branch_id), ''), NULLIF(TRIM(pa.branch_id), ''))
           FROM product_assignments pa
           WHERE pa.quotation_id = q.id
             AND COALESCE(
               NULLIF(TRIM(pa.billing_branch_id), ''),
               NULLIF(TRIM(pa.branch_id), ''),
               'hq'
             ) = ANY($2::text[])
           ORDER BY pa.id
           LIMIT 1
         )), ''),
         NULLIF(TRIM(q.branch_summary->>'billingBranchId'), ''),
         'hq'
       ) AS billing_branch_id
     FROM quotations q
     LEFT JOIN payments pay ON pay.quotation_id = q.id
     LEFT JOIN LATERAL (
       SELECT qi.file_name, qi.grand_total, qi.subtotal, qi.billing_branch_id
       FROM quotation_invoices qi
       WHERE qi.quotation_id = q.id
         AND COALESCE(NULLIF(TRIM(qi.billing_branch_id), ''), 'hq') = ANY($2::text[])
       ORDER BY qi.id
       LIMIT 1
     ) scoped_invoice ON TRUE
     WHERE q.lead_id = $1
       AND (
         EXISTS (
           SELECT 1
           FROM quotation_invoices qi
           WHERE qi.quotation_id = q.id
             AND COALESCE(NULLIF(TRIM(qi.billing_branch_id), ''), 'hq') = ANY($2::text[])
         )
         OR (
           NOT EXISTS (SELECT 1 FROM quotation_invoices qi WHERE qi.quotation_id = q.id)
           AND COALESCE(
             NULLIF(TRIM((
               SELECT COALESCE(NULLIF(TRIM(pa.billing_branch_id), ''), NULLIF(TRIM(pa.branch_id), ''))
               FROM product_assignments pa
               WHERE pa.quotation_id = q.id
               ORDER BY pa.id
               LIMIT 1
             )), ''),
             NULLIF(TRIM(q.branch_summary->>'billingBranchId'), ''),
             'hq'
           ) = ANY($2::text[])
         )
       )
     ORDER BY q.submitted_at DESC NULLS LAST`,
    [leadId, scopedBranches],
  );
  return rows;
}

/**
 * Open (non-terminal purchase) quotations for sales dashboard:
 * Pending Finance Review, Approved (awaiting payment), Rejected.
 */
export async function selectOpenQuotationsByLeadId(runner: any, leadId: any, statuses: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT
       q.id,
       q.lead_id,
       q.status,
       q.file_name,
       q.grand_total,
       q.subtotal,
       q.currency,
       q.gst_rate,
       q.finance_note,
       q.billing_phase,
       q.source_product_request_id,
       q.submitted_by,
       q.submitted_at,
       q.reviewed_at,
       q.reviewed_by,
       q.submission_batch_id,
       (q.pdf_base64 IS NOT NULL AND btrim(q.pdf_base64) <> '') AS has_pdf,
       pay.id AS payment_id,
       pay.status AS payment_status,
       pay.payment_link_url,
       pay.grand_total AS payment_grand_total,
       pay.paid_at AS payment_paid_at
     FROM quotations q
     LEFT JOIN payments pay ON pay.quotation_id = q.id
     WHERE q.lead_id = $1
       AND q.status = ANY($2::text[])
     ORDER BY q.submitted_at DESC NULLS LAST`,
    [leadId, statuses],
  );
  return rows;
}

/**
 * Non-rejected quotation scopes for a lead (Pending / Approved / Paid).
 * Used to hide Rejected open quotations that were replaced by a newer quote
 * for the same product request or product+branch.
 */
export async function selectNonRejectedQuotationScopesByLeadId(
  runner: any,
  leadId: any,
  rejectedStatus: any,
) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT
       q.id,
       q.status,
       q.submitted_at,
       q.source_product_request_id,
       pa.product_id,
       pa.branch_id
     FROM quotations q
     LEFT JOIN product_assignments pa ON pa.quotation_id = q.id
     WHERE q.lead_id = $1
       AND q.status <> $2
     ORDER BY q.submitted_at DESC NULLS LAST`,
    [leadId, rejectedStatus],
  );
  return rows;
}

/** Open billing-change quotations for a subscription (pending or approved unpaid). */
export async function selectOpenBillingChangeQuotationsForSubscription(
  runner: any,
  { leadId, subscriptionId, phases, statuses }: any,
) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT DISTINCT q.id, q.status, q.billing_phase, q.submitted_at
     FROM quotations q
     JOIN product_assignments pa ON pa.quotation_id = q.id
     WHERE q.lead_id = $1
       AND q.billing_phase = ANY($2::text[])
       AND q.status = ANY($3::text[])
       AND (
         pa.config->>'subscriptionId' = $4
         OR pa.config->>'subscription_id' = $4
       )
     ORDER BY q.submitted_at DESC NULLS LAST`,
    [leadId, phases, statuses, String(subscriptionId)],
  );
  return rows;
}

/** Subscriptions that have an open billing-change quotation (any lead). */
export async function selectSubscriptionIdsWithOpenBillingChanges(runner: any, { phases, statuses }: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT DISTINCT COALESCE(pa.config->>'subscriptionId', pa.config->>'subscription_id') AS subscription_id
     FROM quotations q
     JOIN product_assignments pa ON pa.quotation_id = q.id
     WHERE q.billing_phase = ANY($1::text[])
       AND q.status = ANY($2::text[])
       AND COALESCE(pa.config->>'subscriptionId', pa.config->>'subscription_id') IS NOT NULL`,
    [phases, statuses],
  );
  return rows.map((row: any) => row.subscription_id).filter(Boolean);
}

/**
 * Latest quotation per product request (by submitted_at, then id).
 * @returns {Promise<Array<{ id: string, status: string, source_product_request_id: string }>>}
 */
export async function selectLatestQuotationsByProductRequestIds(runner: any, requestIds: any) {
  const ids = Array.isArray(requestIds) ? requestIds.filter(Boolean) : [];
  if (!ids.length) {
    return [];
  }

  const { rows } = await runnerQuery(runner).query(
    `SELECT DISTINCT ON (q.source_product_request_id)
       q.id,
       q.status,
       q.source_product_request_id
     FROM quotations q
     WHERE q.source_product_request_id = ANY($1::uuid[])
     ORDER BY q.source_product_request_id,
       q.submitted_at DESC NULLS LAST,
       q.id DESC`,
    [ids],
  );
  return rows;
}

export async function countActiveProductsForQuotation(runner: any, quotationId: any, leadId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT COUNT(*)::int AS count
     FROM active_products
     WHERE quotation_id = $1 AND lead_id = $2`,
    [quotationId, leadId],
  );
  return rows[0]?.count || 0;
}

/**
 * Quotations awaiting finance approve/reject (same open state as the finance queue).
 * When ownedByUserId is set, scopes to leads the user created or is assigned
 * (same ownership as sales lead lists / product requests). Otherwise all leads.
 * Counts quotations — not lead status — so Paid customers with an
 * open finance-pending quote are included (lead status alone misses those).
 */
export async function countPendingFinanceQuotations(
  runner: any,
  { createdByUserId = null, ownedByUserId = null, pendingStatus }: any = {},
) {
  const scopeUserId = ownedByUserId ?? createdByUserId;
  const { rows } = await runnerQuery(runner).query(
    `SELECT COUNT(*)::int AS count
     FROM quotations q
     JOIN leads l ON l.id = q.lead_id
     WHERE q.status = $1
       AND (
         $2::uuid IS NULL
         OR l.created_by_user_id = $2
         OR l.assigned_user_id = $2
       )`,
    [pendingStatus, scopeUserId],
  );
  return rows[0]?.count || 0;
}

export async function selectAllQuotations(runner: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM quotations ORDER BY submitted_at DESC NULLS LAST`,
  );
  return rows;
}

/** Finance queue list without embedding invoice PDFs. */
export async function selectAllQuotationsForList(runner: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT
       id,
       lead_id,
       lead_snapshot,
       file_name,
       invoice_mode,
       branch_summary,
       subtotal,
       grand_total,
       currency,
       gst_rate,
       status,
       finance_note,
       submitted_by,
       submitted_at,
       reviewed_at,
       reviewed_by,
       version,
       submission_batch_id,
       source_product_request_id,
       billing_phase,
       (pdf_base64 IS NOT NULL AND btrim(pdf_base64) <> '') AS has_pdf
     FROM quotations
     ORDER BY submitted_at DESC NULLS LAST`,
  );
  return rows;
}

export async function selectQuotationStatusRows(runner: any) {
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

export async function selectActiveProductsByLead(runner: any, leadId: any) {
  const { rows } = await runnerQuery(runner).query(`SELECT * FROM active_products WHERE lead_id = $1`, [
    leadId,
  ]);
  return rows;
}

export async function selectApprovedQuotationWithPayment(runner: any, leadId: any, statuses: any) {
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

/**
 * Return every approved/paid quotation (with a payment) that shares the
 * submission batch of the lead's most recent approved/paid quotation.
 */
export async function selectLatestPaidBatchQuotations(runner: any, leadId: any, statuses: any) {
  const { rows } = await runnerQuery(runner).query(
    `WITH latest AS (
       SELECT q.submission_batch_id, q.id, q.submitted_at
       FROM quotations q
       INNER JOIN payments p ON p.quotation_id = q.id
       WHERE q.lead_id = $1 AND q.status = ANY($2::text[])
       ORDER BY q.submitted_at DESC NULLS LAST
       LIMIT 1
     )
     SELECT q.*
     FROM quotations q
     INNER JOIN payments p ON p.quotation_id = q.id
     INNER JOIN latest l
       ON (
         (l.submission_batch_id IS NOT NULL AND q.submission_batch_id = l.submission_batch_id)
         OR (l.submission_batch_id IS NULL AND q.id = l.id)
       )
     WHERE q.lead_id = $1 AND q.status = ANY($2::text[])
     ORDER BY q.submitted_at ASC NULLS LAST`,
    [leadId, statuses],
  );
  return rows;
}

/**
 * Return every approved/paid quotation for a lead whose payment is paid or failed,
 * across all submission batches (renewals, add-ons, per-branch), newest first.
 */
export async function selectPaidQuotations(runner: any, leadId: any, statuses: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT q.*
     FROM quotations q
     INNER JOIN payments p ON p.quotation_id = q.id
     WHERE q.lead_id = $1
       AND q.status = ANY($2::text[])
       AND p.status IN ('paid', 'failed')
     ORDER BY COALESCE(p.paid_at, p.updated_at) DESC NULLS LAST, q.submitted_at DESC NULLS LAST`,
    [leadId, statuses],
  );
  return rows;
}

export async function selectDuplicateQuotation(runner: any, leadId: any, fileName: any, pdfBase64: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT id FROM quotations
     WHERE lead_id = $1 AND file_name = $2 AND pdf_base64 = $3
     LIMIT 1`,
    [leadId, fileName, pdfBase64],
  );
  return rows[0] || null;
}

export async function insertQuotation(runner: any, values: any) {
  const { rows } = await runnerQuery(runner).query(
    `INSERT INTO quotations (
      id, lead_id, lead_snapshot, file_name, pdf_base64, invoice_mode, branch_summary,
      subtotal, grand_total, currency, gst_rate, status, finance_note, submitted_by, submitted_at,
      submission_batch_id, source_product_request_id, version, billing_phase, invoice_number
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'',$13,$14,$15,$16,1,$17,$18)
    RETURNING *`,
    values,
  );
  return rows[0] || null;
}

export async function insertProductAssignment(runner: any, values: any) {
  await runnerQuery(runner).query(
    `INSERT INTO product_assignments (
      id, quotation_id, lead_id, product_id, branch_id, billing_branch_id, change_type, config,
      agent_count, included_number_count, queue_capacity_count, total_number_count
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    values,
  );
}

export async function insertProductSummaryItem(runner: any, values: any) {
  await runnerQuery(runner).query(
    `INSERT INTO product_summary_items (
      quotation_id, product_id, name, price_label, branch_label, billing_label, change_type_label
    ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    values,
  );
}

export async function insertQuotationInvoice(runner: any, values: any) {
  await runnerQuery(runner).query(
    `INSERT INTO quotation_invoices (
      quotation_id, file_name, pdf_base64, billing_branch_id, branch_label, subtotal, grand_total
    ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    values,
  );
}

export async function upsertPayment(runner: any, values: any) {
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

export async function deleteActiveProductsByQuotation(runner: any, quotationId: any) {
  // Never remove payment-confirmed entitlements. Finance revert of an unpaid upgrade
  // can share a product+branch key whose quotation_id was overwritten on approve —
  // deleting those rows would blank purchased products for an already-paid customer.
  await runnerQuery(runner).query(
    `DELETE FROM active_products
     WHERE quotation_id = $1
       AND payment_confirmed_at IS NULL`,
    [quotationId],
  );
}
