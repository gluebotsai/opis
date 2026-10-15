/**
 * Offline / chrome helpers only. Live chat meaning lives in LangGraph.
 * Do not call routeCoworkerIntent from CoworkerChatPanel while agents are online.
 * Optional `role` gates create/navigate to modules the user cannot access.
 * `reply` is a seed/fallback — App rephrases via LLM guided-reply.
 */
import {
  canAccessModule,
  type AppRole,
} from "../../rbac";

export type CoworkerIntentResult = {
  reply: string;
  navigate?: string;
  ticketSearch?: string;
  ticketPriority?: string;
  ticketStatus?: string;
  kbSearch?: string;
  customerSearch?: string;
  teamsSearch?: string;
  /** Open guided create-team flow after navigating to Teams. */
  teamsCreate?: boolean;
  /** Open guided create-ticket flow (name → contact → issue). */
  ticketCreate?: boolean;
  /** Open guided create-macro flow (title → body → confirm). */
  macroCreate?: boolean;
  /** Open guided create-priority flow. */
  priorityCreate?: boolean;
  /** Open KB create form. */
  kbCreate?: boolean;
  /** Escalate / reassign ticket to a resolver (chat). */
  escalateToResolver?: boolean;
  /** Optional ticket number, with or without leading #. */
  ticketNumber?: string;
  /** Optional named assignee (e.g. "assign to Yaswanth"). */
  assigneeHint?: string;
};

/**
 * Asking for information ("how many teams there?", "who is free") rather than
 * commanding a view change ("show teams"). Questions go to the agents so they
 * can answer with live data and supply the module to route to.
 * Module how-tos ("how to write macros") are NOT data questions — see routeModuleOpen.
 */
export function isDataQuestion(raw: string): boolean {
  const lower = raw.trim().toLowerCase();
  if (!lower) return false;
  // Module how-to / write → navigate path, not specialist-only
  if (routeModuleOpen(raw)) return false;
  if (/\b(how many|how much|what can you)\b/.test(lower)) return true;
  if (/\b(which|what)\b.*\b(ticket|name|customer|created|filed)\b/.test(lower)) return true;
  return /^(how|what|what's|whats|who|whose|whom|when|where|why|which|is|are|do|does|did|can|could|should)\b/.test(
    lower
  );
}

/** Collapse common create/macro typos so offline intents match LangGraph. */
export function normalizeCoworkerTypos(raw: string): string {
  let t = (raw || "").trim().toLowerCase().replace(/[!?.,]+$/g, "");
  t = t.replace(/\b(creaye|craete|creat|crate|crete|creaet|craeate)\b/g, "create");
  t = t.replace(/\b(makro|macor)s?\b/g, "macros");
  return t;
}

