import type { DbClient } from "../lib/rls.js";

export const TRANSFER_ACTION_OPERATION_STATES = [
  "pending",
  "acknowledged",
  "failed",
  "timed_out",
] as const;

export type TransferActionOperationState =
  (typeof TRANSFER_ACTION_OPERATION_STATES)[number];
export type TerminalTransferActionOperationState = Exclude<
  TransferActionOperationState,
  "pending"
>;

export type TransferActionOperation = {
  id: string;
  organizationId: string;
  operationId: string;
  conversationId: string;
  transferId: string;
  requestedByUserId: string;
  acdSessionId: string;
  action: number;
  state: TransferActionOperationState;
  errorCode: string | null;
  errorDetail: string | null;
  evidence: unknown;
  createdAt: string;
  updatedAt: string;
  terminalAt: string | null;
};

export type ClaimTransferActionOperationInput = {
  operationId: string;
  conversationId: string;
  transferId: string;
  requestedByUserId: string;
  acdSessionId: string;
  action: number;
};

type TransferActionOperationRow = {
  id: bigint | string;
  organization_id: bigint | string;
  operation_id: string;
  conversation_id: bigint | string;
  transfer_id: bigint | string;
  requested_by_user_id: bigint | string;
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

const OPERATION_COLUMNS = `
  id, organization_id, operation_id, conversation_id, transfer_id,
  requested_by_user_id, acd_session_id, action, state, error_code,
  error_detail, evidence, created_at, updated_at, terminal_at
`;

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function organizationBigInt(organizationId: string): bigint {
  return BigInt(required(organizationId, "organizationId"));
}

function entityBigInt(value: string, label: string): bigint {
  return BigInt(required(value, label));
}

function mapOperation(row: TransferActionOperationRow): TransferActionOperation {
  return {
    id: String(row.id),
    organizationId: String(row.organization_id),
    operationId: row.operation_id,
    conversationId: String(row.conversation_id),
    transferId: String(row.transfer_id),
    requestedByUserId: String(row.requested_by_user_id),
    acdSessionId: row.acd_session_id,
    action: row.action,
    state: row.state as TransferActionOperationState,
    errorCode: row.error_code,
    errorDetail: row.error_detail,
    evidence: row.evidence,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    terminalAt: row.terminal_at?.toISOString() ?? null,
  };
}

function conflict(message: string): Error {
  return Object.assign(new Error(message), { status: 409 });
}

function notFound(): Error {
  return Object.assign(new Error("Transfer action operation not found"), { status: 404 });
}

function assertIdempotentReplay(
  operation: TransferActionOperation,
  input: ClaimTransferActionOperationInput,
): void {
  if (
    operation.conversationId !== input.conversationId ||
    operation.transferId !== input.transferId ||
    operation.requestedByUserId !== input.requestedByUserId ||
    operation.acdSessionId !== input.acdSessionId ||
    operation.action !== input.action
  ) {
    throw conflict("operationId reused with a different transfer action");
  }
}

export async function getTransferActionOperation(
  db: DbClient,
  organizationId: string,
  operationId: string,
): Promise<TransferActionOperation | null> {
  const rows = await db.$queryRawUnsafe<TransferActionOperationRow[]>(
    `SELECT ${OPERATION_COLUMNS}
     FROM ccass.transfer_action_operations
     WHERE organization_id = $1 AND operation_id = $2
     LIMIT 1`,
    organizationBigInt(organizationId),
    required(operationId, "operationId"),
  );
  return rows[0] ? mapOperation(rows[0]) : null;
}

/**
 * Claims an operation before an ACD publish. The INSERT validates every
 * referenced entity inside the same organization and conversation.
 */
export async function claimTransferActionOperation(
  db: DbClient,
  organizationId: string,
  input: ClaimTransferActionOperationInput,
): Promise<{ operation: TransferActionOperation; idempotentReplay: boolean }> {
  const tenant = organizationBigInt(organizationId);
  const operationId = required(input.operationId, "operationId");
  const conversationId = entityBigInt(input.conversationId, "conversationId");
  const transferId = entityBigInt(input.transferId, "transferId");
  const requestedByUserId = entityBigInt(input.requestedByUserId, "requestedByUserId");
  const acdSessionId = required(input.acdSessionId, "acdSessionId");

  if (!Number.isInteger(input.action) || input.action < 1 || input.action > 6) {
    throw new Error("action must be an integer between 1 and 6");
  }

  const inserted = await db.$queryRawUnsafe<TransferActionOperationRow[]>(
    `INSERT INTO ccass.transfer_action_operations (
       organization_id, operation_id, conversation_id, transfer_id,
       requested_by_user_id, acd_session_id, action, state
     )
     SELECT
       transfer.organization_id, $2, transfer.conversation_id, transfer.id,
       actor.id, $6, $7, 'pending'
     FROM ccass.conversation_transfers AS transfer
     INNER JOIN ccass.conversations AS conversation
       ON conversation.organization_id = transfer.organization_id
      AND conversation.id = transfer.conversation_id
     INNER JOIN accounts.setup_users AS actor
       ON actor.organization_id = transfer.organization_id
      AND actor.id = $5
     WHERE transfer.organization_id = $1
       AND transfer.conversation_id = $3
       AND transfer.id = $4
     ON CONFLICT (organization_id, operation_id) DO NOTHING
     RETURNING ${OPERATION_COLUMNS}`,
    tenant,
    operationId,
    conversationId,
    transferId,
    requestedByUserId,
    acdSessionId,
    input.action,
  );

  if (inserted[0]) {
    return { operation: mapOperation(inserted[0]), idempotentReplay: false };
  }

  const existing = await getTransferActionOperation(db, organizationId, operationId);
  if (!existing) throw notFound();
  assertIdempotentReplay(existing, {
    ...input,
    operationId,
    acdSessionId,
  });
  return { operation: existing, idempotentReplay: true };
}

export async function transitionTransferActionOperation(
  db: DbClient,
  organizationId: string,
  operationId: string,
  state: TerminalTransferActionOperationState,
  details: {
    errorCode?: string | null;
    errorDetail?: string | null;
    evidence?: Record<string, unknown> | null;
  } = {},
): Promise<{ operation: TransferActionOperation; idempotentReplay: boolean }> {
  const normalizedOperationId = required(operationId, "operationId");
  const rows = await db.$queryRawUnsafe<TransferActionOperationRow[]>(
    `UPDATE ccass.transfer_action_operations
     SET state = $3,
         error_code = $4,
         error_detail = $5,
         evidence = COALESCE($6::jsonb, evidence),
         terminal_at = COALESCE(terminal_at, NOW()),
         updated_at = NOW()
     WHERE organization_id = $1
       AND operation_id = $2
       AND state = 'pending'
     RETURNING ${OPERATION_COLUMNS}`,
    organizationBigInt(organizationId),
    normalizedOperationId,
    state,
    details.errorCode ?? null,
    details.errorDetail ?? null,
    details.evidence ? JSON.stringify(details.evidence) : null,
  );

  if (rows[0]) {
    return { operation: mapOperation(rows[0]), idempotentReplay: false };
  }

  const existing = await getTransferActionOperation(
    db,
    organizationId,
    normalizedOperationId,
  );
  if (!existing) throw notFound();
  if (existing.state !== state) {
    throw conflict(`Transfer action operation is already ${existing.state}`);
  }
  return { operation: existing, idempotentReplay: true };
}
