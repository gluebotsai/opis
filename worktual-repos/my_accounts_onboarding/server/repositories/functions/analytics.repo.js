import { pool } from "../../db/pool.js";
import { callDbFunction, resolveQueryRunner } from "../../db/routines.js";

function runnerOrPool(runner) {
  return runner ? resolveQueryRunner(runner) : pool;
}

export async function selectLeadStatusCounts(runner = null, createdByUserId = null) {
  const { rows } = await callDbFunction(runnerOrPool(runner), "fn_lead_status_counts", [
    createdByUserId,
  ]);
  return rows.map((row) => ({ status: row.status, count: row.count }));
}
