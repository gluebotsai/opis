import { type ClickHouseClient } from "@clickhouse/client";
import type { FastifyInstance } from "fastify";
import { normalizeRowDatetimes, normalizeRowsDatetimes } from "../utils/datetime.js";
export type { ClickHouseClient };
declare module "fastify" {
    interface FastifyInstance {
        clickhouse: ClickHouseClient;
    }
}
export declare const clickhousePlugin: (app: FastifyInstance) => Promise<void>;
export type Row = Record<string, unknown>;
export declare function chQuery(client: ClickHouseClient, sql: string, params?: Record<string, unknown>): Promise<Row[]>;
export declare function chQueryOne(client: ClickHouseClient, sql: string, params?: Record<string, unknown>): Promise<Row | null>;
export { normalizeRowDatetimes, normalizeRowsDatetimes };