/** Open/write/how-to for sidebar modules (parity with ai-agents _module_nav_fallback). */
export function routeModuleOpen(
  raw: string,
  role?: AppRole
): CoworkerIntentResult | null {
  const lower = normalizeCoworkerTypos(raw);
  if (!lower) return null;
  if (/\b(how\s+many|how\s+much|count)\b/.test(lower)) return null;

  const intentVerb =
    /\b(open|go\s+to|show|navigate|take\s+me\s+to|switch\s+to|write|create|new|add|edit|manage|list|use|how\s+to|how\s+do\s+i|help\s+(?:me\s+)?(?:with|on|to))\b/.test(
      lower
    );

  const denied = (feature: string): CoworkerIntentResult => ({
    reply: `Intent: role cannot use ${feature}; suggest My Tickets or Knowledge Base.`,
  });

  const go = (
    view: Parameters<typeof canAccessModule>[1],
    label: string,
    hint?: string
  ): CoworkerIntentResult | null => {
    if (role && !canAccessModule(role, view)) return denied(label);
    return {
      reply: hint || `Intent: open ${label}.`,
      navigate: view,
    };
  };

  if (/\bmacros?\b/.test(lower) && (intentVerb || lower === "macros" || lower === "macro")) {
    const write = /\b(write|create|new|add|edit|how\s+to|how\s+do\s+i)\b/.test(lower);
    if (role && !canAccessModule(role, "macros")) return denied("Macros");
    return {
      reply: write
        ? "Intent: open Macros and start create-macro (title → body → confirm)."
        : "Intent: open Macros.",
      navigate: "macros",
      macroCreate: write || undefined,
    };
  }
  if (/\brecent\s+activit|\b(show|open|view|see)\s+(my\s+)?(recent\s+)?activit|\blatest\s+activit/.test(lower)
    && !/\baudit\b/.test(lower)
  ) {
    return go("dashboard", "Dashboard");
  }
  if (/\baudit(\s+log)?\b/.test(lower) && (intentVerb || /\baudit\b/.test(lower))) {
    return go("audit", "Audit log");
  }
  if (/\bcsat(\s+reports?)?\b/.test(lower) && (intentVerb || lower.startsWith("csat"))) {
    return go("csat-reports", "CSAT reports");
  }
  if (
    /\bpriorit(y|ies)\b/.test(lower) &&
    !/\b(ticket|tickets|cases?)\b/.test(lower) &&
    !/\bcategor(y|ies)\b/.test(lower) &&
    (intentVerb || lower === "priorities" || lower === "priority")
  ) {
    const write = /\b(create|add|new)\b/.test(lower);
    if (role && !canAccessModule(role, "priorities")) return denied("Priorities");
    return {
      reply: write
        ? "Intent: open Priorities and start create-priority."
        : "Intent: open Priorities.",
      navigate: "priorities",
      priorityCreate: write || undefined,
    };
  }
  if (
    /\bescalation\s+director(y|ies)\b/.test(lower) ||
    (/\bescalation\b/.test(lower) &&
      /\b(directory|open|go\s+to|show|navigate|manage)\b/.test(lower) &&
      !/\b(ticket|tickets|escalate\s+(a\s+)?ticket)\b/.test(lower))
  ) {
    return go("escalation-directory", "Escalation directory");
  }
  if (
    /\b(org(anization)?\s+preferences?|org\s+prefs?)\b/.test(lower) &&
    (intentVerb || /\b(org(anization)?\s+preferences?|org\s+prefs?)\b/.test(lower))
  ) {
    return go("org-preferences", "Org preferences");
  }
  // Parity with ai-agents `_module_nav_fallback` (Tickets / KB / Settings / Dashboard / Work board).
  if (
    (/\b(go\s+to|open|show|navigate\s+to)\s+search\b/.test(lower) ||
      /^(search|search\s+page|search\s+view|ticket\s+search)$/.test(lower)) &&
    !/\bsearch\s+(for|about)\b/.test(lower)
  ) {
    return go("assigned", "Tickets");
  }
  if (
    (/\b(knowledge\s*base|\bkb\b)\b/.test(lower) || lower === "kb" || lower === "knowledge base") &&
    (intentVerb || lower === "kb" || lower === "knowledge base")
  ) {
    return go("kb", "Knowledge Base");
  }
  if (/\bsettings\b/.test(lower) && (intentVerb || lower === "settings")) {
    return go("settings", "Settings");
  }
  if (
    /\b(home|dashboard|overview)\b/.test(lower) &&
    (intentVerb || lower === "home" || lower === "dashboard" || lower === "overview")
  ) {
    return go("dashboard", "Dashboard");
  }
  if (/\bwork[\s-]?board\b/.test(lower) || /^(open|go\s+to|show)\s+work\b/.test(lower)) {
    return go("work-board", "Work board");
  }
  return null;
}

/** Pure greetings / small-talk — never treat as in-page search. */
export function isGreetingOrChitchat(raw: string): boolean {
  const lower = raw.trim().toLowerCase().replace(/[!?.,]+$/g, "");
  if (!lower) return false;
  if (
    /^(hi|hello|hey|yo|sup|hola|namaste|good\s*(morning|afternoon|evening)|gm|greetings|howdy)(\s+there)?$/.test(
      lower
    )
  ) {
    return true;
  }
  if (/^(thanks|thank you|thx|ty|ok|okay|cool|great|nice|bye|goodbye|see you)$/.test(lower)) {
    return true;
  }
  return false;
}

