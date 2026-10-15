/**
 * Fetch live module rows so chat can report details (not just "I opened X").
 */

export type ChatListDetails = {
  listCount: number;
  listSummary: string;
  listKind: string;
};

const MAX_ROWS = 10;

function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  if (typeof window !== "undefined") return path;
  const base = (process.env.CHAT_API_BASE || "http://127.0.0.1:3001").replace(
    /\/$/,
    ""
  );
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

async function apiGet(path: string, cookie?: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (cookie) headers.Cookie = cookie;
  return fetch(apiUrl(path), { credentials: "include", headers });
}

function linesFrom(rows: string[], total: number, kind: string): ChatListDetails {
  const shown = rows.slice(0, MAX_ROWS);
  const more =
    total > shown.length ? `\n…and ${total - shown.length} more.` : "";
  return {
    listCount: total,
    listKind: kind,
    listSummary:
      total === 0
        ? `No ${kind} found.`
        : `${total} ${kind}:\n${shown.map((r) => `• ${r}`).join("\n")}${more}`,
  };
}

function matchesQuery(hay: string, q: string | undefined): boolean {
  if (!q?.trim()) return true;
  return hay.toLowerCase().includes(q.trim().toLowerCase());
}

export async function fetchChatModuleDetails(opts: {
  navigate?: string;
  resolvedView: string;
  ticketSearch?: string;
  ticketPriority?: string;
  ticketStatus?: string;
  kbSearch?: string;
  customerSearch?: string;
  teamsSearch?: string;
  /** Optional session cookie for Node/scripts (browser uses credentials:include). */
  cookie?: string;
}): Promise<ChatListDetails | null> {
  const view = opts.navigate || opts.resolvedView;
  const get = (path: string) => apiGet(path, opts.cookie);
  try {
    if (
      view === "unassigned" ||
      view === "assigned" ||
      view === "team-inbox" ||
      view === "team-queue" ||
      view === "tickets-list" ||
      view === "search" ||
      view === "work-board"
    ) {
      let scope = "assignee";
      if (view === "unassigned") scope = "unassigned";
      else if (view === "team-inbox") scope = "team";
      else if (view === "team-queue" || view === "tickets-list") scope = "team";
      else if (view === "search") scope = "search";
      else if (view === "work-board") scope = "assignee";
      else if (view === "assigned") scope = "assignee";

      const url =
        view === "team-queue"
          ? "/api/tickets?scope=org"
          : `/api/tickets?scope=${encodeURIComponent(scope)}`;

      let res = await get(url);
      if (!res.ok && view === "team-queue") {
        res = await get("/api/tickets?scope=team");
      }
      if (!res.ok) {
        res = await get("/api/tickets");
      }
      if (!res.ok) return null;
      const rows = (await res.json()) as Array<{
        id?: string;
        subject?: string;
        assignee?: string;
        priority?: string;
        status?: string;
        customerName?: string;
      }>;
      if (!Array.isArray(rows)) return null;

      let filtered = rows;
      // My Tickets: prefer open work (match badge / work-board expectations)
      if (view === "assigned" || view === "work-board") {
        filtered = filtered.filter(
          (t) => String(t.status || "").toLowerCase() !== "resolved"
        );
      }
      if (opts.ticketSearch) {
        filtered = filtered.filter((t) =>
          matchesQuery(
            `${t.id} ${t.subject} ${t.assignee} ${t.customerName} ${t.status}`,
            opts.ticketSearch
          )
        );
      }
      if (opts.ticketPriority) {
        filtered = filtered.filter(
          (t) =>
            String(t.priority || "").toLowerCase() ===
            opts.ticketPriority!.toLowerCase()
        );
      }
      if (opts.ticketStatus) {
        filtered = filtered.filter(
          (t) =>
            String(t.status || "").toLowerCase() ===
            opts.ticketStatus!.toLowerCase()
        );
      }

      const lines = filtered.map(
        (t) =>
          `${t.id || "?"} — ${t.subject || "(no subject)"} · ${t.assignee || "Unassigned"} · ${t.priority || "—"} · ${t.status || "—"}`
      );
      const kind =
        view === "unassigned"
          ? "unassigned tickets"
          : view === "assigned"
            ? "assigned tickets"
            : "tickets";
      return linesFrom(lines, filtered.length, kind);
    }

    if (view === "customers") {
      const res = await get("/api/customers");
      if (!res.ok) return null;
      const rows = (await res.json()) as Array<{
        name?: string;
        email?: string;
        status?: string;
      }>;
      if (!Array.isArray(rows)) return null;
      const filtered = rows.filter((c) =>
        matchesQuery(`${c.name} ${c.email} ${c.status}`, opts.customerSearch)
      );
      const lines = filtered.map(
        (c) => `${c.name || "?"} · ${c.email || "—"} · ${c.status || "—"}`
      );
      return linesFrom(lines, filtered.length, "customers");
    }

    if (view === "kb") {
      const res = await get("/api/kb");
      if (!res.ok) return null;
      const rows = (await res.json()) as Array<{
        title?: string;
        category?: string;
      }>;
      if (!Array.isArray(rows)) return null;
      const filtered = rows.filter((a) =>
        matchesQuery(`${a.title} ${a.category}`, opts.kbSearch)
      );
      const lines = filtered.map(
        (a) => `${a.title || "?"} · ${a.category || "General"}`
      );
      return linesFrom(lines, filtered.length, "KB articles");
    }

    if (view === "agent-queues") {
      const res = await get("/api/queues");
      if (!res.ok) return null;
      const rows = (await res.json()) as Array<{
        queueName?: string;
        name?: string;
        openTickets?: number;
        type?: string;
        members?: string[];
      }>;
      if (!Array.isArray(rows)) return null;
      const filtered = rows.filter((q) =>
        matchesQuery(
          `${q.queueName || q.name} ${q.type} ${(q.members || []).join(" ")}`,
          opts.teamsSearch
        )
      );
      const lines = filtered.map((q) => {
        const name = q.queueName || q.name || "?";
        const open = q.openTickets ?? 0;
        const n = q.members?.length ?? 0;
        return `${name} · ${q.type || "Shared"} · ${open} open · ${n} members`;
      });
      return linesFrom(lines, filtered.length, "teams");
    }

    if (view === "dashboard" || view === "analytics") {
      const res = await get(
        view === "analytics" ? "/api/analytics" : "/api/metrics"
      );
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || typeof data !== "object") return null;
      const bits: string[] = [];
      const m = data as Record<string, unknown>;
      const pick = (keys: string[], label: string) => {
        for (const k of keys) {
          if (typeof m[k] === "number") {
            bits.push(`${label}: ${m[k]}`);
            return;
          }
        }
      };
      pick(["openTickets", "open"], "Open");
      pick(["unassignedTickets", "unassigned"], "Unassigned");
      pick(["resolvedTickets", "resolved"], "Resolved");
      pick(["pendingTickets", "pending"], "Pending");
      pick(["overdueTickets", "overdue"], "Overdue");
      if (typeof m.avgCsat === "number") bits.push(`Avg CSAT: ${m.avgCsat}`);
      if (!bits.length) {
        bits.push(
          ...Object.entries(m)
            .filter(([, v]) => typeof v === "number" || typeof v === "string")
            .slice(0, 8)
            .map(([k, v]) => `${k}: ${v}`)
        );
      }
      return {
        listCount: bits.length,
        listKind: view === "analytics" ? "analytics" : "metrics",
        listSummary: bits.length
          ? `Live ${view === "analytics" ? "analytics" : "metrics"}:\n${bits
              .map((b) => `• ${b}`)
              .join("\n")}`
          : "No metrics available.",
      };
    }

    if (view === "macros") {
      const res = await get("/api/macros");
      if (!res.ok) return null;
      const rows = (await res.json()) as Array<{ title?: string }>;
      if (!Array.isArray(rows)) return null;
      const lines = rows.map((m) => m.title || "?");
      return linesFrom(lines, rows.length, "macros");
    }

    if (view === "audit") {
      const res = await get("/api/audit");
      if (!res.ok) return null;
      const rows = (await res.json()) as Array<{
        action?: string;
        actorName?: string;
        ticketNumber?: string;
        createdAt?: string;
      }>;
      if (!Array.isArray(rows)) return null;
      const lines = rows.slice(0, MAX_ROWS).map(
        (e) =>
          `${e.action || "?"} · ${e.actorName || "—"} · ${e.ticketNumber || "—"} · ${e.createdAt || ""}`
      );
      return linesFrom(lines, rows.length, "audit events");
    }

    if (view === "csat-reports") {
      const res = await get("/api/csat-reports?range=30d");
      if (!res.ok) return null;
      const data = (await res.json()) as Record<string, unknown>;
      const bits: string[] = [];
      for (const [k, v] of Object.entries(data || {})) {
        if (typeof v === "number" || typeof v === "string") {
          bits.push(`${k}: ${v}`);
        }
      }
      return {
        listCount: bits.length,
        listKind: "csat",
        listSummary: bits.length
          ? `CSAT (30d):\n${bits.map((b) => `• ${b}`).join("\n")}`
          : "No CSAT data for this range yet.",
      };
    }

    if (view === "priorities") {
      const res = await get("/api/priorities?all=1");
      if (!res.ok) return null;
      const rows = (await res.json()) as Array<{
        displayName?: string;
        priority?: string;
        resolutionHours?: number;
        active?: boolean;
      }>;
      if (!Array.isArray(rows)) return null;
      const lines = rows.map(
        (p) =>
          `${p.displayName || p.priority || "?"} · ${p.resolutionHours ?? "—"}h · ${
            p.active === false ? "off" : "active"
          }`
      );
      return linesFrom(lines, rows.length, "priorities");
    }

    if (view === "escalation-directory") {
      const res = await get("/api/escalation-directory");
      if (!res.ok) return null;
      const data = await res.json();
      const rows = Array.isArray(data)
        ? data
        : Array.isArray((data as { teams?: unknown[] })?.teams)
          ? (data as { teams: unknown[] }).teams
          : [];
      const lines = rows.slice(0, MAX_ROWS).map((row) => {
        const r = row as Record<string, unknown>;
        const name = String(r.teamName || r.name || r.queueName || "?");
        const skills = Array.isArray(r.skills)
          ? (r.skills as string[]).slice(0, 4).join(", ")
          : String(r.skills || "");
        return skills ? `${name} · ${skills}` : name;
      });
      return linesFrom(lines, rows.length, "escalation teams");
    }

    if (view === "org-preferences") {
      const res = await get("/api/org-preferences");
      if (!res.ok) return null;
      const data = (await res.json()) as Record<string, unknown>;
      const bits: string[] = [];
      for (const key of [
        "portalLabel",
        "ticketPrefix",
        "displayTimezone",
        "timezone",
        "label",
      ]) {
        if (data[key] != null && String(data[key]).trim()) {
          bits.push(`${key}: ${data[key]}`);
        }
      }
      return {
        listCount: bits.length,
        listKind: "org-preferences",
        listSummary: bits.length
          ? `Org preferences:\n${bits.map((b) => `• ${b}`).join("\n")}`
          : "Org preferences loaded (no simple fields to summarize).",
      };
    }
  } catch {
    return null;
  }
  return null;
}
