import assert from "node:assert/strict";
import test from "node:test";

import type { DbClient } from "../lib/rls.js";
import {
  claimTransferActionOperation,
  getTransferActionOperation,
  transitionTransferActionOperation,
} from "./transfer-action-operations.js";

type Row = {
  id: bigint;
  organization_id: bigint;
  operation_id: string;
  conversation_id: bigint;
  transfer_id: bigint;
  requested_by_user_id: bigint;
  acd_session_id: string;
  action: number;
  state: string;
  error_code: string | null;
  error_detail: string | null;
  evidence: unknown;
  created_at: Date;
  updated_at: Date;
  terminal_at: Date | null;
};

function createOperationDb(validReferences: string[]): DbClient {
  const rows = new Map<string, Row>();
  const valid = new Set(validReferences);
  let nextId = 1n;

  const query = async (sql: string, ...params: unknown[]): Promise<unknown[]> => {
    const normalized = sql.trim();
    const organizationId = String(params[0]);
    const operationId = String(params[1]);
    const key = `${organizationId}:${operationId}`;

    if (normalized.startsWith("INSERT INTO ccass.transfer_action_operations")) {
      const conversationId = String(params[2]);
      const transferId = String(params[3]);
      const userId = String(params[4]);
      if (!valid.has(`${organizationId}:${conversationId}:${transferId}:${userId}`)) return [];
      if (rows.has(key)) return [];
      const now = new Date("2026-09-22T00:00:00.000Z");
      const row: Row = {
        id: nextId++,
        organization_id: BigInt(organizationId),
        operation_id: operationId,
        conversation_id: BigInt(conversationId),
        transfer_id: BigInt(transferId),
        requested_by_user_id: BigInt(userId),
        acd_session_id: String(params[5]),
        action: Number(params[6]),
        state: "pending",
        error_code: null,
        error_detail: null,
        evidence: {},
        created_at: now,
        updated_at: now,
        terminal_at: null,
      };
      rows.set(key, row);
      return [row];
    }

    if (normalized.startsWith("UPDATE ccass.transfer_action_operations")) {
      const row = rows.get(key);
      if (!row || row.state !== "pending") return [];
      const now = new Date("2026-09-22T00:01:00.000Z");
      row.state = String(params[2]);
      row.error_code = params[3] == null ? null : String(params[3]);
      row.error_detail = params[4] == null ? null : String(params[4]);
      row.evidence = params[5] == null ? row.evidence : JSON.parse(String(params[5]));
      row.updated_at = now;
      row.terminal_at = now;
      return [row];
    }

    if (normalized.startsWith("SELECT")) {
      const row = rows.get(key);
      return row ? [row] : [];
    }

    throw new Error(`Unexpected SQL: ${normalized}`);
  };

  return { $queryRawUnsafe: query } as unknown as DbClient;
}

const baseInput = {
  operationId: "op-shared",
  conversationId: "100",
  transferId: "500",
  requestedByUserId: "7",
  acdSessionId: "acd-session",
  action: 2,
};

test("operation claims are idempotent within a tenant and isolated between tenants", async () => {
  const db = createOperationDb(["10:100:500:7", "20:100:500:7"]);

  const first = await claimTransferActionOperation(db, "10", baseInput);
  const replay = await claimTransferActionOperation(db, "10", baseInput);
  const otherTenant = await claimTransferActionOperation(db, "20", baseInput);

  assert.equal(first.idempotentReplay, false);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.operation.id, first.operation.id);
  assert.equal(otherTenant.idempotentReplay, false);
  assert.notEqual(otherTenant.operation.id, first.operation.id);
  assert.equal((await getTransferActionOperation(db, "30", baseInput.operationId)), null);
});

test("operation claims reject cross-tenant references and operation id reuse", async () => {
  const db = createOperationDb(["10:100:500:7"]);

  await claimTransferActionOperation(db, "10", baseInput);
  await assert.rejects(
    claimTransferActionOperation(db, "10", { ...baseInput, action: 1 }),
    (error: unknown) => (error as { status?: number }).status === 409,
  );
  await assert.rejects(
    claimTransferActionOperation(db, "20", {
      ...baseInput,
      operationId: "op-cross-tenant-reference",
    }),
    (error: unknown) => (error as { status?: number }).status === 404,
  );
});

test("operation terminal transitions are one-way and idempotent", async () => {
  const db = createOperationDb(["10:100:500:7"]);
  await claimTransferActionOperation(db, "10", baseInput);

  const acknowledged = await transitionTransferActionOperation(
    db,
    "10",
    baseInput.operationId,
    "acknowledged",
    { evidence: { source: "umn" } },
  );
  const replay = await transitionTransferActionOperation(
    db,
    "10",
    baseInput.operationId,
    "acknowledged",
  );

  assert.equal(acknowledged.idempotentReplay, false);
  assert.equal(acknowledged.operation.state, "acknowledged");
  assert.deepEqual(acknowledged.operation.evidence, { source: "umn" });
  assert.equal(replay.idempotentReplay, true);
  await assert.rejects(
    transitionTransferActionOperation(db, "10", baseInput.operationId, "failed"),
    (error: unknown) => (error as { status?: number }).status === 409,
  );
});
