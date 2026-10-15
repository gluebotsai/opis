import { query } from "../../db/pool.js";

const SETTINGS_ID = "default";

function runnerQuery(runner: any) {
  if (typeof runner?.query === "function") {
    return runner;
  }
  return query;
}

export async function selectInvoiceSettings(runner: any = null) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM invoice_company_settings WHERE id = $1`,
    [SETTINGS_ID],
  );
  return rows[0] || null;
}

export async function ensureDefaultInvoiceSettings(runner: any = null) {
  const currentYear = new Date().getFullYear();
  await runnerQuery(runner).query(
    `INSERT INTO invoice_company_settings (id, invoice_prefix, series_year, next_sequence)
     VALUES ($1, 'WIPL', $2, 1)
     ON CONFLICT (id) DO NOTHING`,
    [SETTINGS_ID, currentYear],
  );
  return selectInvoiceSettings(runner);
}

export async function updateInvoiceSettings(
  runner: any,
  {
    invoicePrefix,
    nextSequence,
    seriesYear,
    accountName,
    bankName,
    accountNumber,
    ifsc,
    branch,
    purchaseCutoffDay,
  }: {
    invoicePrefix?: string;
    nextSequence?: number;
    seriesYear?: number | null;
    accountName?: string;
    bankName?: string;
    accountNumber?: string;
    ifsc?: string;
    branch?: string;
    purchaseCutoffDay?: number | null;
  },
) {
  await ensureDefaultInvoiceSettings(runner);
  const { rows } = await runnerQuery(runner).query(
    `UPDATE invoice_company_settings SET
      invoice_prefix = COALESCE($2, invoice_prefix),
      next_sequence = COALESCE($3, next_sequence),
      series_year = COALESCE($4, series_year),
      account_name = COALESCE($5, account_name),
      bank_name = COALESCE($6, bank_name),
      account_number = COALESCE($7, account_number),
      ifsc = COALESCE($8, ifsc),
      branch = COALESCE($9, branch),
      purchase_cutoff_day = COALESCE($10, purchase_cutoff_day),
      updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [
      SETTINGS_ID,
      invoicePrefix ?? null,
      nextSequence ?? null,
      seriesYear ?? null,
      accountName ?? null,
      bankName ?? null,
      accountNumber ?? null,
      ifsc ?? null,
      branch ?? null,
      purchaseCutoffDay ?? null,
    ],
  );
  return rows[0] || null;
}

/**
 * Atomically allocate the next invoice number for the current calendar year.
 * Resets the series when the year rolls over.
 */
export async function allocateNextInvoiceNumber(client: any) {
  const runner = runnerQuery(client);
  const currentYear = new Date().getFullYear();

  await runner.query(
    `INSERT INTO invoice_company_settings (id, invoice_prefix, series_year, next_sequence)
     VALUES ($1, 'WIPL', $2, 1)
     ON CONFLICT (id) DO NOTHING`,
    [SETTINGS_ID, currentYear],
  );

  const { rows } = await runner.query(
    `SELECT * FROM invoice_company_settings WHERE id = $1 FOR UPDATE`,
    [SETTINGS_ID],
  );
  const row = rows[0];
  if (!row) {
    throw new Error("Invoice company settings row is missing.");
  }

  let seriesYear = row.series_year == null ? currentYear : Number(row.series_year);
  let nextSequence = Math.max(1, Number(row.next_sequence) || 1);
  if (seriesYear !== currentYear) {
    seriesYear = currentYear;
    nextSequence = 1;
  }

  const prefix = String(row.invoice_prefix || "WIPL").trim() || "WIPL";
  const invoiceNumber = `${prefix}-${seriesYear}-${nextSequence}`;

  await runner.query(
    `UPDATE invoice_company_settings SET
      series_year = $2,
      next_sequence = $3,
      updated_at = NOW()
     WHERE id = $1`,
    [SETTINGS_ID, seriesYear, nextSequence + 1],
  );

  return {
    invoiceNumber,
    prefix,
    year: seriesYear,
    sequence: nextSequence,
  };
}
