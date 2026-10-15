#!/usr/bin/env node
/**
 * Role × module navigation matrix for coworker chat.
 * Asserts allowed modules navigate correctly and forbidden ones are denied.
 *
 * Requires: Express :3001 + ai-agents :8012
 * Run: node scripts/role-nav-scenarios.mjs
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BASE = process.env.API_BASE || "http://127.0.0.1:3001";
const PASSWORD = process.env.SMOKE_PASSWORD || "Worktual@123";

const USERS = {
  admin: { email: process.env.SMOKE_ADMIN_EMAIL || "jane.smith@worktual.com", role: "admin" },
  agent: { email: process.env.SMOKE_AGENT_EMAIL || "smohamedfazil16@gmail.com", role: "agent" },
  resolver: { email: process.env.SMOKE_RESOLVER_EMAIL || "yaswanthmg1@gmail.com", role: "resolver" },
};

/** Expected navigate view, or null if must be denied (no navigate). */
const CASES = [
  { msg: "open settings", expect: { admin: "settings", agent: "settings", resolver: "settings" } },
  { msg: "open home", expect: { admin: "dashboard", agent: "dashboard", resolver: "dashboard" } },
  { msg: "open knowledge base", expect: { admin: "kb", agent: "kb", resolver: "kb" } },
  { msg: "go to search", expect: { admin: "search", agent: "search", resolver: "search" } },
  { msg: "my tickets", expect: { admin: "assigned", agent: "assigned", resolver: "assigned" } },
  {
    msg: "open work board",
    expect: { admin: null, agent: null, resolver: "work-board" },
  },
  {
    msg: "show customers",
    expect: { admin: "customers", agent: "customers", resolver: null },
  },
  {
    msg: "open analytics",
    expect: { admin: "analytics", agent: null, resolver: null },
  },
  {
    msg: "open teams",
    expect: { admin: "agent-queues", agent: null, resolver: null },
  },
  {
    msg: "unassigned tickets",
    expect: { admin: "unassigned", agent: "unassigned", resolver: null },
  },
  {
    msg: "create ticket",
    // create may use create_ticket action; navigate create-ticket also ok for creators
    expect: { admin: "create-ticket", agent: "create-ticket", resolver: null },
    allowCreateAction: true,
  },
];

let passed = 0;
let failed = 0;

