import { pool } from "../../db/pool.js";
import { processScheduledCancellations as executeScheduledCancellations } from "../branch-requests/lifecycle.js";

export async function processScheduledCancellations(client = null) {
  const runner = client || pool;
  return executeScheduledCancellations(runner);
}
