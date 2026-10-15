/**
 * Rule-based co-worker intents for explicit navigate + filter commands.
 * Optional `role` gates create/navigate to modules the user cannot access.
 * `reply` is a seed/fallback — App rephrases via LLM guided-reply.
 */
import {
  canAccessModule,
  canCreateTicket,
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
 */
export function isDataQuestion(raw: string): boolean {
  const lower = raw.trim().toLowerCase();
  if (!lower) return false;
  if (/\b(how many|how much|how do i|how does|what can you)\b/.test(lower)) return true;
  if (/\b(which|what)\b.*\b(ticket|name|customer|created|filed)\b/.test(lower)) return true;
  return /^(how|what|what's|whats|who|whose|whom|when|where|why|which|is|are|do|does|did|can|could|should)\b/.test(
    lower
  );
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
    /^(list|show|display|get|see|view)\s+all\s+(the\s+)?(customers?|clients?|tickets?|teams?|queues?|articles?|kb|knowledge(\s*base)?)$/.test(
      lower
    )
  ) {
    return true;
  }
  if (
    /^(all|every)\s+(customers?|clients?|tickets?|teams?|queues?|articles?)$/.test(lower)
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

/** Create-ticket phrasing including common typos (craete, creat, …). */
export function isCreateTicketIntent(raw: string): boolean {
  // Collapse spaced typos: "tic ket" / "tick et" → "ticket"
  const lower = raw
    .trim()
    .toLowerCase()
    .replace(/\btic\s*ket\b/g, "ticket")
    .replace(/\btick\s*et\b/g, "ticket")
    .replace(/\bticekt\b/g, "ticket")
    .replace(/\btikcet\b/g, "ticket");
  if (!lower) return false;
  if (/\b(open|my|all|list|show|search|find)\s+tickets?\b/.test(lower)) return false;
  if (
    /^(create|craete|creat|crete|crate|make|file|new)\s+(a\s+)?(new\s+)?(ticket|case)$/.test(
      lower
    )
  ) {
    return true;
  }
  if (
    /\b(create|craete|creat|crete|crate|file|new|make)\b.*\b(tickets?|cases?)\b/.test(lower) ||
    /\bopen\s+(a\s+)?(new\s+)?(ticket|case)\b/.test(lower) ||
    /\b(tickets?|cases?)\b.*\b(create|craete|creat|file|new)\b/.test(lower)
  ) {
    return true;
  }
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

/** Words that look like ticket search tokens but are UI/meta commands. */
const TICKET_QUERY_STOPWORDS =
  /^(all|open|my|unassigned|assigned|the|team|are|there|been|created|status|priority|update|change|set|modify|edit|assignee|queue|list|show|find|search)$/i;

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
    reply: `Intent: role cannot use ${feature}; suggest My Tickets, Search, or Knowledge Base.`,
  });

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
    const mentionsTickets = /\btickets?\b/.test(lower);

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
    if (mentionsTickets) {
      return {
        reply: "Intent: show all tickets; filters cleared; list is on the right.",
        ticketSearch: "",
      };
    }
    // No module named — clear whatever list is currently open.
    if (currentView === "customers") {
      return { reply: "Intent: show all customers; filters cleared; list is on the right.", customerSearch: "" };
    }
    if (currentView === "kb") {
      return { reply: "Intent: show all articles; filters cleared; list is on the right.", kbSearch: "" };
    }
    if (currentView === "agent-queues") {
      return { reply: "Intent: show all teams; filters cleared; list is on the right.", teamsSearch: "" };
    }
    if (
      ["team-queue", "team-inbox", "unassigned", "assigned", "search"].includes(currentView)
    ) {
      return { reply: "Intent: show all tickets; filters cleared; list is on the right.", ticketSearch: "" };
    }
    return {
      reply: "Intent: cleared list filters; list is on the right.",
      ticketSearch: "",
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

  if (isCreateTicketIntent(text)) {
    if (role && !canCreateTicket(role)) {
      return denied("Create ticket");
    }
    return {
      reply:
        "Intent: start create-ticket guided flow; ask for customer full name next.",
      navigate: "create-ticket",
      ticketCreate: true,
    };
  }

  if (/\b(create|add|new)\b.*\b(team|queue)\b/.test(lower) || lower === "create team") {
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
    return { reply: "Intent: open Home.", navigate: "dashboard" };
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
  if (
    /^(go\s+to\s+|open\s+|show\s+)?search$/.test(lower) ||
    /\b(go\s+to|open|show)\s+search\b/.test(lower)
  ) {
    if (role && !canAccessModule(role, "search")) {
      return denied("Search");
    }
    return { reply: "Intent: open Search.", navigate: "search" };
  }

  let ticketPriority: string | undefined;
  let ticketStatus: string | undefined;
  if (/\b(urgent|p1)\b/.test(lower)) ticketPriority = "urgent";
  else if (/\b(high|p2)\b/.test(lower)) ticketPriority = "high";
  else if (/\bmedium\b/.test(lower)) ticketPriority = "medium";
  else if (/\blow\b/.test(lower)) ticketPriority = "low";

  if (/\b(resolved|closed)\b/.test(lower)) ticketStatus = "Resolved";
  else if (/\b(pending|waiting)\b/.test(lower)) ticketStatus = "In Progress";
  else if (/\b(open|unresolved|active)\b/.test(lower) && /\bticket/.test(lower))
    ticketStatus = "Open";

  if (
    /\bunassigned\b/.test(lower) ||
    /\b(no\s+owner|without\s+assignee|not\s+assigned)\b/.test(lower)
  ) {
    if (role && !canAccessModule(role, "unassigned")) {
      return denied("Unassigned");
    }
    return {
      reply: ticketPriority
        ? `Intent: show Unassigned tickets filtered to ${ticketPriority} priority; list on the right.`
        : "Intent: show Unassigned tickets; list on the right.",
      navigate: "unassigned",
      ticketSearch: "",
      ticketPriority,
      ticketStatus,
    };
  }

  // "my tickets" / "assigned to me" — tolerate typos (tickes, assigend, asignned)
  const ticketWord = /\b(tickets?|tickes|tix|cases?)\b/.test(lower);
  const mineAssigned =
    /\b(my\s+tickets?|my\s+tickes|my\s+cases?|my\s+assigned)\b/.test(lower) ||
    /\bassign?e?d\s+to\s+me\b/.test(lower) ||
    /\bassigend\s+to\s+me\b/.test(lower) ||
    (/\b(my|mine)\b/.test(lower) && ticketWord) ||
    (/\bassign?e?d\b/.test(lower) && ticketWord && /\b(me|my)\b/.test(lower));
  if (mineAssigned) {
    return {
      reply: ticketPriority
        ? `Intent: show My Tickets filtered to ${ticketPriority} priority; list on the right.`
        : "Intent: show My Tickets; list on the right.",
      navigate: "assigned",
      ticketSearch: "",
      ticketPriority,
      ticketStatus,
    };
  }

  const ticketQuery = extractAfter(
    [
      /(?:find|search|show|look\s*up)\s+(?:ticket|tickets|case|cases)\s+(?:for\s+|about\s+|named\s+)?(.+)/i,
      /(?:ticket|case)\s+(#?\w[\w-]*)/i,
      /(?:about|for)\s+["'](.+?)["']/i,
    ],
    text
  );
  const cleanedTicketQuery =
    ticketQuery && !TICKET_QUERY_STOPWORDS.test(ticketQuery.trim())
      ? ticketQuery
      : undefined;

  if (
    cleanedTicketQuery ||
    ticketPriority ||
    ticketStatus ||
    /\b(tickets?|team queue|all tickets|open tickets)\b/.test(lower)
  ) {
    const bits: string[] = [];
    if (cleanedTicketQuery) bits.push(`matching **${cleanedTicketQuery}**`);
    if (ticketPriority) bits.push(`priority **${ticketPriority}**`);
    if (ticketStatus) bits.push(`status **${ticketStatus}**`);
    return {
      reply: bits.length
        ? `Intent: show tickets ${bits.join(", ")}; list on the right.`
        : "Intent: open team queue; list on the right.",
      navigate: "tickets-list",
      ticketSearch: cleanedTicketQuery || "",
      ticketPriority,
      ticketStatus,
    };
  }

  if (text.length < 3) return null;

  // Never soft-search by dumping the raw utterance into filters.
  // List/search/clear is handled by structured UI actions (LLM tool catalog).
  return null;
}