function pass(name, detail = "") {
  passed++;
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(name, err) {
  failed++;
  const detail = err instanceof Error ? err.message : String(err);
  console.error(`  ✗ ${name} — ${detail.slice(0, 240)}`);
}

async function login(email) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login ${email} HTTP ${res.status}`);
  const set = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  const cookie = (set.find((c) => c.startsWith("worktual_token")) || "").split(";")[0];
  if (!cookie) throw new Error(`no cookie for ${email}`);
  const body = await res.json();
  return { cookie, user: body.user };
}

async function chat(cookie, message) {
  const res = await fetch(`${BASE}/api/coworker/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      message,
      page: "Home",
      session_id: `role-nav-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`chat HTTP ${res.status}: ${JSON.stringify(body).slice(0, 160)}`);
  return body;
}

/** Live chat returns `ui_actions`; some older paths used `actions`. */
function chatActions(body) {
  if (Array.isArray(body?.ui_actions)) return body.ui_actions;
  if (Array.isArray(body?.actions)) return body.actions;
  return [];
}

function navViews(actions) {
  return (actions || [])
    .filter((a) => String(a.type || "").toLowerCase() === "navigate")
    .map((a) => String(a.view || ""));
}

function hasCreate(actions) {
  return (actions || []).some((a) => String(a.type || "").toLowerCase() === "create_ticket");
}

async function main() {
  console.log("\n=== Offline TS intent nav (resolver) ===\n");
  const offline = spawnSync(
    "npx",
    [
      "--yes",
      "tsx",
      "-e",
      `
      import { routeCoworkerIntent } from './ui-frontend/src/components/coworker/coworkerIntent.ts';
      const checks = [
        ['go to search', 'search'],
        ['open work board', 'work-board'],
        ['open knowledge base', 'kb'],
        ['open settings', 'settings'],
        ['show customers', null],
        ['open analytics', null],
        ['open teams', null],
      ];
      const bad = [];
      for (const [msg, want] of checks) {
        const r = routeCoworkerIntent(msg, 'home', 'resolver');
        const got = r?.navigate ?? null;
        if (want === null) {
          if (got) bad.push(msg + ' should deny, got ' + got);
        } else if (got !== want) bad.push(msg + ' => ' + got);
      }
      if (bad.length) { console.error(JSON.stringify(bad)); process.exit(1); }
      console.log('ok');
      `,
    ],
    { cwd: ROOT, encoding: "utf8", env: process.env }
  );
  if (offline.status === 0 && (offline.stdout || "").includes("ok")) {
    pass("TS resolver intent nav matrix");
  } else {
    fail("TS resolver intent nav", new Error((offline.stderr || offline.stdout || "").slice(0, 300)));
  }

  console.log("\n=== Live chat nav matrix (admin / agent / resolver) ===\n");
  const sessions = {};
  for (const [key, u] of Object.entries(USERS)) {
    try {
      sessions[key] = await login(u.email);
      if (sessions[key].user?.role !== u.role) {
        fail(`${key} role`, new Error(`expected ${u.role} got ${sessions[key].user?.role}`));
      } else pass(`login ${key}`, u.email);
    } catch (e) {
      fail(`login ${key}`, e);
    }
  }

  for (const c of CASES) {
    for (const role of ["admin", "agent", "resolver"]) {
      const sess = sessions[role];
      if (!sess) continue;
      const name = `${role}: ${c.msg}`;
      try {
        const body = await chat(sess.cookie, c.msg);
        const actions = chatActions(body);
        const navs = navViews(actions);
        const want = c.expect[role];
        const denied = /can(not|.?t)\s+(use|access|open|create)|can’t\s+(use|access|open|create)|unable to\s+(initiate|create|access)|don.?t (have|allow)|not (have|allowed)|permissions?.{0,40}(don.?t|do not)|restricted/i.test(
          String(body.reply || "")
        );

        if (want === null) {
          if (navs.length || (c.allowCreateAction && hasCreate(actions))) {
            throw new Error(`expected deny, got nav=${JSON.stringify(navs)} actions=${JSON.stringify(actions)} reply=${String(body.reply||'').slice(0,100)}`);
          }
          if (!denied && c.msg === "create ticket") {
            // create deny text varies
            if (!/create/i.test(String(body.reply || ""))) {
              throw new Error(`expected deny reply: ${String(body.reply || "").slice(0, 120)}`);
            }
          } else if (!denied && !["create ticket"].includes(c.msg)) {
            throw new Error(`expected deny reply: ${String(body.reply || "").slice(0, 120)}`);
          }
          pass(name, "denied");
        } else if (c.allowCreateAction && want === "create-ticket") {
          const ok =
            navs.includes("create-ticket") ||
            hasCreate(actions) ||
            /customer.?s?\s+full\s+name|what is the customer|provide (the |me )?(the )?customer|customer.?s?\s+name|who is the customer/i.test(
              String(body.reply || "")
            );
          if (!ok) {
            throw new Error(`expected create flow, got nav=${JSON.stringify(navs)} reply=${String(body.reply||'').slice(0,100)}`);
          }
          pass(name, navs[0] || "create_ticket");
        } else {
          if (!navs.includes(want)) {
            throw new Error(`expected navigate ${want}, got ${JSON.stringify(navs)} reply=${String(body.reply||'').slice(0,100)}`);
          }
          pass(name, want);
        }
      } catch (e) {
        fail(name, e);
      }
    }
  }

  // Extra: high priority filter should navigate resolver to assigned (not team-inbox)
  console.log("\n=== Filter remap for resolver ===\n");
  if (sessions.resolver) {
    try {
      const body = await chat(sessions.resolver.cookie, "show high priority tickets");
      const actions = chatActions(body);
      const navs = navViews(actions);
      const hasFilter = actions.some(
        (a) =>
          String(a.type).toLowerCase() === "set_filter" &&
          String(a.module).toLowerCase() === "tickets"
      );
      if (!hasFilter) throw new Error(`missing set_filter: ${JSON.stringify(actions)}`);
      if (navs.includes("team-inbox") || navs.includes("unassigned") || navs.includes("customers")) {
        throw new Error(`bad nav for resolver: ${JSON.stringify(navs)}`);
      }
      if (navs.length && !navs.every((v) => ["assigned", "search", "tickets-list"].includes(v) || v === "assigned")) {
        // tickets-list should be remapped by Express; prefer assigned
        if (!navs.includes("assigned") && !navs.includes("search")) {
          throw new Error(`expected assigned/search, got ${JSON.stringify(navs)}`);
        }
      }
      pass("resolver high priority filter", JSON.stringify(navs));
    } catch (e) {
      fail("resolver high priority filter", e);
    }
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
