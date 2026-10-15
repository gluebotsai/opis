function runnerQuery(runner) {
  if (typeof runner?.query === "function") {
    return runner;
  }
  throw new Error("A database client or pool is required.");
}

export async function selectQuoteSession(runner, leadId) {
  const { rows } = await runnerQuery(runner).query(`SELECT * FROM quote_sessions WHERE lead_id = $1`, [
    leadId,
  ]);
  return rows[0] || null;
}

export async function upsertQuoteSession(runner, leadId, values) {
  const { rows } = await runnerQuery(runner).query(
    `INSERT INTO quote_sessions (
      lead_id, lead_snapshot, file_name, pdf_base64, assignments, product_summary,
      invoices, invoice_mode, branch_summary, created_at, updated_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())
    ON CONFLICT (lead_id) DO UPDATE SET
      lead_snapshot = EXCLUDED.lead_snapshot,
      file_name = EXCLUDED.file_name,
      pdf_base64 = EXCLUDED.pdf_base64,
      assignments = EXCLUDED.assignments,
      product_summary = EXCLUDED.product_summary,
      invoices = EXCLUDED.invoices,
      invoice_mode = EXCLUDED.invoice_mode,
      branch_summary = EXCLUDED.branch_summary,
      updated_at = NOW()
    RETURNING *`,
    values,
  );
  return rows[0] || null;
}

export async function deleteQuoteSession(runner, leadId) {
  await runnerQuery(runner).query(`DELETE FROM quote_sessions WHERE lead_id = $1`, [leadId]);
}
