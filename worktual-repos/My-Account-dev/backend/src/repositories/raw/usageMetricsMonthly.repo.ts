function runnerQuery(runner: any) {
  if (typeof runner?.query === "function") {
    return runner;
  }
  throw new Error("A database client or pool is required.");
}

export async function insertUsageMetricsMonthly(runner: any, values: any) {
  const [
    subscriptionId,
    organizationId,
    productId,
    branchId,
    yearMonth,
    metricKey,
    allocated,
    consumed,
    unit,
    snapshot,
  ] = values;

  const { rows } = await runnerQuery(runner).query(
    `INSERT INTO usage_metrics_monthly (
       subscription_id, organization_id, product_id, branch_id, year_month,
       metric_key, allocated, consumed, unit, snapshot, closed_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb, NOW())
     ON CONFLICT (subscription_id, metric_key, year_month)
     DO UPDATE SET
       allocated = EXCLUDED.allocated,
       consumed = EXCLUDED.consumed,
       unit = EXCLUDED.unit,
       snapshot = EXCLUDED.snapshot,
       closed_at = NOW()
     RETURNING *`,
    [
      subscriptionId,
      organizationId,
      productId,
      branchId,
      yearMonth,
      metricKey,
      allocated,
      consumed,
      unit,
      JSON.stringify(snapshot || {}),
    ],
  );
  return rows[0] || null;
}

export async function selectCurrentUsageMetricsForArchive(runner: any) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT um.*, s.organization_id, s.product_id, s.branch_id
     FROM usage_metrics um
     INNER JOIN subscriptions s ON s.id = um.subscription_id
     WHERE s.status = 'active'`,
  );
  return rows;
}

export async function resetUsageConsumed(runner: any, subscriptionId: any, periodStart: any, periodEnd: any) {
  await runnerQuery(runner).query(
    `UPDATE usage_metrics
     SET consumed = 0,
         period_start = $2,
         period_end = $3,
         updated_at = NOW()
     WHERE subscription_id = $1`,
    [subscriptionId, periodStart, periodEnd],
  );
}
