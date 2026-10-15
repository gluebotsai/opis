/**
 * Call PostgreSQL functions (fn_*) and procedures (sp_*).
 * Domain modules should use repositories where possible; repositories call this layer.
 */
import type { QueryResult, QueryResultRow } from "pg";

export interface QueryRunner {
  query<T extends QueryResultRow = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<QueryResult<T>>;
}

type QueryFunction = QueryRunner["query"];

export async function callDbFunction<T extends QueryResultRow = Record<string, unknown>>(
  runner: QueryRunner,
  name: string,
  params: unknown[] = [],
): Promise<QueryResult<T>> {
  const placeholders = params.map((_: any, index: any) => `$${index + 1}`).join(", ");
  const sql = `SELECT * FROM ${name}(${placeholders})`;
  return runner.query(sql, params);
}

export async function callDbFunctionScalar(
  runner: QueryRunner,
  name: string,
  params: unknown[] = [],
): Promise<unknown> {
  const { rows } = await callDbFunction(runner, name, params);
  if (!rows.length) {
    return null;
  }

  const firstRow = rows[0];
  if (!firstRow) {
    return null;
  }
  const values = Object.values(firstRow);
  return values.length === 1 ? values[0] : firstRow;
}

/** PostgreSQL void functions (RETURNS VOID) */
export async function callDbVoidFunction(
  runner: QueryRunner,
  name: string,
  params: unknown[] = [],
): Promise<void> {
  const placeholders = params.map((_: any, index: any) => `$${index + 1}`).join(", ");
  await runner.query(`SELECT ${name}(${placeholders})`, params);
}

export async function callDbProcedure(
  runner: QueryRunner,
  name: string,
  params: unknown[] = [],
): Promise<void> {
  const placeholders = params.map((_: any, index: any) => `$${index + 1}`).join(", ");
  await runner.query(`CALL ${name}(${placeholders})`, params);
}

export function resolveQueryRunner(runner: QueryRunner | QueryFunction | null | undefined): QueryRunner {
  if (!runner) {
    throw new Error("Database runner is required.");
  }

  if (typeof runner === "object" && typeof runner.query === "function") {
    return runner;
  }

  if (typeof runner === "function") {
    return { query: runner };
  }

  throw new Error("Invalid database runner.");
}
