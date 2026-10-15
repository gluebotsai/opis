import { pool } from "../db/pool.js";
import { processScheduledCancellations as executeScheduledCancellations } from "../branchLifecycle.js";

export async function processScheduledCancellations(client = null) {
  const runner = client || pool;
  return executeScheduledCancellations(runner);
}
