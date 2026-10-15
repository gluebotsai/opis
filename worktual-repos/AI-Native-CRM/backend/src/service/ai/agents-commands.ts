/**
 * Framework-agnostic Agents dashboard commands for Fastify Wave 11.
 * LangGraph runners stay on the AI side service — this is CRM metrics only.
 */

import { canViewAgents } from "@/service/auth/rbac";
import {
  getCurrentUserRole,
  resolveRequestOrganizationId,
} from "@/service/auth/require-role";
import {
  getAgentsDashboardMetrics,
  parseAgentRange,
  rangeSince,
  type AgentRangeId,
  type AgentsDashboardPayload,
} from "@/dao/ai/agents-dashboard";
import {
  findEnrichmentJobById,
  listEnrichmentJobsPage,
} from "@/dao/ai/lead-enrichment-store";
import { findScoringJobById, listScoringJobsPage } from "@/dao/ai/lead-scoring-store";
import { findNurtureJobById, listNurtureJobsPage } from "@/dao/ai/lead-nurture-store";
import {
  findLifecycleJobById,
  listLifecycleJobsPage,
} from "@/dao/ai/lead-lifecycle-store";
import {
  findAutoReplyJobById,
  listAutoReplyJobsPage,
} from "@/dao/ai/email-auto-reply-store";
import type {
  EmailAutoReplyStatus,
  LeadEnrichmentStatus,
  LeadLifecycleStatus,
  LeadNurtureStatus,
  LeadScoringStatus,
} from "@prisma/client";
import {
  listStepsForJob,
  listRunsForAgentPage,
  findRunByJobIdFromEvents,
  type AgentStepEventRow,
} from "@/dao/ai/agent-step-events";
import { getContactHydrateByIds } from "@/dao/account/account-repository";
import { formatContactDisplayName } from "@/lib/contact-name";

export type { AgentRangeId, AgentsDashboardPayload };

/**
 * Agents with a persisted job table + resolvable contactId (job-queue rows
 * with status/attempts/lastError). Plug into `AGENT_RUN_SOURCES` below as
 * `kind: "job"`.
 */
export const JOB_BACKED_AGENT_IDS = [
  "lead_enrichment",
  "lead_scoring",
  "lead_nurture",
  "lead_lifecycle",
  "email_auto_reply",
] as const;

/**
 * Agents with no job table — they run inline and return a result. Each
 * `run()` on the ai-service side generates its own ephemeral `job_id` and
 * reuses it for every step it posts, so "Recent runs" for these agents is
 * derived directly from `agent_step_events` grouped by `job_id` (see
 * `kind: "events"` below) instead of a job-table page.
 */
export const EVENT_BACKED_AGENT_IDS = [
  "lead_summary",
  "sales_assignment",
  "meeting_brief",
  "meeting_reminder",
  "meeting_miss_escalation",
  "meeting_mom",
  "post_meeting_process",
  "pipeline_forecast",
  "sales_coach",
  "compliance_privacy",
  "invoice_escalation",
  "company_collection_risk",
  "revenue_gap_forecast",
  "invoice_dunning",
  "expansion_matcher",
  "prospect_search",
  "prospect_qualify",
  "prospect_personnel",
  "proposal_corpus",
  "proposal_generate",
] as const;

export const SUPPORTED_AGENT_IDS = [
  ...JOB_BACKED_AGENT_IDS,
  ...EVENT_BACKED_AGENT_IDS,
] as const;
export type SupportedAgentId = (typeof SUPPORTED_AGENT_IDS)[number];

export function isSupportedAgentId(id: string): id is SupportedAgentId {
  return (SUPPORTED_AGENT_IDS as readonly string[]).includes(id);
}

/**
 * Common run shape both "kinds" of source produce — a job-table row and a
 * grouped `agent_step_events` row happen to already line up field-for-field,
 * so `toRunSummary` below needs no per-agent adapter. `contactId` is
 * nullable because company-only `sales_assignment` runs have none.
 */
type AgentRunJobRow = {
  id: string;
  organizationId: string;
  contactId: string | null;
  companyId?: string | null;
  dealId?: string | null;
  invoiceId?: string | null;
  status: string;
  attempts: number;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
};

type AgentRunPageOpts = {
  limit?: number;
  offset?: number;
  status: string | null;
  since: Date;
  until: Date;
};

