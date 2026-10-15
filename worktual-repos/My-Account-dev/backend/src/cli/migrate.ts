import "../config/load-env.js";

import { migrateDatabase } from "../db/migrate.js";
import { pool } from "../db/pool.js";

try {
  await migrateDatabase();
  console.log("[db] Migration completed.");
} catch (error) {
  console.error("[db] Migration failed:", error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