/** Short one-token replies — never soft-search the ticket list for these. */
export function isShortAck(raw: string): boolean {
  const lower = raw.trim().toLowerCase().replace(/[!?.,]+$/g, "");
  if (!lower || /\s/.test(lower)) return false;
  if (/[0-9@#]/.test(lower)) return false;
  if (lower.length > 16) return false;
  if (
    /^(tickets?|teams?|queues?|customers?|kb|articles?|macros?|priorities|status|home|inbox)$/.test(
      lower
    )
  ) {
    return false;
  }
  return true;
}

/**
 * "list all" / "show all" / "clear filter" — clear module search, never use the
 * phrase itself as a filter token (that yields 0 hits).
 */
export function isListAllIntent(raw: string): boolean {
  const lower = raw.trim().toLowerCase().replace(/[!?.,]+$/g, "");
  if (!lower) return false;
  if (
    /^(list|show|display|get|see|view)\s+(all|everything)(\s+(of\s+them|items|records|entries|please))?$/.test(
      lower
    )
  ) {
    return true;
  }
  if (
    /^(list|show|display|get|see|view)\s+all\s+(the\s+)?(customers?|clients?|teams?|queues?|articles?|kb|knowledge(\s*base)?)$/.test(
      lower
    )
  ) {
    return true;
  }
  if (
    /^(all|every)\s+(customers?|clients?|teams?|queues?|articles?)$/.test(lower)
  ) {
    return true;
  }
  if (/^(clear|reset|remove)\s+(the\s+)?(search|filter|filters)$/.test(lower)) {
    return true;
  }
  if (/^(show|list)\s+unfiltered$/.test(lower)) return true;
  if (/^(show|list)\s+everyone$/.test(lower)) return true;
  if (/^(all|everything)$/.test(lower)) return true;
  return false;
}

function extractAfter(patterns: RegExp[], text: string): string | null {
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]?.trim()) return m[1].trim().replace(/^["']|["']$/g, "");
  }
  return null;
}

function extractTicketNumber(text: string): string | undefined {
  const m =
    text.match(/#\s*([A-Za-z0-9][\w-]*)/) ||
    text.match(/\btickets?\s+#?\s*([A-Za-z0-9][\w-]*)/i) ||
    text.match(/\bcases?\s+#?\s*([A-Za-z0-9][\w-]*)/i);
  if (!m?.[1]) return undefined;
  const raw = m[1].trim();
  if (
    /^(to|for|the|a|an|resolver|agent|me|my|status|priority|update|change|set|modify|edit|assignee|queue)$/i.test(
      raw
    )
  ) {
    return undefined;
  }
  return raw.startsWith("#") ? raw : `#${raw}`;
}

function extractAssigneeHint(lower: string, text: string): string | undefined {
  const m =
    text.match(
      /\b(?:assign|escalate|reassign|hand\s*off|handoff)\s+(?:(?:this|the|that)\s+)?(?:ticket|case)?\s*(?:#?\S+\s+)?(?:to|onto)\s+(?!resolver\b|agent\b)([A-Za-z][A-Za-z .'-]{1,60})/i
    ) ||
    text.match(/\b(?:to|onto)\s+(?!resolver\b|agent\b)([A-Za-z][A-Za-z .'-]{1,40})$/i);
  if (!m?.[1]) return undefined;
  const name = m[1].replace(/[.?!,]+$/g, "").trim();
  if (!name || /^(resolver|agent|me|someone|anybody)$/i.test(name)) return undefined;
  return name;
}

function isUpdateTicketStatusIntent(lower: string): boolean {
  if (!/\bstatus\b/.test(lower)) return false;
  if (/\b(update|change|set|modify|edit|move)\b/.test(lower)) return true;
  if (/\btickets?\b.*\b(to|as)\b.*\b(open|pending|resolved|closed|hold)\b/.test(lower)) {
    return true;
  }
  return /\b(mark|make)\b.*\b(open|pending|resolved|closed|on\s*hold)\b/.test(lower);
}

export function routeCoworkerIntent(
  raw: string,
  currentView: string,
  role?: AppRole
): CoworkerIntentResult | null {
  const text = raw.trim();
  if (!text) return null;
  const lower = text.toLowerCase();

  const denied = (feature: string): CoworkerIntentResult => ({
    reply: `Intent: role cannot use ${feature}; suggest My Tickets or Knowledge Base.`,
  });

  // Sidebar module open/write/how-to before data-question short-circuit
  const moduleOpen = routeModuleOpen(text, role);
  if (moduleOpen) return moduleOpen;

  // Data questions / acks / chitchat → agents (history + live data). Do this
  // BEFORE ticket browse so "how many tickets are there?" is not a filter.
  if (isGreetingOrChitchat(text) || isShortAck(text) || isDataQuestion(text)) {
    return null;
  }

  // "list all" / "clear filter" → clear search on the current (or named) module.
  // Never treat the words "list all" as a search string.
  if (isListAllIntent(text)) {
    const mentionsCustomers = /\b(customers?|clients?)\b/.test(lower);
    const mentionsKb = /\b(kb|knowledge|articles?)\b/.test(lower);
    const mentionsTeams = /\b(teams?|queues?)\b/.test(lower);
    if (mentionsCustomers) {
      return {
        reply: "Intent: show all customers; filters cleared; list is on the right.",
        navigate: currentView === "customers" ? undefined : "customers",
        customerSearch: "",
      };
    }
    if (mentionsKb) {
      return {
        reply: "Intent: show all Knowledge Base articles; filters cleared; list is on the right.",
        navigate: currentView === "kb" ? undefined : "kb",
        kbSearch: "",
      };
    }
    if (mentionsTeams) {
      return {
        reply: "Intent: show all teams; filters cleared; list is on the right.",
        navigate: currentView === "agent-queues" ? undefined : "agent-queues",
        teamsSearch: "",
      };
    }
    // No module named — clear whatever list is currently open.
    if (currentView === "customers") {
      return {
        reply: "Intent: show all customers; filters cleared; list is on the right.",
        customerSearch: "",
      };
    }
    if (currentView === "kb") {
      return {
        reply: "Intent: show all articles; filters cleared; list is on the right.",
        kbSearch: "",
      };
    }
    if (currentView === "agent-queues") {
      return {
        reply: "Intent: show all teams; filters cleared; list is on the right.",
        teamsSearch: "",
      };
    }
    if (
      ["team-queue", "team-inbox", "unassigned", "assigned", "search"].includes(currentView)
    ) {
      return null;
    }
    return {
      reply: "Intent: cleared list filters; list is on the right.",
      customerSearch: "",
      kbSearch: "",
      teamsSearch: "",
    };
  }

  // "update ticket status" must NOT become a text search for "status" (0 hits).
  if (isUpdateTicketStatusIntent(lower)) {
    const ticketNumber = extractTicketNumber(text);
    return {
      reply: ticketNumber
        ? `Intent: open ${ticketNumber} for status update; ask for new status if unknown.`
        : "Intent: open tickets for status update; ask for ticket number and new status.",
      navigate: "tickets-list",
      ticketSearch: "",
      ticketNumber,
    };
  }

  const escalateIntent =
    /\b(escalat(e|ion|ing)|reassign|hand\s*off|handoff)\b/.test(lower) ||
    /\bassign\b.*\b(to\s+)?resolver\b/.test(lower) ||
    /\b(to|onto)\s+resolver\b/.test(lower) ||
    /\bresolver\b.*\b(assign|escalate|reassign)\b/.test(lower) ||
    (/\b(assign|escalate|reassign)\b/.test(lower) &&
      /\bto\b/.test(lower) &&
      !/\b(create|new|file)\b/.test(lower));
  if (escalateIntent) {
    const ticketNumber = extractTicketNumber(text);
    const assigneeHint = extractAssigneeHint(lower, text);
    const toResolver = /\bresolver\b/.test(lower) || !assigneeHint;
    return {
      reply: ticketNumber
        ? `Intent: escalate ${ticketNumber}${
            assigneeHint
              ? ` to ${assigneeHint}`
              : toResolver
                ? " to a resolver"
                : ""
          }.`
        : assigneeHint
          ? `Intent: escalate current ticket to ${assigneeHint}.`
          : "Intent: escalate current ticket to a resolver.",
      navigate: "tickets-list",
      escalateToResolver: true,
      ticketNumber,
      assigneeHint: toResolver && !assigneeHint ? undefined : assigneeHint,
    };
  }

  if (
    /\b(delete|remove)\b.*\b(team|queue)\b/.test(lower) ||
    /\b(team|queue)\b.*\b(delete|remove)\b/.test(lower)
  ) {
    if (role && !canAccessModule(role, "agent-queues")) {
      return denied("Teams");
    }
    // Offline fallback: navigate to Teams — LangGraph owns actual delete.
    return {
      reply: "Intent: delete a team; open Teams and confirm the delete in chat.",
      navigate: "agent-queues",
    };
  }

  if (
    /\b(add|include)\b.*\bmembers?\b/.test(lower) ||
    (/\b(add|include)\b.+\b(to|in)\b.+\b(team|queue)\b/.test(lower) &&
      !/\b(create|new)\b.*\b(team|queue)\b/.test(lower))
  ) {
    if (role && !canAccessModule(role, "agent-queues")) {
      return denied("Teams");
    }
    return {
      reply:
        "Intent: add members to an existing team — not create a new team; LangGraph will update membership.",
      navigate: "agent-queues",
    };
  }

  if (
    (/\b(create|new)\b.*\b(team|queue)\b/.test(lower) || lower === "create team") &&
    !/\bmembers?\b/.test(lower)
  ) {
    if (role && !canAccessModule(role, "agent-queues")) {
      return denied("Teams");
    }
    return {
      reply:
        "Intent: start create-team guided flow; ask for the team name next.",
      navigate: "agent-queues",
      teamsCreate: true,
    };
  }

  const teamQuery = extractAfter(
    [
      /(?:find|search|show|list)\s+(?:team|teams|queue|queues)\s+(?:named\s+|called\s+)?(.+)/i,
      /(?:team|queue)\s+(?:named\s+|called\s+)?["']?(.+?)["']?$/i,
    ],
    text
  );
  if (
    teamQuery ||
    /\b(list|show|my)\b.*\b(team|queue)/.test(lower) ||
    lower === "teams" ||
    lower === "show teams"
  ) {
    if (role && !canAccessModule(role, "agent-queues")) {
      return denied("Teams");
    }
    return {
      reply: teamQuery
        ? `Intent: show teams matching ${teamQuery}.`
        : "Intent: open Teams.",
      navigate: "agent-queues",
      teamsSearch: teamQuery || "",
    };
  }

  const kbQuery = extractAfter(
    [
      /(?:kb|knowledge\s*base|article|articles)\s+(?:for\s+|about\s+|on\s+)?(.+)/i,
      /(?:find|search|show)\s+(?:kb|knowledge|article|articles)\s+(?:for\s+|about\s+)?(.+)/i,
      /(?:how\s+to|help\s+with)\s+(.+)/i,
    ],
    text
  );
  if (kbQuery || /\b(knowledge\s*base|kb articles?|articles)\b/.test(lower) || lower === "kb") {
    if (role && !canAccessModule(role, "kb")) {
      return denied("Knowledge Base");
    }
    return {
      reply: kbQuery
        ? `Intent: search Knowledge Base for ${kbQuery}.`
        : "Intent: open Knowledge Base.",
      navigate: "kb",
      kbSearch: kbQuery || "",
    };
  }

  const customerQuery = extractAfter(
    [
      /(?:find|search|show|look\s*up)\s+(?:customer|customers|client|clients)\s+(.+)/i,
      /(?:customer|client)\s+(?:named\s+|called\s+)?(.+)/i,
    ],
    text
  );
  if (
    customerQuery ||
    (/\b(customers?|clients?)\b/.test(lower) && !/\btickets?\b/.test(lower))
  ) {
    if (role && !canAccessModule(role, "customers")) {
      return denied("Customers");
    }
    const q = customerQuery?.trim() || "";
    // "show customers all" / extracted "all" must clear, not search for "all"
    if (!q || isListAllIntent(q) || /^(all|everything)$/i.test(q)) {
      return {
        reply: "Intent: open Customers with no filter.",
        navigate: "customers",
        customerSearch: "",
      };
    }
    return {
      reply: `Intent: search customers for ${q}.`,
      navigate: "customers",
      customerSearch: q,
    };
  }

  if (/\b(analytics|reports?|metrics|stats)\b/.test(lower)) {
    if (role && !canAccessModule(role, "analytics")) {
      return denied("Analytics");
    }
    return { reply: "Intent: open Analytics.", navigate: "analytics" };
  }
  if (/\b(home|dashboard|overview)\b/.test(lower)) {
    return { reply: "Intent: open Dashboard.", navigate: "dashboard" };
  }
  if (/\bsettings\b/.test(lower)) {
    return { reply: "Intent: open Settings.", navigate: "settings" };
  }
  if (
    /\bwork[\s-]?board\b/.test(lower) ||
    /^(open|go\s+to|show)\s+work\b/.test(lower)
  ) {
    if (role && !canAccessModule(role, "work-board")) {
      return denied("Work board");
    }
    return { reply: "Intent: open Work board.", navigate: "work-board" };
  }
  if (text.length < 3) return null;

  // Never soft-search by dumping the raw utterance into filters.
  // List/search/clear is handled by structured UI actions (LLM tool catalog).
  return null;
}