type AgentRunSource =
  | {
      kind: "job";
      validStatuses: readonly string[];
      listPage: (
        organizationId: string,
        opts: AgentRunPageOpts,
      ) => Promise<{ rows: AgentRunJobRow[]; total: number }>;
      findById: (jobId: string) => Promise<AgentRunJobRow | null>;
    }
  | {
      kind: "events";
      /** The `agent` string stored in `agent_step_events.agent`. */
      agent: string;
      validStatuses: readonly string[];
    };

const EVENT_RUN_STATUSES = ["running", "ok", "failed", "skipped"] as const;

const AGENT_RUN_SOURCES: Record<SupportedAgentId, AgentRunSource> = {
  lead_enrichment: {
    kind: "job",
    validStatuses: ["pending", "running", "enriched", "skipped", "failed"],
    listPage: (organizationId, opts) =>
      listEnrichmentJobsPage(organizationId, {
        ...opts,
        status: opts.status as LeadEnrichmentStatus | null,
      }),
    findById: findEnrichmentJobById,
  },
  lead_scoring: {
    kind: "job",
    validStatuses: ["pending", "scoring", "scored", "failed"],
    listPage: (organizationId, opts) =>
      listScoringJobsPage(organizationId, {
        ...opts,
        status: opts.status as LeadScoringStatus | null,
      }),
    findById: findScoringJobById,
  },
  lead_nurture: {
    kind: "job",
    validStatuses: [
      "pending",
      "analyzing",
      "sent",
      "waited",
      "skipped",
      "failed",
    ],
    listPage: (organizationId, opts) =>
      listNurtureJobsPage(organizationId, {
        ...opts,
        status: opts.status as LeadNurtureStatus | null,
      }),
    findById: findNurtureJobById,
  },
  lead_lifecycle: {
    kind: "job",
    validStatuses: [
      "pending",
      "analyzing",
      "applied",
      "waited",
      "skipped",
      "failed",
    ],
    listPage: (organizationId, opts) =>
      listLifecycleJobsPage(organizationId, {
        ...opts,
        status: opts.status as LeadLifecycleStatus | null,
      }),
    findById: findLifecycleJobById,
  },
  email_auto_reply: {
    kind: "job",
    validStatuses: [
      "pending",
      "analyzing",
      "replied",
      "awaiting_demo",
      "escalated",
      "skipped",
      "failed",
    ],
    listPage: (organizationId, opts) =>
      listAutoReplyJobsPage(organizationId, {
        ...opts,
        status: opts.status as EmailAutoReplyStatus | null,
      }),
    findById: findAutoReplyJobById,
  },
  lead_summary: { kind: "events", agent: "lead_summary", validStatuses: EVENT_RUN_STATUSES },
  sales_assignment: {
    kind: "events",
    agent: "sales_assignment",
    validStatuses: EVENT_RUN_STATUSES,
  },
  meeting_brief: { kind: "events", agent: "meeting_brief", validStatuses: EVENT_RUN_STATUSES },
  meeting_reminder: {
    kind: "events",
    agent: "meeting_reminder",
    validStatuses: EVENT_RUN_STATUSES,
  },
  meeting_miss_escalation: {
    kind: "events",
    agent: "meeting_miss_escalation",
    validStatuses: EVENT_RUN_STATUSES,
  },
  meeting_mom: { kind: "events", agent: "meeting_mom", validStatuses: EVENT_RUN_STATUSES },
  post_meeting_process: {
    kind: "events",
    agent: "post_meeting_process",
    validStatuses: EVENT_RUN_STATUSES,
  },
  pipeline_forecast: {
    kind: "events",
    agent: "pipeline_forecast",
    validStatuses: EVENT_RUN_STATUSES,
  },
  sales_coach: {
    kind: "events",
    agent: "sales_coach",
    validStatuses: EVENT_RUN_STATUSES,
  },
  compliance_privacy: {
    kind: "events",
    agent: "compliance_privacy",
    validStatuses: EVENT_RUN_STATUSES,
  },
  invoice_escalation: {
    kind: "events",
    agent: "invoice_escalation",
    validStatuses: EVENT_RUN_STATUSES,
  },
  company_collection_risk: {
    kind: "events",
    agent: "company_collection_risk",
    validStatuses: EVENT_RUN_STATUSES,
  },
  revenue_gap_forecast: {
    kind: "events",
    agent: "revenue_gap_forecast",
    validStatuses: EVENT_RUN_STATUSES,
  },
  invoice_dunning: {
    kind: "events",
    agent: "invoice_dunning",
    validStatuses: EVENT_RUN_STATUSES,
  },
  expansion_matcher: {
    kind: "events",
    agent: "expansion_matcher",
    validStatuses: EVENT_RUN_STATUSES,
  },
  prospect_search: {
    kind: "events",
    agent: "prospect_search",
    validStatuses: EVENT_RUN_STATUSES,
  },
  prospect_qualify: {
    kind: "events",
    agent: "prospect_qualify",
    validStatuses: EVENT_RUN_STATUSES,
  },
  prospect_personnel: {
    kind: "events",
    agent: "prospect_personnel",
    validStatuses: EVENT_RUN_STATUSES,
  },
  proposal_corpus: {
    kind: "events",
    agent: "proposal_corpus",
    validStatuses: EVENT_RUN_STATUSES,
  },
  proposal_generate: {
    kind: "events",
    agent: "proposal_generate",
    validStatuses: EVENT_RUN_STATUSES,
  },
};

