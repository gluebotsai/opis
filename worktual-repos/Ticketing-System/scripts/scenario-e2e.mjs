#!/usr/bin/env node
/**
 * Expanded scenario E2E — hunts bugs across auth, RBAC, tickets, notes,
 * KB, macros, account, notifications, coworker, uploads, cross-role paths.
 *
 * Requires: Express :3001 + ai-agents :8012
 * Run: node scripts/scenario-e2e.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BASE = process.env.API_BASE || "http://127.0.0.1:3001";
const AGENTS = (process.env.COWORKER_AGENTS_URL || "http://127.0.0.1:8012").replace(
  /\/$/,
  ""
);
const PASSWORD = process.env.SMOKE_PASSWORD || "Worktual@123";
const TASKS_KEY =
  process.env.COWORKER_TASKS_SECRET || "worktual-tasks-dev-secret";

const USERS = {
  admin: { email: process.env.SMOKE_ADMIN_EMAIL || "jane.smith@worktual.com", role: "admin" },
  agent: { email: process.env.SMOKE_AGENT_EMAIL || "smohamedfazil16@gmail.com", role: "agent" },
  resolver: { email: process.env.SMOKE_RESOLVER_EMAIL || "yaswanthmg1@gmail.com", role: "resolver" },
};

let cookie = "";
let passed = 0;
let failed = 0;
const findings = [];

function pass(name, detail = "") {
  passed++;
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(name, err) {
  failed++;
  const detail = err instanceof Error ? err.message : String(err);
  findings.push({ name, detail });
  console.error(`  ✗ ${name} — ${detail.slice(0, 280)}`);
}
function section(title) {
  console.log(`\n=== ${title} ===\n`);
}
function ticketPath(id, suffix = "") {
  // DB stores ticket_number like "#12724" — '#' must be encoded or it becomes a URL fragment.
  const raw = String(id).startsWith("#") ? String(id) : `#${id}`;
  return `/api/tickets/${encodeURIComponent(raw)}${suffix}`;
}

async function api(pathName, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (cookie && !options.skipCookie) headers.Cookie = cookie;
  const res = await fetch(`${BASE}${pathName}`, { ...options, headers });
  const setCookie = res.headers.getSetCookie?.() || [];
  for (const c of setCookie) {
    const part = c.split(";")[0];
    if (part.startsWith("worktual_token=")) cookie = part;
  }
  const raw = res.headers.get("set-cookie");
  if (raw?.includes("worktual_token=")) cookie = raw.split(";")[0];
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body, text, headers: res.headers };
}

async function ensureDirectoryCustomer() {
  const listed = await api("/api/customers");
  const rows = Array.isArray(listed.body) ? listed.body : [];
  const hit = rows.find((c) => (c?.email || c?.phone) && (c?.id || c?.customerId));
  if (hit) {
    return {
      id: String(hit.id || hit.customerId || ""),
      name: String(hit.name || "Directory Customer"),
      email: String(hit.email || ""),
      phone: String(hit.phone || ""),
    };
  }
  const email = `dir.${Date.now()}@test.local`;
  const created = await api("/api/customers", {
    method: "POST",
    body: JSON.stringify({
      name: "Directory Customer",
      email,
      phone: "5550100123",
    }),
  });
  if (created.status !== 201 && created.status !== 200) {
    throw new Error(
      `directory customer missing (list ${listed.status}, create ${created.status})`
    );
  }
  const c = created.body || {};
  return {
    id: String(c.id || c.customerId || ""),
    name: String(c.name || "Directory Customer"),
    email: String(c.email || email),
    phone: String(c.phone || "5550100123"),
  };
}

async function login(email) {
  cookie = "";
  const r = await api("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (r.status !== 200) throw new Error(`login ${email} → ${r.status}`);
  return r.body.user;
}

function expectStatus(r, codes, label) {
  const ok = Array.isArray(codes) ? codes.includes(r.status) : r.status === codes;
  if (!ok) throw new Error(`${label}: HTTP ${r.status} (want ${codes}) ${JSON.stringify(r.body)?.slice(0, 120)}`);
}

async function main() {
  console.log("Scenario E2E bug hunt");
  console.log(`API ${BASE} · Agents ${AGENTS}\n`);

  // ---------- 0. Health / SPA ----------
  section("0. Health & SPA shell");
  try {
    const h = await api("/api/health", { skipCookie: true });
    expectStatus(h, 200, "health");
    if (!h.body?.db) throw new Error("db not true");
    pass("health", `db=${h.body.db}`);
  } catch (e) {
    fail("health", e);
  }
  try {
    const ah = await fetch(`${AGENTS}/health`);
    const ab = await ah.json();
    if (!ah.ok) throw new Error(JSON.stringify(ab));
    pass("agents health", ab.model || "ok");
  } catch (e) {
    fail("agents health", e);
  }
  try {
    const spa = await fetch(BASE + "/");
    const html = await spa.text();
    if (!spa.ok || !html.includes("root")) throw new Error("SPA missing");
    pass("SPA shell");
  } catch (e) {
    fail("SPA shell", e);
  }
  try {
    const unauth = await api("/api/tickets", { skipCookie: true });
    expectStatus(unauth, 401, "unauth tickets");
    pass("unauth tickets blocked");
  } catch (e) {
    fail("unauth tickets", e);
  }
  try {
    const bad = await api("/api/auth/login", {
      method: "POST",
      skipCookie: true,
      body: JSON.stringify({ email: USERS.admin.email, password: "wrong-password" }),
    });
    expectStatus(bad, 401, "bad password");
    pass("bad password rejected");
  } catch (e) {
    fail("bad password", e);
  }

  // ---------- 1. Auth matrix ----------
  section("1. Auth matrix (admin / agent / resolver)");
  const sessions = {};
  for (const [key, u] of Object.entries(USERS)) {
    try {
      const user = await login(u.email);
      if (user.role !== u.role) throw new Error(`role ${user.role} ≠ ${u.role}`);
      sessions[key] = { user, cookie };
      const me = await api("/api/auth/me");
      expectStatus(me, 200, "me");
      const meEmail = me.body?.user?.email || me.body?.email;
      if (String(meEmail || "").toLowerCase() !== u.email.toLowerCase()) {
        throw new Error(`me email mismatch got=${meEmail}`);
      }
      pass(`${key} login+me`, user.name);
    } catch (e) {
      fail(`${key} login`, e);
    }
  }

  // ---------- 2. Role scope matrix ----------
  section("2. Ticket scope RBAC matrix");
  const scopeCases = [
    ["admin", "org", 200],
    ["admin", "unassigned", 200],
    ["admin", "assignee", 200],
    ["admin", "team", 200],
    ["admin", "search", 200],
    ["agent", "org", 403],
    ["agent", "assignee", 200],
    ["agent", "team", 200],
    ["agent", "unassigned", 200],
    ["agent", "search", 200],
    ["resolver", "org", 403],
    ["resolver", "team", 403],
    ["resolver", "unassigned", 403],
    ["resolver", "assignee", 200],
    ["resolver", "search", 200],
  ];
  for (const [role, scope, want] of scopeCases) {
    try {
      cookie = sessions[role].cookie;
      const r = await api(`/api/tickets?scope=${scope}`);
      expectStatus(r, want, `${role} scope=${scope}`);
      if (want === 200 && !Array.isArray(r.body)) throw new Error("not array");
      pass(`${role} scope=${scope} → ${want}`, want === 200 ? `${r.body.length} rows` : "");
    } catch (e) {
      fail(`${role} scope=${scope}`, e);
    }
  }

  // Integrity: agent unassigned must have no assignee
  try {
    cookie = sessions.agent.cookie;
    const r = await api("/api/tickets?scope=unassigned");
    expectStatus(r, 200, "agent unassigned");
    const dirty = (r.body || []).filter(
      (t) => t.assignee && t.assignee !== "Unassigned"
    );
    if (dirty.length) throw new Error(`${dirty.length} assigned rows in unassigned`);
    pass("agent unassigned integrity", `${r.body.length} rows`);
  } catch (e) {
    fail("agent unassigned integrity", e);
  }

  // ---------- 3. Module gates ----------
  section("3. Module / API gates by role");
  const gates = [
    ["admin", "/api/analytics", 200],
    ["admin", "/api/audit", 200],
    ["admin", "/api/csat-reports", 200],
    ["admin", "/api/org-preferences", 200],
    ["admin", "/api/macros", 200],
    ["admin", "/api/customers", 200],
    ["agent", "/api/analytics", 403],
    ["agent", "/api/audit", 403],
    ["agent", "/api/csat-reports", 403],
    ["agent", "/api/org-preferences", 403],
    ["agent", "/api/macros", 200],
    ["agent", "/api/customers", 200],
    ["agent", "/api/kb", 200],
    ["agent", "/api/agent/triage-stats", 200],
    ["resolver", "/api/analytics", 403],
    ["resolver", "/api/customers", 403],
    ["resolver", "/api/macros", 403],
    ["resolver", "/api/kb", 200],
    ["resolver", "/api/agent/triage-stats", 403],
    ["resolver", "/api/queues", 200],
  ];
  for (const [role, pathName, want] of gates) {
    try {
      cookie = sessions[role].cookie;
      const r = await api(pathName);
      expectStatus(r, want, `${role} ${pathName}`);
      pass(`${role} ${pathName} → ${want}`);
    } catch (e) {
      fail(`${role} ${pathName}`, e);
    }
  }

  // ---------- 4. Create / enrich / notes lifecycle ----------
  section("4. Create → enrich → notes → update → progress");
  let createdId = null;
  try {
    cookie = sessions.agent.cookie;
    const stamp = Date.now();
    const cust = await ensureDirectoryCustomer();
    const created = await api("/api/tickets", {
      method: "POST",
      body: JSON.stringify({
        customerId: cust.id || undefined,
        customerName: cust.name,
        customerEmail: cust.email || undefined,
        customerPhone: cust.phone || undefined,
        description: `VPN cannot connect since morning urgent outage ${stamp}`,
        channel: "Web",
      }),
    });
    expectStatus(created, 201, "create");
    createdId = created.body?.id;
    if (!createdId) throw new Error("no ticket id");
    if (!created.body.subject) throw new Error("subject not enriched");
    if (!created.body.dueAt) throw new Error("missing dueAt/SLA");
    pass("create+triage", `#${createdId} subject=${created.body.subject.slice(0, 40)} assignee=${created.body.assignee}`);
  } catch (e) {
    fail("create+triage", e);
  }

  try {
    cookie = sessions.agent.cookie;
    const en = await api("/api/tickets/enrich", {
      method: "POST",
      body: JSON.stringify({
        customerName: "Scenario Tester",
        customerEmail: "scenario@example.com",
        issue: "Email server down critical outage for all users",
      }),
    });
    expectStatus(en, 200, "enrich");
    if (!en.body?.subject) throw new Error("no subject");
    if (!en.body?.priority) throw new Error("no priority");
    pass("enrich API", `${en.body.subject.slice(0, 50)} · ${en.body.priority} · ${en.body.assignee}`);
  } catch (e) {
    fail("enrich API", e);
  }

  if (createdId) {
    try {
      cookie = sessions.agent.cookie;
      const n1 = await api(ticketPath(createdId, "/notes"), {
        method: "POST",
        body: JSON.stringify({ text: "Internal note from scenario", visibility: "internal" }),
      });
      expectStatus(n1, [200, 201], "internal note");
      const n2 = await api(ticketPath(createdId, "/notes"), {
        method: "POST",
        body: JSON.stringify({ text: "Public note from scenario", visibility: "public" }),
      });
      expectStatus(n2, [200, 201], "public note");
      const list = await api(ticketPath(createdId, "/notes"));
      expectStatus(list, 200, "list notes");
      const bodies = (list.body || []).map((n) => n.body || n.text || "");
      if (!bodies.some((b) => /Internal note/.test(b))) throw new Error("internal missing");
      if (!bodies.some((b) => /Public note/.test(b))) throw new Error("public missing");
      pass("notes both visibilities", `${list.body.length} notes`);
    } catch (e) {
      fail("notes", e);
    }

    try {
      cookie = sessions.agent.cookie;
      const up = await api(ticketPath(createdId), {
        method: "PUT",
        body: JSON.stringify({ status: "Pending" }),
      });
      expectStatus(up, 200, "update status");
      if (up.body?.status !== "Pending") throw new Error(`status=${up.body?.status}`);
      pass("update own ticket status");
    } catch (e) {
      fail("update status", e);
    }

    try {
      cookie = sessions.agent.cookie;
      const prog = await api(ticketPath(createdId, "/progress"));
      expectStatus(prog, 200, "progress");
      pass("ticket progress");
    } catch (e) {
      fail("progress", e);
    }
  }

  // ---------- 5. Resolver boundaries ----------
  section("5. Resolver create / mutate boundaries");
  try {
    cookie = sessions.resolver.cookie;
    const denied = await api("/api/tickets", {
      method: "POST",
      body: JSON.stringify({
        customerName: "Should Fail",
        customerEmail: "fail@example.com",
        subject: "Resolver should not create",
        description: "x",
      }),
    });
    expectStatus(denied, 403, "resolver create");
    pass("resolver POST ticket denied");
  } catch (e) {
    fail("resolver create deny", e);
  }
  try {
    cookie = sessions.resolver.cookie;
    const kb = await api("/api/kb", {
      method: "POST",
      body: JSON.stringify({
        title: "Too short",
        content: "short",
        category: "General",
      }),
    });
    expectStatus(kb, [400, 403], "resolver kb");
    pass("resolver KB mutate blocked", `HTTP ${kb.status}`);
  } catch (e) {
    fail("resolver KB", e);
  }
  try {
    cookie = sessions.resolver.cookie;
    const chat = await api("/api/coworker/chat", {
      method: "POST",
      body: JSON.stringify({
        message: "create a new ticket please",
        page: "Home",
        session_id: `scenario-res-${Date.now()}`,
      }),
    });
    expectStatus(chat, 200, "resolver chat");
    const reply = String(chat.body?.reply || "");
    if (
      !/can.?t create|cannot create|can’t create|don'?t allow|not allow|permissions?|role/i.test(
        reply
      )
    ) {
      throw new Error(`expected deny reply, got: ${reply.slice(0, 120)}`);
    }
    pass("resolver chat create denied");
  } catch (e) {
    fail("resolver chat create", e);
  }

  // ---------- 6. Escalate ----------
  section("6. Escalate flow");
  try {
    cookie = sessions.agent.cookie;
    const cust = await ensureDirectoryCustomer();
    const t = await api("/api/tickets", {
      method: "POST",
      body: JSON.stringify({
        customerId: cust.id || undefined,
        customerName: cust.name,
        customerEmail: cust.email || undefined,
        customerPhone: cust.phone || undefined,
        subject: "Needs escalation scenario",
        description: "complex network routing failure",
        assignee: sessions.agent.user.name,
      }),
    });
    expectStatus(t, 201, "ticket for escalate");
    const esc = await api(ticketPath(t.body.id, "/escalate"), { method: "POST", body: "{}" });
    expectStatus(esc, 200, "escalate");
    const resolver = esc.body?.resolver || esc.body?.ticket?.resolver;
    if (!resolver || resolver === "Unassigned") {
      throw new Error("no resolver after escalate");
    }
    const agentKept = esc.body?.assignee || esc.body?.ticket?.assignee;
    if (
      agentKept &&
      String(agentKept) !== String(sessions.agent.user.name)
    ) {
      throw new Error(
        `escalate cleared L1: expected ${sessions.agent.user.name}, got ${agentKept}`
      );
    }
    pass(
      "escalate",
      `agent ${agentKept || sessions.agent.user.name} kept → resolver ${resolver}`
    );
  } catch (e) {
    fail("escalate", e);
  }

  // ---------- 7. KB validation ----------
  section("7. KB create validation");
  try {
    cookie = sessions.agent.cookie;
    const short = await api("/api/kb", {
      method: "POST",
      body: JSON.stringify({ title: "Hi", content: "Bye", category: "General" }),
    });
    if (short.status === 201) throw new Error("short KB should be rejected");
    expectStatus(short, [400, 422], "short kb");
    pass("KB rejects short title/content", `HTTP ${short.status}`);
  } catch (e) {
    fail("KB short reject", e);
  }
  try {
    cookie = sessions.agent.cookie;
    const okKb = await api("/api/kb", {
      method: "POST",
      body: JSON.stringify({
        title: "Scenario KB article password reset steps",
        content:
          "Step 1: open settings. Step 2: choose reset password. Step 3: confirm email. Step 4: set a new password. Step 5: sign in again.",
        category: "How-to",
        attachments: ["https://evil.example/../../../etc/passwd", "/uploads/ok.txt"],
      }),
    });
    expectStatus(okKb, 201, "kb create");
    const atts = okKb.body?.attachments || [];
    if (atts.some((a) => String(a).includes(".."))) {
      throw new Error(`traversal attachment leaked: ${JSON.stringify(atts)}`);
    }
    pass("KB create strips bad attachments", JSON.stringify(atts).slice(0, 80));
  } catch (e) {
    fail("KB create", e);
  }

  // ---------- 8. Customers read-only ----------
  section("8. Customers directory");
  try {
    cookie = sessions.agent.cookie;
    const list = await api("/api/customers");
    expectStatus(list, 200, "customers list");
    pass("customers list", `${list.body?.length ?? 0} rows`);
    const post = await api("/api/customers", {
      method: "POST",
      body: JSON.stringify({ name: "X", email: "x@y.com" }),
    });
    expectStatus(post, 403, "customers post");
    pass("customers POST blocked");
  } catch (e) {
    fail("customers", e);
  }
  try {
    cookie = sessions.agent.cookie;
    const c360 = await api("/api/customers/360?email=scenario@example.com");
    expectStatus(c360, [200, 404], "360");
    pass("customers/360", `HTTP ${c360.status}`);
  } catch (e) {
    fail("customers/360", e);
  }

  // ---------- 9. Macros ----------
  section("9. Macros RBAC");
  try {
    cookie = sessions.agent.cookie;
    const list = await api("/api/macros");
    expectStatus(list, 200, "agent macros");
    const created = await api("/api/macros", {
      method: "POST",
      body: JSON.stringify({
        title: `Scenario macro ${Date.now()}`,
        body: "Thanks for contacting support. We are looking into this.",
      }),
    });
    expectStatus(created, [200, 201], "macro create");
    pass("agent macro create", created.body?.id || created.body?.title || "ok");
  } catch (e) {
    fail("agent macros", e);
  }
  try {
    cookie = sessions.resolver.cookie;
    const list = await api("/api/macros");
    expectStatus(list, 403, "resolver macros get");
    pass("resolver macros GET denied");
  } catch (e) {
    fail("resolver macros", e);
  }

  // ---------- 10. Account / notifications ----------
  section("10. Account & notifications");
  try {
    cookie = sessions.agent.cookie;
    const acc = await api("/api/account");
    expectStatus(acc, 200, "account");
    pass("account profile");
    const prefs = await api("/api/account/preferences", {
      method: "PATCH",
      body: JSON.stringify({ timezone: "Asia/Kolkata" }),
    });
    expectStatus(prefs, [200, 204], "prefs");
    pass("account preferences patch", `HTTP ${prefs.status}`);
  } catch (e) {
    fail("account", e);
  }
  try {
    cookie = sessions.agent.cookie;
    const notes = await api("/api/notifications");
    expectStatus(notes, 200, "notifications");
    const readAll = await api("/api/notifications/read-all", { method: "POST", body: "{}" });
    expectStatus(readAll, [200, 204], "read-all");
    pass("notifications list+read-all", `${notes.body?.length ?? 0} items`);
  } catch (e) {
    fail("notifications", e);
  }
  try {
    cookie = sessions.agent.cookie;
    const brand = await api("/api/org-branding");
    expectStatus(brand, 200, "branding");
    pass("org-branding");
  } catch (e) {
    fail("org-branding", e);
  }

  // ---------- 11. Admin org preferences ----------
  section("11. Admin org preferences");
  try {
    cookie = sessions.admin.cookie;
    const get = await api("/api/org-preferences");
    expectStatus(get, 200, "get prefs");
    const put = await api("/api/org-preferences", {
      method: "PUT",
      body: JSON.stringify({
        ...(typeof get.body === "object" ? get.body : {}),
        ticketPrefix: get.body?.ticketPrefix || "",
      }),
    });
    expectStatus(put, 200, "put prefs");
    pass("admin org-preferences get+put");
  } catch (e) {
    fail("org-preferences", e);
  }
  try {
    cookie = sessions.agent.cookie;
    const put = await api("/api/org-preferences", {
      method: "PUT",
      body: JSON.stringify({ ticketPrefix: "HACK" }),
    });
    expectStatus(put, 403, "agent put prefs");
    pass("agent org-preferences PUT denied");
  } catch (e) {
    fail("agent org-preferences", e);
  }

  // ---------- 12. Cross-org isolation ----------
  section("12. Cross-org isolation");
  try {
    cookie = sessions.admin.cookie;
    const janeTickets = await api("/api/tickets?scope=org");
    expectStatus(janeTickets, 200, "admin tickets");
    const sample = (janeTickets.body || [])[0];
    if (!sample?.id) throw new Error("no admin ticket to probe");
    cookie = sessions.agent.cookie;
    // Global ticket numbers + org-scoped GET: other-org ticket must 404/403.
    // Never put '#' unencoded in the path (becomes URL fragment).
    const cross = await api(ticketPath(sample.id));
    if (Array.isArray(cross.body)) {
      throw new Error("got ticket list instead of single ticket (bad # encoding)");
    }
    if (cross.status === 200 && String(cross.body?.id).replace(/^#/, "") === String(sample.id).replace(/^#/, "")) {
      // Same org would legitimately see it — verify org isolation via creator org mismatch
      const agentOrg = sessions.agent.user.organizationId;
      const adminOrg = sessions.admin.user.organizationId;
      if (agentOrg !== adminOrg) {
        throw new Error(`cross-org read allowed for #${sample.id}`);
      }
      pass("cross-org skipped (same org users in this env)");
    } else {
      expectStatus(cross, [403, 404], "cross read");
      pass("cross-org ticket read blocked", `HTTP ${cross.status} for ${sample.id}`);
    }
  } catch (e) {
    fail("cross-org", e);
  }

  // ---------- 13. Parallel create uniqueness ----------
  section("13. Parallel ticket number uniqueness");
  try {
    cookie = sessions.agent.cookie;
    const stamp = Date.now();
    const cust = await ensureDirectoryCustomer();
    const jobs = Array.from({ length: 6 }, (_, i) =>
      api("/api/tickets", {
        method: "POST",
        body: JSON.stringify({
          customerId: cust.id || undefined,
          customerName: cust.name,
          customerEmail: cust.email || undefined,
          customerPhone: cust.phone || undefined,
          subject: `Race ticket ${stamp}-${i}`,
          description: "parallel create uniqueness check",
        }),
      })
    );
    const results = await Promise.all(jobs);
    const ok = results.filter((r) => r.status === 201);
    if (ok.length < 6) throw new Error(`only ${ok.length}/6 created`);
    const ids = ok.map((r) => r.body.id);
    if (new Set(ids).size !== ids.length) throw new Error(`duplicate ids ${ids}`);
    pass("parallel creates unique", ids.join(","));
  } catch (e) {
    fail("parallel creates", e);
  }

  // ---------- 14. Uploads path traversal ----------
  section("14. Uploads / path abuse");
  try {
    const trav = await fetch(`${BASE}/uploads/../package.json`, {
      headers: cookie ? { Cookie: cookie } : {},
    });
    if (trav.status === 200) {
      const text = await trav.text();
      if (text.includes('"name"') && text.includes("worktual")) {
        throw new Error("path traversal served package.json");
      }
    }
    pass("uploads traversal blocked/safe", `HTTP ${trav.status}`);
  } catch (e) {
    fail("uploads traversal", e);
  }

  // ---------- 15. Coworker chat scenarios ----------
  section("15. Coworker chat scenarios");
  const chatCases = [
    ["agent", "how many tickets are assigned to me?", /\d+/],
    ["agent", "show my tickets", /ticket|#\d+/i],
    ["admin", "how many open tickets are there?", /\d+/],
    ["resolver", "what can I do on this page?", /ticket|search|knowledge|work|home|dashboard|overview/i],
  ];
  for (const [role, msg, re] of chatCases) {
    try {
      cookie = sessions[role].cookie;
      const r = await api("/api/coworker/chat", {
        method: "POST",
        body: JSON.stringify({
          message: msg,
          page: "Home",
          session_id: `scenario-chat-${role}-${Date.now()}`,
        }),
      });
      expectStatus(r, 200, "chat");
      const reply = String(r.body?.reply || "");
      if (!re.test(reply)) throw new Error(`reply mismatch: ${reply.slice(0, 140)}`);
      pass(`${role} chat: ${msg.slice(0, 40)}`, reply.slice(0, 70));
    } catch (e) {
      fail(`${role} chat: ${msg}`, e);
    }
  }

  // Memory: name recall
  try {
    cookie = sessions.agent.cookie;
    const sid = `scenario-mem-${Date.now()}`;
    await api("/api/coworker/chat", {
      method: "POST",
      body: JSON.stringify({
        message: "My name is ScenarioBot for this test.",
        page: "Home",
        session_id: sid,
        history: [{ role: "user", text: "My name is ScenarioBot for this test." }],
      }),
    });
    const r2 = await api("/api/coworker/chat", {
      method: "POST",
      body: JSON.stringify({
        message: "What is my name?",
        page: "Home",
        session_id: sid,
        history: [
          { role: "user", text: "My name is ScenarioBot for this test." },
          { role: "assistant", text: "Noted." },
          { role: "user", text: "What is my name?" },
        ],
      }),
    });
    expectStatus(r2, 200, "memory");
    pass("chat memory turn", String(r2.body?.reply || "").slice(0, 80));
  } catch (e) {
    fail("chat memory", e);
  }

  // UI actions
  try {
    cookie = sessions.agent.cookie;
    const ua = await api("/api/coworker/ui-actions", {
      method: "POST",
      body: JSON.stringify({ message: "list all", page: "Customers" }),
    });
    expectStatus(ua, 200, "ui-actions");
    const actions = ua.body?.actions || [];
    if (!actions.length) throw new Error("no actions");
    pass("ui-actions list all", JSON.stringify(actions[0]));
  } catch (e) {
    fail("ui-actions", e);
  }

  // ---------- 15b. LangGraph chat command actions (filter / create / escalate) ----------
  section("15b. LangGraph chat command actions");

  function actionTypes(body) {
    return (Array.isArray(body?.ui_actions) ? body.ui_actions : []).map((a) =>
      String(a?.type || "").toLowerCase()
    );
  }
  function findAction(body, type, pred = () => true) {
    return (Array.isArray(body?.ui_actions) ? body.ui_actions : []).find(
      (a) => String(a?.type || "").toLowerCase() === type && pred(a)
    );
  }

  const chatCmdCases = [
    {
      name: "chat filter: show all customers",
      role: "agent",
      message: "show all customers",
      page: "Customers",
      check(body) {
        const hit = findAction(
          body,
          "set_filter",
          (a) => a.module === "customers" && String(a.query ?? "") === ""
        );
        if (!hit) throw new Error(`no clear-customers filter: ${JSON.stringify(body.actions)}`);
      },
    },
    {
      name: "chat filter: open urgent tickets",
      role: "agent",
      message: "open urgent tickets",
      page: "Tickets",
      check(body) {
        const hit = findAction(
          body,
          "set_filter",
          (a) =>
            a.module === "tickets" &&
            a.status === "Open" &&
            a.priority === "urgent"
        );
        if (!hit) throw new Error(JSON.stringify(body.actions));
      },
    },
    {
      name: "chat filter: high priority (resolver)",
      role: "resolver",
      message: "show high priority tickets",
      page: "My Tickets",
      check(body) {
        const hit = findAction(
          body,
          "set_filter",
          (a) => a.module === "tickets" && a.priority === "high"
        );
        if (!hit) throw new Error(JSON.stringify(body.actions));
        if (/could not find resolver/i.test(String(body.reply || ""))) {
          throw new Error(`filter treated as assignee: ${String(body.reply).slice(0, 120)}`);
        }
      },
    },
    {
      name: "chat filter: high priorty typo (admin)",
      role: "admin",
      message: "show high priorty tickets",
      page: "Tickets",
      check(body) {
        const hit = findAction(
          body,
          "set_filter",
          (a) => a.module === "tickets" && a.priority === "high"
        );
        if (!hit) throw new Error(JSON.stringify(body.actions));
      },
    },
    {
      name: "chat filter: medium priority",
      role: "agent",
      message: "medium priority tickets",
      page: "Tickets",
      check(body) {
        const hit = findAction(
          body,
          "set_filter",
          (a) => a.module === "tickets" && a.priority === "medium"
        );
        if (!hit) throw new Error(JSON.stringify(body.actions));
      },
    },
    {
      name: "chat filter: low priority",
      role: "agent",
      message: "low priority tickets",
      page: "Tickets",
      check(body) {
        const hit = findAction(
          body,
          "set_filter",
          (a) => a.module === "tickets" && a.priority === "low"
        );
        if (!hit) throw new Error(JSON.stringify(body.actions));
      },
    },
    {
      name: "chat filter: pending tickets",
      role: "resolver",
      message: "pending tickets",
      page: "Team inbox",
      check(body) {
        const hit = findAction(
          body,
          "set_filter",
          (a) => a.module === "tickets" && a.status === "Pending"
        );
        if (!hit) throw new Error(JSON.stringify(body.actions));
      },
    },
    {
      name: "chat filter: resolved tickets",
      role: "admin",
      message: "resolved tickets",
      page: "Tickets",
      check(body) {
        const hit = findAction(
          body,
          "set_filter",
          (a) => a.module === "tickets" && a.status === "Resolved"
        );
        if (!hit) throw new Error(JSON.stringify(body.actions));
      },
    },
    {
      name: "chat filter: on hold tickets",
      role: "agent",
      message: "on hold tickets",
      page: "Tickets",
      check(body) {
        const hit = findAction(
          body,
          "set_filter",
          (a) => a.module === "tickets" && a.status === "Pending"
        );
        if (!hit) throw new Error(JSON.stringify(body.actions));
      },
    },
    {
      name: "chat filter: overdue tickets",
      role: "agent",
      message: "overdue tickets",
      page: "Tickets",
      check(body) {
        const hit = findAction(
          body,
          "set_filter",
          (a) => a.module === "tickets" && a.status === "Overdue"
        );
        if (!hit) throw new Error(JSON.stringify(body.actions));
      },
    },
    {
      name: "chat filter: email channel",
      role: "admin",
      message: "email channel tickets",
      page: "Tickets",
      check(body) {
        const hit = findAction(
          body,
          "set_filter",
          (a) => a.module === "tickets" && a.channel === "Email"
        );
        if (!hit) throw new Error(JSON.stringify(body.actions));
      },
    },
    {
      name: "chat filter: active customers",
      role: "admin",
      message: "show active customers",
      page: "Customers",
      check(body) {
        const hit = findAction(
          body,
          "set_filter",
          (a) => a.module === "customers" && a.status === "Active"
        );
        if (!hit) throw new Error(JSON.stringify(body.actions));
      },
    },
    {
      name: "chat filter: inactive customers",
      role: "agent",
      message: "show inactive customers",
      page: "Customers",
      check(body) {
        const hit = findAction(
          body,
          "set_filter",
          (a) => a.module === "customers" && a.status === "Inactive"
        );
        if (!hit) throw new Error(JSON.stringify(body.actions));
      },
    },
    {
      name: "chat filter: list all tickets (resolver)",
      role: "resolver",
      message: "list all",
      page: "My Tickets",
      check(body) {
        const hit = findAction(
          body,
          "set_filter",
          (a) => a.module === "tickets" && String(a.query ?? "") === ""
        );
        if (!hit) throw new Error(JSON.stringify(body.actions));
      },
    },
    {
      name: "chat Q&A: no filter actions",
      role: "admin",
      message: "how many open tickets are there?",
      page: "Tickets",
      check(body) {
        if (!/\d+/.test(String(body.reply || ""))) {
          throw new Error(`no count: ${String(body.reply).slice(0, 120)}`);
        }
      },
    },
    {
      name: "chat create_ticket action (admin)",
      role: "admin",
      message: "create a ticket",
      page: "Home",
      check(body) {
        if (!actionTypes(body).includes("create_ticket")) {
          throw new Error(`missing create_ticket: ${JSON.stringify(body.actions)}`);
        }
        const nav = findAction(body, "navigate", (a) => a.view === "create-ticket");
        if (!nav) throw new Error(`missing navigate create-ticket: ${JSON.stringify(body.actions)}`);
        if (!/customer|name|file/i.test(String(body.reply || ""))) {
          throw new Error(`unexpected create reply: ${String(body.reply).slice(0, 120)}`);
        }
      },
    },
    {
      name: "chat create_team action (admin)",
      role: "admin",
      message: "create a new team",
      page: "Home",
      check(body) {
        if (!actionTypes(body).includes("create_team")) {
          throw new Error(`missing create_team: ${JSON.stringify(body.actions)}`);
        }
      },
    },
    {
      name: "chat create denied (resolver) has no create action",
      role: "resolver",
      message: "create a ticket",
      page: "Home",
      check(body) {
        if (actionTypes(body).includes("create_ticket")) {
          throw new Error("resolver got create_ticket action");
        }
        if (
          !/can.?t create|cannot create|can’t create|don'?t allow|not allow|permissions?|role/i.test(
            String(body.reply || "")
          )
        ) {
          throw new Error(`expected deny: ${String(body.reply).slice(0, 120)}`);
        }
      },
    },
  ];

  for (const tc of chatCmdCases) {
    try {
      cookie = sessions[tc.role].cookie;
      const r = await api("/api/coworker/chat", {
        method: "POST",
        body: JSON.stringify({
          message: tc.message,
          page: tc.page,
          session_id: `scenario-cmd-${tc.name.replace(/\W+/g, "-")}-${Date.now()}`,
        }),
      });
      expectStatus(r, 200, tc.name);
      tc.check(r.body || {});
      pass(tc.name, String(r.body?.reply || "").slice(0, 60));
    } catch (e) {
      fail(tc.name, e);
    }
  }

  // Escalate via LangGraph chat (Python pick + Express write)
  try {
    cookie = sessions.agent.cookie;
    const stamp = Date.now();
    const cust = await ensureDirectoryCustomer();
    const created = await api("/api/tickets", {
      method: "POST",
      body: JSON.stringify({
        customerId: cust.id || undefined,
        customerName: cust.name,
        customerEmail: cust.email || undefined,
        customerPhone: cust.phone || undefined,
        subject: `Chat escalate scenario ${stamp}`,
        description: "vpn authentication failures needing L2",
        assignee: sessions.agent.user.name,
      }),
    });
    expectStatus(created, 201, "ticket for chat escalate");
    const ticketId = String(created.body?.id || "");
    if (!ticketId) throw new Error("no ticket id");

    const sessionId = `scenario-chat-esc-${stamp}`;
    const askChat = await api("/api/coworker/chat", {
      method: "POST",
      body: JSON.stringify({
        message: `escalate ticket ${ticketId}`,
        page: "Tickets",
        session_id: sessionId,
      }),
    });
    expectStatus(askChat, 200, "chat escalate ask");
    const askReply = String(askChat.body?.reply || "");
    if (
      !/who should I escalate|available resolver|who (you would like|I should) assign|from the (team|list)/i.test(
        askReply
      )
    ) {
      throw new Error(`expected resolver picker reply: ${askReply.slice(0, 200)}`);
    }
    // Must not apply escalate on the ask turn
    if (actionTypes(askChat.body).includes("escalate")) {
      throw new Error("escalate applied before assignee chosen");
    }

    const escChat = await api("/api/coworker/chat", {
      method: "POST",
      body: JSON.stringify({
        message: "best resolver",
        page: "Tickets",
        session_id: sessionId,
        history: [
          { role: "user", text: `escalate ticket ${ticketId}` },
          { role: "assistant", text: askReply },
        ],
      }),
    });
    expectStatus(escChat, 200, "chat escalate apply");
    const reply = String(escChat.body?.reply || "");
    if (!/escalat|already with|assign/i.test(reply)) {
      throw new Error(`unexpected escalate reply: ${reply.slice(0, 160)}`);
    }
    const types = actionTypes(escChat.body);
    if (!types.includes("refresh_tickets") && !types.includes("set_filter")) {
      throw new Error(`missing post-escalate UI actions: ${JSON.stringify(escChat.body?.actions)}`);
    }
    // escalate mutate action must not leak to client (already applied server-side)
    if (types.includes("escalate")) {
      throw new Error("raw escalate action leaked to client");
    }

    const after = await api(ticketPath(ticketId));
    expectStatus(after, 200, "ticket after chat escalate");
    const assignee = String(after.body?.assignee || after.body?.assigneeName || "");
    const resolver = String(after.body?.resolver || after.body?.resolverName || "");
    if (!assignee || /^unassigned$/i.test(assignee)) {
      throw new Error(`L1 agent cleared after chat escalate (reply=${reply.slice(0, 80)})`);
    }
    if (!resolver || /^unassigned$/i.test(resolver)) {
      throw new Error(`no resolver after chat escalate (reply=${reply.slice(0, 80)})`);
    }
    pass(
      "chat escalate applied",
      `${ticketId} agent=${assignee} resolver=${resolver} · ${reply.slice(0, 50)}`
    );
  } catch (e) {
    fail("chat escalate", e);
  }

  // High-priority facet via chat (not only /ui-actions)
  try {
    cookie = sessions.agent.cookie;
    const r = await api("/api/coworker/chat", {
      method: "POST",
      body: JSON.stringify({
        message: "high priority tickets",
        page: "My Tickets",
        session_id: `scenario-high-${Date.now()}`,
      }),
    });
    expectStatus(r, 200, "high priority chat");
    const hit = findAction(
      r.body,
      "set_filter",
      (a) => a.module === "tickets" && a.priority === "high"
    );
    if (!hit) throw new Error(JSON.stringify(r.body?.actions));
    pass("chat filter: high priority", JSON.stringify(hit));
  } catch (e) {
    fail("chat filter high priority", e);
  }

  // Filter must win over a pending escalate assignee prompt
  try {
    cookie = sessions.agent.cookie;
    const stamp = Date.now();
    const cust = await ensureDirectoryCustomer();
    const created = await api("/api/tickets", {
      method: "POST",
      body: JSON.stringify({
        customerId: cust.id || undefined,
        customerName: cust.name,
        customerEmail: cust.email || undefined,
        customerPhone: cust.phone || undefined,
        subject: `Filter during escalate ${stamp}`,
        description: "needs filter while escalate pending",
        assignee: sessions.agent.user.name,
      }),
    });
    expectStatus(created, 201, "ticket for filter-during-escalate");
    const ticketId = String(created.body?.id || "");
    const sessionId = `scenario-filter-esc-${stamp}`;
    const ask = await api("/api/coworker/chat", {
      method: "POST",
      body: JSON.stringify({
        message: `escalate ticket ${ticketId}`,
        page: "Tickets",
        session_id: sessionId,
      }),
    });
    expectStatus(ask, 200, "escalate ask before filter");
    const askReply = String(ask.body?.reply || "");
    const filterChat = await api("/api/coworker/chat", {
      method: "POST",
      body: JSON.stringify({
        message: "show high priorty tickets",
        page: "Tickets",
        session_id: sessionId,
        history: [
          { role: "user", text: `escalate ticket ${ticketId}` },
          { role: "assistant", text: askReply },
        ],
      }),
    });
    expectStatus(filterChat, 200, "filter during escalate pending");
    const reply = String(filterChat.body?.reply || "");
    if (/could not find resolver/i.test(reply)) {
      throw new Error(`filter treated as assignee: ${reply.slice(0, 160)}`);
    }
    const hit = findAction(
      filterChat.body,
      "set_filter",
      (a) => a.module === "tickets" && a.priority === "high"
    );
    if (!hit) {
      throw new Error(
        `expected high priority filter during escalate ask: ${JSON.stringify(filterChat.body)}`
      );
    }
    pass("filter wins over escalate ask", JSON.stringify(hit));
  } catch (e) {
    fail("filter during escalate ask", e);
  }

  // Direct agents require key
  try {
    const noKey = await fetch(`${AGENTS}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: "hi",
        organization_id: sessions.agent.user.organizationId,
      }),
    });
    if (noKey.status === 200) throw new Error("agents /chat allowed without key");
    pass("agents /chat requires key", `HTTP ${noKey.status}`);
  } catch (e) {
    fail("agents key gate", e);
  }

  // Spoof can_create on agents
  try {
    const spoof = await fetch(`${AGENTS}/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Coworker-Tasks-Key": TASKS_KEY,
      },
      body: JSON.stringify({
        message: "create a ticket",
        page: "Home",
        organization_id: sessions.resolver.user.organizationId,
        user_id: sessions.resolver.user.id,
        user_name: sessions.resolver.user.name,
        user_role: "resolver",
        can_create_ticket: true,
        session_id: `spoof-${Date.now()}`,
      }),
    });
    const body = await spoof.json();
    if (!spoof.ok) throw new Error(JSON.stringify(body));
    if (
      !/can.?t create|cannot create|can’t create|don'?t allow|not allow|permissions?|role/i.test(
        String(body.reply || "")
      )
    ) {
      throw new Error(`spoof bypass: ${String(body.reply).slice(0, 120)}`);
    }
    pass("agents deny create even if can_create_ticket=true");
  } catch (e) {
    fail("agents create spoof", e);
  }

  // ---------- 16. Insights / analytics ----------
  section("16. Insights & analytics");
  try {
    cookie = sessions.admin.cookie;
    const a = await api("/api/analytics?range=7days");
    expectStatus(a, 200, "analytics");
    pass("admin analytics");
    const insights = await api("/api/ai-insights", {
      method: "POST",
      body: JSON.stringify({}),
    });
    expectStatus(insights, 200, "insights");
    const count = insights.body?.insights?.length ?? insights.body?.length ?? 0;
    pass("ai-insights", `${count} items`);
  } catch (e) {
    fail("insights/analytics", e);
  }

  // ---------- 17. Structure presence ----------
  section("17. Monorepo structure smoke");
  const requiredPaths = [
    "ui-frontend/src/App.tsx",
    "ui-frontend/src/components/coworker/CoworkerChatPanel.tsx",
    "ui-backend/server.ts",
    "ui-backend/src/server/db.ts",
    "ai-agents/app/main.py",
    "ai-agents/app/graph.py",
    "ai-agents/app/agents/commands.py",
    "ai-agents/app/tasks/chat_commands.py",
  ];
  for (const p of requiredPaths) {
    try {
      if (!fs.existsSync(path.join(ROOT, p))) throw new Error("missing");
      pass(`structure ${p}`);
    } catch (e) {
      fail(`structure ${p}`, e);
    }
  }

  // ---------- Summary ----------
  console.log("\n======== SCENARIO E2E SUMMARY ========");
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  if (findings.length) {
    console.log("\nFindings:");
    for (const f of findings) console.log(`  - ${f.name}: ${f.detail.slice(0, 200)}`);
  }
  const report = {
    at: new Date().toISOString(),
    base: BASE,
    agents: AGENTS,
    passed,
    failed,
    findings,
  };
  fs.writeFileSync(
    path.join(ROOT, "scripts/.scenario-e2e-report.json"),
    JSON.stringify(report, null, 2)
  );
  console.log("Report: scripts/.scenario-e2e-report.json");
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
