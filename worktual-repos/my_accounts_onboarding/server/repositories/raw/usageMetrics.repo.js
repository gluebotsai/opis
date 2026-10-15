function runnerQuery(runner) {
  if (typeof runner?.query === "function") {
    return runner;
  }
  throw new Error("A database client or pool is required.");
}

export async function upsertUsageMetric(runner, values) {
  await runnerQuery(runner).query(
    `INSERT INTO usage_metrics (
      subscription_id, metric_key, allocated, consumed, unit, period_start, period_end
    ) VALUES ($1, $2, $3, 0, $4, $5, $6)
    ON CONFLICT (subscription_id, metric_key, period_start) DO UPDATE SET
      allocated = EXCLUDED.allocated,
      unit = EXCLUDED.unit,
      period_end = EXCLUDED.period_end,
      updated_at = NOW()`,
    values,
  );
}

export async function selectUsageMetricsBySubscription(runner, subscriptionId) {
  const { rows } = await runnerQuery(runner).query(
    `SELECT * FROM usage_metrics
     WHERE subscription_id = $1
     ORDER BY period_start DESC, metric_key`,
    [subscriptionId],
  );
  return rows;
}

export async function updateUsageConsumption(runner, subscriptionId, metricKey, consumed, periodStart) {
  const { rows } = await runnerQuery(runner).query(
    `UPDATE usage_metrics
     SET consumed = $3, updated_at = NOW()
     WHERE subscription_id = $1 AND metric_key = $2 AND period_start = $4
     RETURNING *`,
    [subscriptionId, metricKey, consumed, periodStart],
  );
  return rows[0] || null;
}

export async function insertUsageConsumption(runner, subscriptionId, metricKey, consumed, periodStart, periodEnd) {
  const { rows } = await runnerQuery(runner).query(
    `INSERT INTO usage_metrics (
      subscription_id, metric_key, allocated, consumed, unit, period_start, period_end
    ) VALUES ($1, $2, 0, $3, 'count', $4, $5)
    RETURNING *`,
    [subscriptionId, metricKey, consumed, periodStart, periodEnd],
  );
  return rows[0] || null;
}
