# Connector configuration notes

Three settings here are load-bearing and are NOT free to change.

## `decimal.handling.mode: string`  (spec said `double`)

`double` loses precision. This platform has BFSI tenants, so NUMERIC columns
holding money would silently round. `string` hands the exact decimal to the
consumer, which converts it to integer minor units at the scale declared in the
mapping. See README "How money is stored".

## `time.precision.mode: adaptive`  (spec said `connect`)

`connect` maps to Kafka Connect logical types, which are MILLISECOND resolution.
PostgreSQL `timestamp(6)` is microsecond. Under `connect`, every timestamp is
truncated by three digits on the way in -- invisible until someone tries to order
two events inside the same millisecond in an audit trail. `adaptive` emits
`io.debezium.time.MicroTimestamp`; Neo4j temporals hold nanoseconds, so nothing
is lost downstream.

## `value.converter.schemas.enable: true`

The coercion layer is driven by the Debezium value schema. Without it, a
MicroTimestamp is indistinguishable from an ordinary bigint and coercion degrades
to guesswork. This roughly doubles message size. Someone will eventually propose
turning it off as an optimisation; that change silently breaks every temporal and
decimal column.

## `table.include.list` is an explicit allowlist

Do not sync every table. Audit logs, session tokens, job queues and framework
tables do not belong in a knowledge graph and slow every traversal.

## One connector per PHYSICAL DATABASE, never per organisation

Schemas within one PostgreSQL database share a single connector and a single
replication slot.

## REPLICA IDENTITY

Set `REPLICA IDENTITY FULL` on every synced table. This is not a TOAST
optimisation -- under DEFAULT, a DELETE's before-image carries only primary-key
columns, `tenant_id` is absent, and every delete is quarantined.
`python main.py preflight` verifies this and fails the process.