async function listRunsPage(
  agentId: SupportedAgentId,
  organizationId: string,
  opts: AgentRunPageOpts,
): Promise<{ rows: AgentRunJobRow[]; total: number }> {
  const source = AGENT_RUN_SOURCES[agentId];
  if (source.kind === "job") return source.listPage(organizationId, opts);
  return listRunsForAgentPage(organizationId, source.agent, opts);
}

/** Ownership check is baked into the events query (organizationId + agent
 * filter); job-table lookups check it explicitly after fetching by id. */
async function findRunById(
  agentId: SupportedAgentId,
  organizationId: string,
  jobId: string,
): Promise<AgentRunJobRow | null> {
  const source = AGENT_RUN_SOURCES[agentId];
  if (source.kind === "job") {
    const job = await source.findById(jobId);
    return job && job.organizationId === organizationId ? job : null;
  }
  return findRunByJobIdFromEvents(organizationId, source.agent, jobId);
}

function emptyMetrics(range: AgentRangeId): AgentsDashboardPayload {
  const until = new Date();
  return {
    organizationId: "",
    range,
    since: until.toISOString(),
    until: until.toISOString(),
    agents: [],
  };
}

export async function getAgentsDashboardCommand(input?: {
  range?: string | null;
}): Promise<
  | { ok: true; data: AgentsDashboardPayload }
  | { ok: false; error: string; status: number }
> {
  const role = await getCurrentUserRole();
  if (!canViewAgents(role)) {
    return {
      ok: false,
      error: "Only admins and sales managers can view Agents.",
      status: 403,
    };
  }

  const range = parseAgentRange(input?.range);
  try {
    const data = await getAgentsDashboardMetrics({ range });
    return { ok: true, data };
  } catch (err) {
    console.error(
      "getAgentsDashboardMetrics failed",
      err instanceof Error ? err.message : err,
    );
    return { ok: true, data: emptyMetrics(range) };
  }
}

export type AgentRunSummary = {
  agent: SupportedAgentId;
  jobId: string;
  contactId: string | null;
  contactName: string | null;
  contactEmail: string | null;
  companyName: string | null;
  /** Primary label when there is no contact (deal / company / invoice agents). */
  subjectLabel: string | null;
  subjectHref: string | null;
  status: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  durationMs: number | null;
};

function toRunSummary(
  agent: SupportedAgentId,
  job: AgentRunJobRow,
  contact?: {
    firstName: string;
    lastName: string;
    email: string | null;
    company: string | null;
  } | null,
  subject?: { label: string | null; href: string | null } | null,
): AgentRunSummary {
  return {
    agent,
    jobId: job.id,
    contactId: job.contactId,
    contactName: contact
      ? formatContactDisplayName(contact.firstName, contact.lastName)
      : null,
    contactEmail: contact?.email ?? null,
    companyName: contact?.company ?? null,
    subjectLabel: subject?.label ?? null,
    subjectHref: subject?.href ?? null,
    status: job.status,
    attempts: job.attempts,
    lastError: job.lastError,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
    completedAt: job.completedAt ? job.completedAt.toISOString() : null,
    durationMs: job.completedAt
      ? job.completedAt.getTime() - job.createdAt.getTime()
      : null,
  };
}

/** Paginated run history for one agent's dedicated "Recent runs" page. */
export async function listAgentRunsPageCommand(
  agentId: string,
  input: {
    limit?: number;
    offset?: number;
    status?: string | null;
    range?: string | null;
  },
): Promise<
  | { ok: true; data: { runs: AgentRunSummary[]; total: number } }
  | { ok: false; error: string; status: number }
