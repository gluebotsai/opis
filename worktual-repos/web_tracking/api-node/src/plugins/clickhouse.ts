import { createClient, type ClickHouseClient } from "@clickhouse/client";
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";
import { env } from "../config/env.js";
import { normalizeRowDatetimes, normalizeRowsDatetimes } from "../utils/datetime.js";

export type { ClickHouseClient };

declare module "fastify" {
  interface FastifyInstance {
    clickhouse: ClickHouseClient;
  }
}

export const clickhousePlugin = fp(async function clickhousePlugin(app: FastifyInstance) {
  const client = createClient({
    url: `http://${env.CLICKHOUSE_HOST}:${env.CLICKHOUSE_PORT}`,
    username: env.CLICKHOUSE_USER,
    password: env.CLICKHOUSE_PASSWORD,
    database: env.CLICKHOUSE_DATABASE,
  });
  app.decorate("clickhouse", client);
  app.addHook("onClose", async () => {
    await client.close();
  });
});

export type Row = Record<string, unknown>;

export async function chQuery(client: ClickHouseClient, sql: string, params: Record<string, unknown> = {}): Promise<Row[]> {
  const result = await client.query({ query: sql, query_params: params, format: "JSONEachRow" });
  const rows = await result.json<Row>();
  return normalizeRowsDatetimes(rows);
}

export async function chQueryOne(client: ClickHouseClient, sql: string, params: Record<string, unknown> = {}): Promise<Row | null> {
  const rows = await chQuery(client, sql, params);
  return rows[0] ?? null;
}

export { normalizeRowDatetimes, normalizeRowsDatetimes };
