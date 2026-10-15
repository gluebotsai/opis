/**
 * Call PostgreSQL functions (fn_*) and procedures (sp_*).
 * Domain modules should use repositories where possible; repositories call this layer.
 */

export async function callDbFunction(runner, name, params = []) {
  const placeholders = params.map((_, index) => `$${index + 1}`).join(", ");
  const sql = `SELECT * FROM ${name}(${placeholders})`;
  return runner.query(sql, params);
}

export async function callDbFunctionScalar(runner, name, params = []) {
  const { rows } = await callDbFunction(runner, name, params);
  if (!rows.length) {
    return null;
  }

  const firstRow = rows[0];
  const values = Object.values(firstRow);
  return values.length === 1 ? values[0] : firstRow;
}

/** PostgreSQL void functions (RETURNS VOID) */
export async function callDbVoidFunction(runner, name, params = []) {
  const placeholders = params.map((_, index) => `$${index + 1}`).join(", ");
  await runner.query(`SELECT ${name}(${placeholders})`, params);
}

export async function callDbProcedure(runner, name, params = []) {
  const placeholders = params.map((_, index) => `$${index + 1}`).join(", ");
  await runner.query(`CALL ${name}(${placeholders})`, params);
}

export function resolveQueryRunner(runner) {
  if (!runner) {
    throw new Error("Database runner is required.");
  }

  if (typeof runner.query === "function") {
    return runner;
  }

  if (typeof runner === "function") {
    return { query: runner };
  }

  throw new Error("Invalid database runner.");
}