> {
  const role = await getCurrentUserRole();
  if (!canViewAgents(role)) {
    return {
      ok: false,
      error: "Only admins and sales managers can view Agents.",
      status: 403,
    };
  }
  if (!isSupportedAgentId(agentId)) {
    return { ok: false, error: "Unsupported agent.", status: 404 };
  }
  const source = AGENT_RUN_SOURCES[agentId];
  const organizationId = await resolveRequestOrganizationId();
  const status =
    input.status && source.validStatuses.includes(input.status)
      ? input.status
      : null;
  const until = new Date();
  const since = rangeSince(parseAgentRange(input.range), until);
  const { rows, total } = await listRunsPage(agentId, organizationId, {
    limit: input.limit,
    offset: input.offset,
    status,
    since,
    until,
  });
  const contactIds = rows
    .map((row) => row.contactId)
    .filter((id): id is string => !!id);
  const contactsById = await getContactHydrateByIds(contactIds);

  const companyIds = [
    ...new Set(rows.map((r) => r.companyId).filter((id): id is string => !!id)),
  ];
  const dealIds = [
    ...new Set(rows.map((r) => r.dealId).filter((id): id is string => !!id)),
  ];
  const invoiceIds = [
    ...new Set(rows.map((r) => r.invoiceId).filter((id): id is string => !!id)),
  ];
  const { getPrismaClient } = await import("@/dao/db/prisma");
  const prisma = getPrismaClient();
  const [companies, deals, invoices] = await Promise.all([
    companyIds.length
      ? prisma.company.findMany({
          where: { id: { in: companyIds }, organizationId },
          select: { id: true, name: true },
        })
      : Promise.resolve([] as Array<{ id: string; name: string }>),
    dealIds.length
      ? prisma.deal.findMany({
          where: { id: { in: dealIds }, organizationId },
          select: { id: true, title: true },
        })
      : Promise.resolve([] as Array<{ id: string; title: string }>),
    invoiceIds.length
      ? prisma.invoice.findMany({
          where: { id: { in: invoiceIds }, organizationId },
          select: { id: true, number: true },
        })
      : Promise.resolve([] as Array<{ id: string; number: string }>),
  ]);
  const companyNameById = new Map(companies.map((c) => [c.id, c.name]));
  const dealTitleById = new Map(deals.map((d) => [d.id, d.title]));
  const invoiceNumberById = new Map(invoices.map((i) => [i.id, i.number]));

  function subjectFor(row: AgentRunJobRow): {
    label: string | null;
    href: string | null;
  } {
    if (row.contactId) return { label: null, href: null };
    if (row.companyId) {
      return {
        label: companyNameById.get(row.companyId) || `Company ${row.companyId.slice(0, 8)}`,
        href: `/company/${row.companyId}`,
      };
    }
    if (row.dealId) {
      return {
        label: dealTitleById.get(row.dealId) || `Deal ${row.dealId.slice(0, 8)}`,
        href: `/sales/${row.dealId}`,
      };
    }
    if (row.invoiceId) {
      return {
        label:
          invoiceNumberById.get(row.invoiceId)
            ? `Invoice ${invoiceNumberById.get(row.invoiceId)}`
            : `Invoice ${row.invoiceId.slice(0, 8)}`,
        href: `/finance/${row.invoiceId}`,
      };
    }
    return { label: "Run", href: null };
  }

  return {
    ok: true,
    data: {
      runs: rows.map((row) =>
        toRunSummary(
          agentId,
          row,
          row.contactId ? contactsById.get(row.contactId) : null,
          subjectFor(row),
        ),
      ),
      total,
    },
  };
}

export type AgentStepSummary = {
  step: string;
  label: string;
  status: string;
  detail: unknown;
  errorReason: string | null;
  startedAt: string;
  endedAt: string | null;
};

function toStepSummary(row: AgentStepEventRow): AgentStepSummary {
  return {
    step: row.step,
    label: row.label,
    status: row.status,
    detail: row.detail,
    errorReason: row.errorReason,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt ? row.endedAt.toISOString() : null,
  };
}

const LOAD_CONTEXT_LABEL: Record<(typeof JOB_BACKED_AGENT_IDS)[number], string> = {
  lead_enrichment: "Loading contact & company context",
  lead_scoring: "Loading contact & company context",
  lead_nurture: "Loading contact context",
  lead_lifecycle: "Loading contact & deal context",
  email_auto_reply: "Loading the inbound message & thread context",
};

/**
 * Jobs that never reached Python (contact missing, budget exceeded before
 * a graph node fired, historical runs from before tracing) have no
 * agent_step_events rows. Reconstruct the first step from the job outcome
 * so the activity timeline is not blank. Only applies to job-backed agents
 * — events-backed agents only ever have a run row because at least one
 * event was recorded, so there is nothing to synthesize for them.
 */
