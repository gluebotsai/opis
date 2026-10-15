import { pool } from "../../db/pool.js";
import { callDbFunction, resolveQueryRunner } from "../../db/routines.js";

function runnerOrPool(runner: any) {
  return runner ? resolveQueryRunner(runner) : pool;
}

export async function selectLeadStatusCounts(runner: any = null, createdByUserId: any = null) {
  const { rows } = await callDbFunction(runnerOrPool(runner), "fn_lead_status_counts", [
    createdByUserId,
  ]);
  return rows.map((row: any) => ({ status: row.status, count: row.count }));
}
