import { createClient } from "@clickhouse/client";
import fp from "fastify-plugin";
import { env } from "../config/env.js";
import { normalizeRowDatetimes, normalizeRowsDatetimes } from "../utils/datetime.js";
export const clickhousePlugin = fp(async function clickhousePlugin(app) {
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
export async function chQuery(client, sql, params = {}) {
    const result = await client.query({ query: sql, query_params: params, format: "JSONEachRow" });
    const rows = await result.json();
    return normalizeRowsDatetimes(rows);
}
export async function chQueryOne(client, sql, params = {}) {
    const rows = await chQuery(client, sql, params);
    return rows[0] ?? null;
}
export { normalizeRowDatetimes, normalizeRowsDatetimes };
