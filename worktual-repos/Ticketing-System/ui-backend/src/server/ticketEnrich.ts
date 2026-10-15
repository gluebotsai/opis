/**
 * Deterministic fallback for smart ticket create.
 *
 * Python coworker-agents owns all LLM triage/assignment. This module is used
 * only when that service is unavailable, so it must not host a second LLM.
 * Teams come from ticketing.agent_queues — never invent queue/team names.
 */
import { listAssignableAgents, type AssignableAgent } from "./accountsSync";
import { listTicketingTeams, type TicketingTeam } from "./ticketingTeams";
import { query } from "./db";

export type EnrichTicketInput = {
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  issue: string;
  organizationId?: string;
};

export type EnrichTicketResult = {
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

function pickTeam(
  issue: string,
  teams: TicketingTeam[]
): TicketingTeam | null {
  if (!teams.length) return null;
  const lower = issue.toLowerCase();
  const scored = teams.map((t) => {
    let score = 0;
    // Prefer team description match (primary signal)
    const desc = String(t.description || "").toLowerCase();
    for (const token of lower.split(/[^a-z0-9]+/).filter((w) => w.length > 3)) {
      if (desc.includes(token)) score += 3;
    }
    const blob = `${t.name} ${t.members
      .flatMap((m) => m.skills)
      .join(" ")}`.toLowerCase();
    for (const token of lower.split(/[^a-z0-9]+/).filter((w) => w.length > 3)) {
      if (blob.includes(token)) score += 1;
    }
    if (t.members.length) score += 0.5;
    return { t, score };
  });
  scored.sort((a, b) => b.score - a.score || a.t.name.localeCompare(b.t.name));
  if (scored[0].score > 0) return scored[0].t;
  // No match → do not invent a default team
  return null;
}

function pickMember(
  issue: string,
  team: TicketingTeam | null,
  agents: AssignableAgent[]
): AssignableAgent | null {
  const pool = team?.members?.length ? team.members : agents;
  if (!pool.length) return null;
  const lower = issue.toLowerCase();
  const scored = pool.map((a) => {
    let score = 0;
    for (const skill of a.skills) {
      const s = skill.toLowerCase();
      if (lower.includes(s) || s.split(/\s+/).some((w) => w.length > 3 && lower.includes(w))) {
        score += 2;
      }
    }
    // L1 first: prefer agents over resolvers/admins
    const role = String(a.role || "").toLowerCase();
    if (role === "agent") score += 3;
    else if (role === "resolver") score += 0.25;
    return { a, score };
  });
  const agentsOnly = scored.filter((s) => String(s.a.role || "").toLowerCase() === "agent");
  const use = agentsOnly.length ? agentsOnly : scored;
  use.sort((a, b) => b.score - a.score || a.a.name.localeCompare(b.a.name));
  return use[0].a;
}

function heuristicFallback(
  issue: string,
  agents: AssignableAgent[],
  teams: TicketingTeam[]
): EnrichTicketResult {
  const lower = issue.toLowerCase();
  let priority: EnrichTicketResult["priority"] = "medium";
  if (/\b(urgent|asap|immediately|critical|down)\b/.test(lower)) priority = "urgent";
  else if (/\b(cannot|can't|broken|fail|outage)\b/.test(lower)) priority = "high";
  else if (/\b(question|how do|info|curious)\b/.test(lower)) priority = "low";

  const subject =
    issue.length > 80 ? `${issue.slice(0, 77).trim()}…` : issue.trim() || "Support request";

  if (!teams.length) {
    return {
      subject,
      description: `Customer reported:\n\n${issue.trim()}`,
      priority,
      assignee: "Unassigned",
      queue: "",
      channel: "Web",
      rationale: "No teams configured in Ticketing yet.",
      enrichedByAi: false,
      category: undefined,
      skill: undefined,
      assignee_id: null,
      resolver: null,
      resolver_id: null,
      resolver_confidence: null,
    };
  }

  const team = pickTeam(issue, teams);
  const member = team ? pickMember(issue, team, agents) : null;
  const skill = member?.skills[0] || team?.name || "";
  const resolvers = (team?.members || []).filter(
    (a) => String(a.role || "").toLowerCase() === "resolver" && a.id !== member?.id
  );
  let resolver: AssignableAgent | null = null;
  let resolverConfidence: number | null = null;
  if (resolvers.length) {
    const scored = resolvers.map((a) => {
      let skillScore = 0;
      for (const s0 of a.skills) {
        const s = s0.toLowerCase();
        if (s === "general") {
          skillScore = Math.max(skillScore, 1);
        } else if (
          lower.includes(s) ||
          s.split(/\s+/).some((w) => w.length > 3 && lower.includes(w))
        ) {
          skillScore = Math.max(skillScore, 2);
        }
      }
      return { a, skillScore };
    });
    scored.sort((x, y) => y.skillScore - x.skillScore || x.a.name.localeCompare(y.a.name));
    const best = scored[0];
    const conf = best.skillScore >= 2 ? 1.0 : best.skillScore === 1 ? 0.5 : 0.25;
    resolverConfidence = conf;
    // Admin/customer create: always skill-pick an L2 when a resolver exists on the team.
    // (Previously required conf > 0.5, which left resolver empty on weak matches.)
    resolver = best.a;
  }

  return {
    subject,
    description: `Customer reported:\n\n${issue.trim()}`,
    priority,
    assignee: member?.name || "Unassigned",
    queue: team?.name || "",
    channel: "Web",
    rationale: team
      ? `Matched team “${team.name}” by description/skills${member ? ` → ${member.name}` : ""}.`
      : teams.length
        ? "No Ticketing team description matched; left unassigned."
        : "No teams configured in Ticketing yet.",
    enrichedByAi: false,
    category: team?.name,
    skill,
    assignee_id: member?.id || null,
    resolver: resolver?.name || null,
    resolver_id: resolver?.id || null,
    resolver_confidence: resolverConfidence,
  };
}

export async function enrichTicketDraft(
  input: EnrichTicketInput
): Promise<EnrichTicketResult> {
  const orgId = String(input.organizationId || "").trim();
  if (!orgId) {
    throw new Error("organizationId is required for ticket enrich");
  }
  const [agents, teams] = await Promise.all([
    listAssignableAgents(orgId),
    listTicketingTeams(orgId),
  ]);
  return heuristicFallback(input.issue, agents, teams);
}

export type PickResolverInput = {
  organizationId: string;
  /** Ticket subject/description/skill for matching */
  skillHint?: string;
  queueName?: string;
  /** Prefer this person if they are on the roster (any staff role). */
  namedAssignee?: string;
  /** Exclude current assignee id from the pick. */
  excludeUserId?: string | null;
};

export type PickResolverResult = {
  assignee: string;
  assigneeId: string | null;
  role: string;
  rationale: string;
};

/**
 * Escalate pick: prefer resolvers on the ticket’s team by skill + open workload.
 * Named assignee wins when they exist on the roster.
 */
export async function pickBestResolver(
  input: PickResolverInput
): Promise<PickResolverResult> {
  const orgId = String(input.organizationId || "").trim();
  if (!orgId) {
    throw new Error("organizationId is required for resolver pick");
  }
  const [agents, teams, workloadRows] = await Promise.all([
    listAssignableAgents(orgId),
    listTicketingTeams(orgId),
    queryOpenWorkload(orgId),
  ]);

  if (input.namedAssignee?.trim()) {
    const wanted = input.namedAssignee.trim().toLowerCase();
    const hit =
      agents.find((a) => a.name.toLowerCase() === wanted) ||
      agents.find(
        (a) =>
          a.name.toLowerCase().includes(wanted) ||
          wanted.includes(a.name.toLowerCase())
      );
    if (hit) {
      return {
        assignee: hit.name,
        assigneeId: hit.id,
        role: hit.role,
        rationale: `Assigned to ${hit.name} (${hit.role}) as requested.`,
      };
    }
  }

  const team =
    teams.find(
      (t) =>
        input.queueName &&
        t.name.toLowerCase() === String(input.queueName).toLowerCase()
    ) ||
    teams.find(
      (t) =>
        input.queueName &&
        t.name.toLowerCase().includes(String(input.queueName).toLowerCase())
    ) ||
    null;

  let pool = team?.members?.length ? [...team.members] : [...agents];
  if (input.excludeUserId) {
    pool = pool.filter((a) => a.id !== input.excludeUserId);
  }

  const resolvers = pool.filter(
    (a) => String(a.role || "").toLowerCase() === "resolver"
  );
  if (resolvers.length) pool = resolvers;

  if (!pool.length) {
    return {
      assignee: "Unassigned",
      assigneeId: null,
      role: "",
      rationale: "No resolvers available to escalate to.",
    };
  }

  const hint = `${input.skillHint || ""} ${input.queueName || ""}`.toLowerCase();
  const scored = pool.map((a) => {
    let skillScore = 0;
    for (const skill of a.skills) {
      const s = skill.toLowerCase();
      if (!s) continue;
      if (hint.includes(s) || s.split(/\s+/).some((w) => w.length > 3 && hint.includes(w))) {
        skillScore = Math.max(skillScore, 2);
      } else if (s === "general") {
        skillScore = Math.max(skillScore, 1);
      }
    }
    const openCount = workloadRows.get(a.name) || 0;
    return { a, skillScore, openCount };
  });
  scored.sort(
    (x, y) =>
      y.skillScore - x.skillScore ||
      x.openCount - y.openCount ||
      x.a.name.localeCompare(y.a.name)
  );
  const best = scored[0].a;
  const openCount = workloadRows.get(best.name) || 0;
  const teamLabel = team?.name || input.queueName || "org";
  return {
    assignee: best.name,
    assigneeId: best.id,
    role: best.role,
    rationale: `Escalated to ${best.name} (${best.role}) on “${teamLabel}” (open workload=${openCount}).`,
  };
}

async function queryOpenWorkload(orgId: string): Promise<Map<string, number>> {
  const { rows } = await query(
    `SELECT COALESCE(assignee_name, '') AS assignee_name,
            COUNT(*)::int AS open_count
     FROM ticketing.tickets
     WHERE organization_id = $1
       AND status IN ('Open', 'Pending', 'Reopened', 'Overdue')
       AND assignee_name IS NOT NULL
       AND assignee_name <> ''
       AND assignee_name <> 'Unassigned'
     GROUP BY assignee_name`,
    [orgId]
  );
  const map = new Map<string, number>();
  for (const r of rows) {
    map.set(String(r.assignee_name), Number(r.open_count || 0));
  }
  return map;
}

export type TicketChatKind =
  | "start"
  | "got_name"
  | "got_contact"
  | "enriched"
  | "validation"
  | "confirm_hint"
  | "cancelled";

export type TicketChatReplyInput = {
  kind: TicketChatKind;
  userText?: string;
  customerName?: string;
  contact?: string;
  subject?: string;
  priority?: string;
  assignee?: string;
  queue?: string;
  rationale?: string;
  validationHint?: string;
  fallback: string;
};

/** Natural-language co-worker replies for guided create-ticket chat (LLM only). */
export async function ticketChatReply(
  input: TicketChatReplyInput
): Promise<string> {
  const { guidedChatReply } = await import("./guidedChatReply");
  return guidedChatReply({
    module: "ticket",
    kind: input.kind,
    userText: input.userText,
    validationHint: input.validationHint,
    fallback: input.fallback,
    context: {
      customerName: input.customerName,
      contact: input.contact,
      subject: input.subject,
      priority: input.priority,
      assignee: input.assignee,
      queue: input.queue,
      rationale: input.rationale,
    },
  });
}