function synthesizeTerminalSteps(
  agentId: (typeof JOB_BACKED_AGENT_IDS)[number],
  job: AgentRunJobRow,
): AgentStepSummary[] {
  const startedAt = job.createdAt.toISOString();
  const endedAt = (job.completedAt ?? job.updatedAt).toISOString();
  const reason = job.lastError;
  const label = LOAD_CONTEXT_LABEL[agentId];
  const base = {
    step: "load_context",
    label,
    detail: null as unknown,
    startedAt,
    endedAt,
  };

  if (job.status === "failed" || reason === "job_budget_exceeded") {
    return [
      {
        ...base,
        status: "failed",
        errorReason: reason ?? "failed",
      },
    ];
  }
  if (job.status === "skipped" || reason === "contact_not_found") {
    const summary =
      job.resultSummary &&
      typeof job.resultSummary === "object" &&
      !Array.isArray(job.resultSummary)
        ? (job.resultSummary as Record<string, unknown>)
        : null;
    const summaryReason =
      typeof summary?.reason === "string" && summary.reason.trim()
        ? summary.reason.trim()
        : null;
    return [
      {
        ...base,
        status: "skipped",
        errorReason: reason ?? summaryReason ?? "contact_not_found",
      },
    ];
  }
  if (job.status === "waited") {
    return [
      {
        ...base,
        status: "ok",
        errorReason: null,
      },
    ];
  }
  return [];
}

function isJobBackedAgentId(
  id: SupportedAgentId,
): id is (typeof JOB_BACKED_AGENT_IDS)[number] {
  return (JOB_BACKED_AGENT_IDS as readonly string[]).includes(id);
}

/**
 * Step trace for one agent run — the dedicated run-detail page. Includes
 * the run summary (contact, status, timing) so the page has a header without
 * a second round-trip.
 */
export async function getAgentRunStepsCommand(
  agentId: string,
  jobId: string,
): Promise<
  | { ok: true; data: { run: AgentRunSummary; steps: AgentStepSummary[] } }
  | { ok: false; error: string; status: number }
> {
  const role = await getCurrentUserRole();
  if (!canViewAgents(role)) {
    return {
      ok: false,
      error: "Only admins and sales managers can view Agents.",
      status: 403,
    };
  }
  if (!isSupportedAgentId(agentId)) {
    return { ok: false, error: "Unsupported agent.", status: 404 };
  }
  const organizationId = await resolveRequestOrganizationId();
  const job = await findRunById(agentId, organizationId, jobId);
  if (!job) {
    return { ok: false, error: "Not found.", status: 404 };
  }
  const [contactsById, stored] = await Promise.all([
    job.contactId ? getContactHydrateByIds([job.contactId]) : Promise.resolve(new Map()),
    listStepsForJob(jobId),
  ]);
  const steps =
    stored.length > 0
      ? stored.map(toStepSummary)
      : isJobBackedAgentId(agentId)
        ? synthesizeTerminalSteps(agentId, job)
        : [];

  let subject: { label: string | null; href: string | null } | null = null;
  if (!job.contactId) {
    const { getPrismaClient } = await import("@/dao/db/prisma");
    const prisma = getPrismaClient();
    if (job.companyId) {
      const company = await prisma.company.findFirst({
        where: { id: job.companyId, organizationId },
        select: { name: true },
      });
      subject = {
        label: company?.name || `Company ${job.companyId.slice(0, 8)}`,
        href: `/company/${job.companyId}`,
      };
    } else if (job.dealId) {
      const deal = await prisma.deal.findFirst({
        where: { id: job.dealId, organizationId },
        select: { title: true },
      });
      subject = {
        label: deal?.title || `Deal ${job.dealId.slice(0, 8)}`,
        href: `/sales/${job.dealId}`,
      };
    } else if (job.invoiceId) {
      const invoice = await prisma.invoice.findFirst({
        where: { id: job.invoiceId, organizationId },
        select: { number: true },
      });
      subject = {
        label: invoice?.number
          ? `Invoice ${invoice.number}`
          : `Invoice ${job.invoiceId.slice(0, 8)}`,
        href: `/finance/${job.invoiceId}`,
      };
    } else {
      subject = { label: "Run", href: null };
    }
  }

  return {
    ok: true,
    data: {
      run: toRunSummary(
        agentId,
        job,
        job.contactId ? contactsById.get(job.contactId) : null,
        subject,
      ),
      steps,
    },
  };
}
