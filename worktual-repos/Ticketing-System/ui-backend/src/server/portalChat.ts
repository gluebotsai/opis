import {
  getPublishedHelpArticle,
} from "./helpCenter";
import { findActiveCustomer } from "./customersDirectory";
import type { PortalAuthMode, PortalCustomer } from "./portalAuth";
import { query } from "./db";
import { emitAraOnDemand } from "./proactiveOutbox";

const COWORKER_AGENTS_URL = (
  process.env.COWORKER_AGENTS_URL || "http://127.0.0.1:8012"
).replace(/\/$/, "");

type PortalArticle = {
  id: string;
  title: string;
  excerpt: string;
  category: string;
};

type ChatTurn = { role?: string; text?: string };

function tasksSecret(): string {
  const secret = String(process.env.COWORKER_TASKS_SECRET || "").trim();
  if (secret) return secret;
  return "worktual-tasks-dev-secret";
}

/** Compact ticket catalog for ARA LLM (no code coreference). */
async function listCustomerTicketsForAra(customer: PortalCustomer): Promise<
  Array<{ ticket_number: string; status: string; subject: string }>
> {
  const { rows } = await query(
    `SELECT ticket_number, status, subject
       FROM tickets
      WHERE organization_id = $1
        AND (
          customer_id = $2::bigint
          OR lower(customer_email) = lower($3)
        )
      ORDER BY updated_at DESC NULLS LAST
      LIMIT 20`,
    [customer.organizationId, customer.id, customer.email || "__none__"]
  );
  return rows.map((r) => ({
    ticket_number: String(r.ticket_number || ""),
    status: String(r.status || ""),
    subject: String(r.subject || ""),
  }));
}

/**
 * After every authenticated portal-bot turn, let ARA LLM read the conversation
 * and decide close/reopen (Approvals). Chat bot does not mutate ticket status.
 */
function emitPortalChatAraMonitor(opts: {
  customer: PortalCustomer;
  organizationId: string;
  message: string;
  history: ChatTurn[];
}): void {
  void listCustomerTicketsForAra(opts.customer)
    .then((customerTickets) =>
      emitAraOnDemand({
        organizationId: opts.organizationId,
        text: opts.message,
        history: opts.history,
        customerTickets,
        actorId: opts.customer.id,
        customerName: opts.customer.name,
        channel: "portal_chat",
      })
    )
    .catch((err) =>
      console.warn("portal chat ARA emit skipped:", (err as Error).message)
    );
}

