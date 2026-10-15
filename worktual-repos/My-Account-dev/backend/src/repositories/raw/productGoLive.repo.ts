function runnerQuery(runner: any) {
  if (typeof runner?.query === "function") {
    return runner;
  }
  throw new Error("A database client or pool is required.");
}

export async function upsertProductGoLive(runner: any, values: any) {
  const [
    organizationId,
    leadId,
    productId,
    branchId,
    billingBranchId,
    lifecycleStatus,
    otcQuotationId,
    subscriptionId,
    uatExpiresAt,
  ] = values;

  const { rows } = await runnerQuery(runner).query(
    `INSERT INTO product_go_live (
       organization_id, lead_id, product_id, branch_id, billing_branch_id,
       lifecycle_status, otc_quotation_id, subscription_id, uat_expires_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (organization_id, product_id, branch_id)
     DO UPDATE SET
       lead_id = EXCLUDED.lead_id,
       billing_branch_id = EXCLUDED.billing_branch_id,
       lifecycle_status = EXCLUDED.lifecycle_status,
       otc_quotation_id = COALESCE(EXCLUDED.otc_quotation_id, product_go_live.otc_quotation_id),
       subscription_id = COALESCE(EXCLUDED.subscription_id, product_go_live.subscription_id),
       uat_expires_at = COALESCE(EXCLUDED.uat_expires_at, product_go_live.uat_expires_at),
       updated_at = NOW()
     RETURNING *`,
    [
      organizationId,
      leadId,
      productId,
      branchId,
      billingBranchId,
      lifecycleStatus,
      otcQuotationId,
      subscriptionId,
      uatExpiresAt,
    ],
  );
  return rows[0] || null;
}

export async function selectGoLiveByLead(runner: any, leadId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM product_go_live WHERE lead_id = $1 ORDER BY updated_at DESC`,
    [leadId],
  );
  return rows;
}

export async function selectGoLiveByOrganization(runner: any, organizationId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM product_go_live WHERE organization_id = $1 ORDER BY updated_at DESC`,
    [organizationId],
  );
  return rows;
}

export async function selectGoLiveById(runner: any, id: any) {
  const { rows } = await runnerQuery(runner).query(`SELECT * FROM product_go_live WHERE id = $1`, [
    id,
  ]);
  return rows[0] || null;
}

export async function selectGoLiveByProduct(runner: any, organizationId: any, productId: any, branchId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM product_go_live
     WHERE organization_id = $1 AND product_id = $2 AND branch_id = $3`,
    [organizationId, productId, branchId],
  );
  return rows[0] || null;
}

export async function updateGoLiveUat(runner: any, values: any) {
  const [id, lifecycleStatus, uatExpiresAt, credentialsJson, incrementExtend] = values;
  // Explicit casts avoid Postgres "inconsistent types deduced for parameter $N"
  // (boolean CASE, timestamptz, jsonb). Always clear change_request_note on UAT send/extend.
  const { rows } = await runnerQuery(runner).query(
    `UPDATE product_go_live SET
       lifecycle_status = $2::text,
       uat_expires_at = $3::timestamptz,
       uat_credentials = COALESCE($4::jsonb, uat_credentials),
       uat_extended_count = uat_extended_count + CASE WHEN $5::boolean THEN 1 ELSE 0 END,
       change_request_note = NULL,
       updated_at = NOW()
     WHERE id = $1::uuid
     RETURNING *`,
    [id, lifecycleStatus, uatExpiresAt, credentialsJson, Boolean(incrementExtend)],
  );
  return rows[0] || null;
}

export async function updateGoLiveAccepted(runner: any, values: any) {
  const [id, goLiveQuotationId] = values;
  const { rows } = await runnerQuery(runner).query(
    `UPDATE product_go_live SET
       lifecycle_status = 'awaiting_subscription_payment',
       accepted_at = NOW(),
       go_live_quotation_id = $2,
       updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, goLiveQuotationId],
  );
  return rows[0] || null;
}

export async function updateGoLivePaid(runner: any, id: any) {
  const { rows } = await runnerQuery(runner).query(
    `UPDATE product_go_live SET
       lifecycle_status = 'live',
       go_live_paid_at = NOW(),
       uat_expires_at = NULL,
       updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id],
  );
  return rows[0] || null;
}

export async function updateGoLiveChangeRequest(runner: any, id: any, note: any) {
  const { rows } = await runnerQuery(runner).query(
    `UPDATE product_go_live SET
       change_request_note = $2,
       updated_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [id, note],
  );
  return rows[0] || null;
}

export async function expireDueUatRows(runner: any, asOf: any = new Date()) {
  const { rows } = await runnerQuery(runner).query(
    `UPDATE product_go_live SET
       lifecycle_status = 'uat_expired',
       updated_at = NOW()
     WHERE lifecycle_status = 'uat'
       AND uat_expires_at IS NOT NULL
       AND uat_expires_at < $1
     RETURNING *`,
    [asOf.toISOString()],
  );
  return rows;
}

export async function selectGoLiveByQuotation(runner: any, quotationId: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM product_go_live
     WHERE otc_quotation_id = $1 OR go_live_quotation_id = $1`,
    [quotationId],
  );
  return rows;
}
