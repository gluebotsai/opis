import type { Row } from "../plugins/clickhouse.js";
/** ClickHouse DateTime64 values are UTC but often serialize without a timezone suffix. */
export declare function clickHouseUtcToIso(value: unknown): unknown;
export declare function normalizeRowDatetimes(row: Row): Row;
export declare function normalizeRowsDatetimes(rows: Row[]): Row[];