export async function runPortalChat(input: {
  organizationId: string;
  slug: string;
  message: string;
  sessionId?: string;
  history?: Array<{ role: string; text: string }>;
  customer?: PortalCustomer | null;
  authMode: PortalAuthMode;
}): Promise<{
  reply: string;
  articles: PortalArticle[];
  ui_actions: unknown[];
  agent: string;
}> {
  const message = String(input.message || "").trim();
  const authed = Boolean(input.customer);
  const history = Array.isArray(input.history) ? input.history : [];

  // Always native agent-turn — specialist LLM is the only user-facing reply path.
  // ARA monitors the same turn separately (LLM intent → Approvals).
  try {
    const { callAiServiceAgent } = await import("./ai/aiServiceClient");
    const { issueMcpExecutionToken } = await import("./ai/mcpToken");
    const mcpToken = issueMcpExecutionToken({
      organizationId: input.organizationId,
      actorId: input.customer?.id || `portal-guest:${input.organizationId}`,
      role: authed ? "portal_customer" : "portal_guest",
      module: "portal",
      surface: "home",
      runId: input.sessionId || undefined,
    });
    const data = (await callAiServiceAgent({
      agentName: "ticketing-coworker",
      message,
      organizationId: input.organizationId,
      sessionId:
        input.sessionId || `portal_${input.slug}_${input.customer?.id || "guest"}`,
      userId: input.customer?.id || `portal-guest:${input.organizationId}`,
      userName: input.customer?.name || "Visitor",
      userRole: authed ? "portal_customer" : "portal_guest",
      canCreateTicket: authed,
      history,
      // Tool allowlist is ("portal","home") — do not send surface "portal".
      surface: "home",
      module: "portal",
      page: "Support portal",
      pageSurface: "home",
      portalAuthenticated: authed,
      portalAuthMode: input.authMode,
      portalCustomerId: input.customer?.id || null,
      mcpToken,
      executionMode: "native",
    })) as {
      assistantText?: string;
      reply?: string;
      agent?: string;
      articles?: unknown[];
      ui_actions?: unknown[];
      data?: { articles?: unknown[]; agent?: string };
      source?: string;
      serviceError?: unknown;
    };
    const reply = String(data.assistantText || data.reply || "").trim();
    const uiActions = Array.isArray(data.ui_actions) ? data.ui_actions : [];
    if (data.source === "error" || data.serviceError) {
      const se =
        data.serviceError && typeof data.serviceError === "object"
          ? (data.serviceError as { code?: string; message?: string })
          : null;
      console.warn(
        "portal chat agent envelope error:",
        se?.code || se?.message || data.serviceError
      );
      throw Object.assign(
        new Error(
          se?.message
            ? `Co-worker agents error: ${se.message}`
            : "Co-worker agents are temporarily unavailable."
        ),
        { status: 503 }
      );
    }
    const payload = data.data && typeof data.data === "object" ? data.data : {};
    const rawArticles = Array.isArray(data.articles)
      ? data.articles
      : Array.isArray(payload.articles)
        ? payload.articles
        : [];
    const articles: PortalArticle[] = rawArticles
      .map((row) => {
        if (!row || typeof row !== "object") return null;
        const r = row as Record<string, unknown>;
        const id = String(r.id || "").trim();
        const title = String(r.title || "").trim();
        if (!id && !title) return null;
        const excerpt = String(
          r.excerpt || r.content || r.body || ""
        ).trim();
        return {
          id: id || title,
          title: title || "Untitled",
          excerpt: excerpt.slice(0, 240),
          category: String(r.category || ""),
        } satisfies PortalArticle;
      })
      .filter((a): a is PortalArticle => Boolean(a));
    if (reply || uiActions.length) {
      if (input.customer) {
        emitPortalChatAraMonitor({
          customer: input.customer,
          organizationId: input.organizationId,
          message,
          history,
        });
      }
      return {
        reply,
        articles,
        ui_actions: uiActions,
        agent: String(data.agent || payload.agent || "kb"),
      };
    }
  } catch (err) {
    if (err && typeof err === "object" && "status" in err) {
      const status = Number((err as { status?: number }).status || 0);
      const payload =
        err && typeof err === "object" && "payload" in err
          ? ((err as { payload?: Record<string, unknown> }).payload || {})
          : {};
      const detail = payload.detail;
      const envelope =
        detail && typeof detail === "object"
          ? (detail as Record<string, unknown>)
          : payload;
      const serviceError = envelope.serviceError;
      console.warn(
        "portal chat agents unavailable:",
        (err as Error).message,
        serviceError || ""
      );
      // Normalize AI 4xx tool/auth failures to 503 so the portal paints a stable message.
      throw Object.assign(
        new Error("Co-worker agents are temporarily unavailable."),
        { status: status >= 500 ? status : 503, payload: envelope }
      );
    }
    console.warn("portal chat agents unavailable:", (err as Error).message);
  }

  throw Object.assign(new Error("Co-worker agents are temporarily unavailable."), {
    status: 503,
  });
}

export async function loadPortalArticle(organizationId: string, articleId: string) {
  return getPublishedHelpArticle({ organizationId, articleId });
}

export async function loadPortalCustomerProfile(customer: PortalCustomer) {
  return findActiveCustomer({
    organizationId: customer.organizationId,
    customerId: customer.id,
  });
}
