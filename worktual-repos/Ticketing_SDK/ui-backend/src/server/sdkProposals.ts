/**
 * Partner view of proactive approvals and recommendations.
 * Ids are prefixed so the two tables cannot collide.
 */

export type SdkProposalKind = "approval" | "recommendation";

export type SdkProposalStatus = "confirmation_required" | "recommendation" | "applied" | "rejected";

export type SdkProposal = {
  id: string;
  kind: SdkProposalKind;
  status: SdkProposalStatus;
  agentId: string;
  ticketNumber: string | null;
  summary: string;
  draft?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  createdAt?: string;
};

export type ProposalSource = {
  kind: SdkProposalKind;
  id: string;
  agentId: string;
  ticketNumber?: string | null;
  summary?: string | null;
  status?: string | null;
  toolName?: string | null;
  toolArgs?: unknown;
  payload?: unknown;
  createdAt?: unknown;
};

const OPEN = new Set(["open", "pending", "confirmation_required", "recommendation", ""]);

export function parseProposalId(raw: string): { kind: SdkProposalKind; id: string } | null {
  const value = String(raw || "").trim();
  const match = /^(approval|recommendation):(\d+)$/.exec(value);
  if (!match) return null;
  return { kind: match[1] as SdkProposalKind, id: match[2] };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function ticketKey(raw: string | null | undefined): string {
  return String(raw || "").replace(/^#/, "").trim().toLowerCase();
}

function draftFrom(toolArgs: unknown, payload: unknown): string | undefined {
  const args = asRecord(toolArgs);
  const body = asRecord(payload);
  const text = String(args?.text || args?.body || body?.draft || body?.text || "").trim();
  return text || undefined;
}

export function sdkProposalStatus(kind: SdkProposalKind, raw: string | null | undefined): SdkProposalStatus | null {
  const status = String(raw || "").trim().toLowerCase();
  if (kind === "approval") {
    if (status === "pending" || status === "") return "confirmation_required";
    if (status === "approved") return "applied";
    if (status === "rejected") return "rejected";
    return null;
  }
  if (status === "open" || status === "") return "recommendation";
  if (status === "acknowledged") return "applied";
  if (status === "dismissed") return "rejected";
  return null;
}

export function shapeSdkProposal(row: ProposalSource): SdkProposal | null {
  const id = String(row.id || "").trim();
  if (!/^\d+$/.test(id)) return null;
  const status = sdkProposalStatus(row.kind, row.status);
  if (!status) return null;
  const toolArgs = asRecord(row.toolArgs) || undefined;
  const created =
    row.createdAt instanceof Date
      ? row.createdAt.toISOString()
      : row.createdAt != null
        ? String(row.createdAt)
        : undefined;
  return {
    id: `${row.kind}:${id}`,
    kind: row.kind,
    status,
    agentId: String(row.agentId || "").trim(),
    ticketNumber: row.ticketNumber ? String(row.ticketNumber) : null,
    summary: String(row.summary || "").trim(),
    draft: draftFrom(row.toolArgs, row.payload),
    toolName: row.toolName ? String(row.toolName) : undefined,
    toolArgs,
    createdAt: created,
  };
}

export function proposalMatches(
  item: SdkProposal,
  filter: { ticketNumber?: string; status?: string }
): boolean {
  const ticket = String(filter.ticketNumber || "").trim();
  if (ticket && ticketKey(item.ticketNumber) !== ticketKey(ticket)) return false;
  const wanted = String(filter.status || "open").trim().toLowerCase();
  if (wanted === "all") return true;
  if (wanted === "decided") return item.status === "applied" || item.status === "rejected";
  if (wanted === "confirmation_required" || wanted === "pending") {
    return item.status === "confirmation_required";
  }
  if (wanted === "recommendation") return item.status === "recommendation";
  if (OPEN.has(wanted)) {
    return item.status === "confirmation_required" || item.status === "recommendation";
  }
  return item.status === wanted;
}
