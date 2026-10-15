/**
 * Thin client for coworker-agents task APIs (Flows 1–4 triage/assign).
 */
export type TriageAssignResult = {
  subject: string;
  description: string;
  priority: "low" | "medium" | "high" | "urgent";
  assignee: string;
  queue: string;
  channel: "Web";
  rationale: string;
  enrichedByAi: boolean;
  category?: string;
  skill?: string;
  assignee_id?: string | null;
  resolver?: string | null;
  resolver_id?: string | null;
  resolver_confidence?: number | null;
};

const COWORKER_AGENTS_URL = (
  process.env.COWORKER_AGENTS_URL || "http://127.0.0.1:8012"
).replace(/\/$/, "");

function tasksSecret(): string {
  const secret = String(process.env.COWORKER_TASKS_SECRET || "").trim();
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("COWORKER_TASKS_SECRET must be set in production");
  }
  return "worktual-tasks-dev-secret";
}

function normalizePriority(
  raw: unknown
): TriageAssignResult["priority"] {
  const p = String(raw || "")
    .trim()
    .toLowerCase();
  if (p === "low" || p === "medium" || p === "high" || p === "urgent") return p;
  return "medium";
}

export async function triageAssignViaAgents(input: {
  organizationId: string;
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  issue: string;
  createdByRole?: "customer" | "admin" | "agent";
  forceAssigneeId?: string | null;
  forceAssigneeName?: string | null;
}): Promise<TriageAssignResult | null> {
  if (!String(input.organizationId || "").trim()) {
    return null;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45_000);
    const res = await fetch(`${COWORKER_AGENTS_URL}/tasks/triage-assign`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Coworker-Tasks-Key": tasksSecret(),
      },
      body: JSON.stringify({
        organization_id: input.organizationId,
        customer_name: input.customerName,
        customer_email: input.customerEmail,
        customer_phone: input.customerPhone,
        issue: input.issue,
        created_by_role: input.createdByRole || "customer",
        force_assignee_id: input.forceAssigneeId || undefined,
        force_assignee_name: input.forceAssigneeName || undefined,
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      subject?: unknown;
      description?: unknown;
      priority?: unknown;
      assignee?: unknown;
      queue?: unknown;
      rationale?: unknown;
      category?: unknown;
      skill?: unknown;
      assignee_id?: unknown;
      resolver?: unknown;
      resolver_id?: unknown;
      resolver_confidence?: unknown;
    };
    if (!data?.subject) return null;
    return {
      subject: String(data.subject),
      description: String(data.description || input.issue),
      priority: normalizePriority(data.priority),
      assignee: String(data.assignee || "Unassigned"),
      queue: String(data.queue || ""),
      channel: "Web",
      rationale: String(data.rationale || ""),
      enrichedByAi: true,
      category: data.category ? String(data.category) : undefined,
      skill: data.skill ? String(data.skill) : undefined,
      assignee_id: data.assignee_id ? String(data.assignee_id) : null,
      resolver: data.resolver ? String(data.resolver) : null,
      resolver_id: data.resolver_id ? String(data.resolver_id) : null,
      resolver_confidence:
        data.resolver_confidence != null && data.resolver_confidence !== ""
          ? Number(data.resolver_confidence)
          : null,
    };
  } catch {
    return null;
  }
}
