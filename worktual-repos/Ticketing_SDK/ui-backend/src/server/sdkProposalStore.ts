import type { AuthUser } from "../types";
import { query } from "./db";
import {
  parseProposalId,
  proposalMatches,
  shapeSdkProposal,
  type ProposalSource,
  type SdkProposal,
} from "./sdkProposals";

function httpError(status: number, code: string, error: string): Error {
  const err = new Error(error) as Error & { status?: number; code?: string };
  err.status = status;
  err.code = code;
  return err;
}

function sourceFromRow(kind: ProposalSource["kind"], row: Record<string, unknown>): ProposalSource {
  return {
    kind,
    id: String(row.id || ""),
    agentId: String(row.agent_id || ""),
    ticketNumber: row.ticket_number != null ? String(row.ticket_number) : null,
    summary: row.summary != null ? String(row.summary) : "",
    status: row.status != null ? String(row.status) : null,
    toolName: row.tool_name != null ? String(row.tool_name) : null,
    toolArgs: row.tool_args,
    payload: row.payload,
    createdAt: row.created_at,
  };
}

async function loadApprovals(orgId: string): Promise<SdkProposal[]> {
  const { rows } = await query(
    `SELECT id::text AS id, agent_id, ticket_number, summary, tool_name, tool_args, payload, status,
            created_at
       FROM proactive_approvals
      WHERE organization_id = $1::bigint
      ORDER BY created_at DESC
      LIMIT 100`,
    [orgId]
  );
  return rows
    .map((row) => shapeSdkProposal(sourceFromRow("approval", row as Record<string, unknown>)))
    .filter((item): item is SdkProposal => Boolean(item));
}

async function loadRecommendations(orgId: string): Promise<SdkProposal[]> {
  const { rows } = await query(
    `SELECT id::text AS id, agent_id, ticket_number, summary, payload, status, created_at
       FROM proactive_recommendations
      WHERE organization_id = $1::bigint
        AND agent_id <> 'tsaa'
      ORDER BY created_at DESC
      LIMIT 100`,
    [orgId]
  );
  return rows
    .map((row) => shapeSdkProposal(sourceFromRow("recommendation", row as Record<string, unknown>)))
    .filter((item): item is SdkProposal => Boolean(item));
}

export async function listSdkProposals(
  orgId: string,
  filter: { ticketNumber?: string; status?: string }
): Promise<SdkProposal[]> {
  let approvals: SdkProposal[] = [];
  let recommendations: SdkProposal[] = [];
  try {
    approvals = await loadApprovals(orgId);
  } catch (err) {
    console.error("sdk proposal approvals", err);
  }
  try {
    recommendations = await loadRecommendations(orgId);
  } catch (err) {
    console.error("sdk proposal recommendations", err);
  }
  return [...approvals, ...recommendations]
    .filter((item) => proposalMatches(item, filter))
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
}

async function decideApproval(
  user: AuthUser,
  approvalId: string,
  accept: boolean,
  edits?: { text?: string; toolArgs?: Record<string, unknown> }
): Promise<{ ok: boolean; status?: string; detail?: string }> {
  const agentsUrl = (process.env.COWORKER_AGENTS_URL || "http://127.0.0.1:8012").replace(/\/$/, "");
  const secret = process.env.COWORKER_TASKS_SECRET || "worktual-tasks-dev-secret";
  const response = await fetch(`${agentsUrl}/proactive/approvals/decide`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Coworker-Tasks-Key": secret,
    },
    body: JSON.stringify({
      organization_id: user.organizationId,
      approval_id: approvalId,
      accept,
      actor_id: user.id,
      actor_role: user.role,
      actor_name: user.name || user.email || undefined,
      edited_text: edits?.text,
      tool_args: edits?.toolArgs,
    }),
  });
  const body = (await response.json().catch(() => ({}))) as {
    ok?: boolean;
    status?: string;
    error?: string;
    detail?: string;
  };
  if (!response.ok || body.ok === false) {
    const missing = body.error === "not_found" || response.status === 404;
    throw httpError(
      missing ? 404 : body.error === "already_decided" ? 409 : response.status === 422 || body.error === "tool_failed" ? 422 : 502,
      body.error || "proposal_failed",
      body.detail || body.error || "Could not decide this approval"
    );
  }
  return {
    ok: true,
    status: body.status === "approved" ? "applied" : body.status || (accept ? "applied" : "rejected"),
  };
}

async function decideRecommendation(orgId: string, id: string, accept: boolean): Promise<void> {
  const status = accept ? "acknowledged" : "dismissed";
  const updated = await query(
    `UPDATE proactive_recommendations
        SET status = $3
      WHERE organization_id = $1::bigint AND id = $2::bigint AND status = 'open'
      RETURNING id`,
    [orgId, id, status]
  );
  if (!updated.rows[0]) {
    const existing = await query(
      `SELECT status FROM proactive_recommendations
        WHERE organization_id = $1::bigint AND id = $2::bigint`,
      [orgId, id]
    );
    if (!existing.rows[0]) throw httpError(404, "not_found", "Proposal not found");
    throw httpError(409, "already_decided", "This proposal was already decided");
  }
}

export async function decideSdkProposal(
  user: AuthUser,
  rawId: string,
  decision: string,
  edits?: { text?: string; toolArgs?: Record<string, unknown> }
): Promise<{ id: string; ok: true; status: string }> {
  const parsed = parseProposalId(rawId);
  if (!parsed) throw httpError(400, "validation_error", "Proposal id must look like approval:1 or recommendation:1");
  const accept = decision === "confirm";
  if (!accept && decision !== "reject") {
    throw httpError(400, "validation_error", "decision must be confirm or reject");
  }
  if (parsed.kind === "approval") {
    const result = await decideApproval(user, parsed.id, accept, edits);
    return { id: rawId, ok: true, status: result.status || (accept ? "applied" : "rejected") };
  }
  await decideRecommendation(user.organizationId, parsed.id, accept);
  return { id: rawId, ok: true, status: accept ? "applied" : "rejected" };
}
