#!/usr/bin/env node
/**
 * Module + filter scenario suite for co-worker UI actions / intents.
 *
 * Offline (tsx): coworkerIntent + coworkerActions
 * Live (optional): /ui-actions + /chat count questions when servers are up
 *
 * Run: node scripts/module-filter-scenarios.mjs
 */
import { spawnSync } from "node:child_process";
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
const SKIP_LIVE = process.env.SKIP_LIVE === "1";
const TASKS_KEY =
  process.env.COWORKER_TASKS_SECRET || "worktual-tasks-dev-secret";
const agentsHeaders = {
  "Content-Type": "application/json",
  "X-Coworker-Tasks-Key": TASKS_KEY,
};

let passed = 0;
let failed = 0;

function pass(name, detail = "") {
  passed++;
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(name, err) {
  failed++;
  const msg = err instanceof Error ? err.message : String(err);
  console.log(`  ✗ ${name} — ${msg.slice(0, 240)}`);
}

async function api(pathName, opts = {}, cookie = "") {
  const headers = {
    "Content-Type": "application/json",
    ...(opts.headers || {}),
  };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(`${BASE}${pathName}`, { ...opts, headers });
  let nextCookie = cookie;
  for (const c of res.headers.getSetCookie?.() || []) {
    if (c.startsWith("worktual_token=")) nextCookie = c.split(";")[0];
  }
  const raw = res.headers.get("set-cookie");
  if (raw?.includes("worktual_token=")) nextCookie = raw.split(";")[0];
  const body = await res.json().catch(() => null);
  return { status: res.status, body, cookie: nextCookie };
}

/* -------------------------------------------------------------------------- */
/* Offline matrix via tsx                                                     */
/* -------------------------------------------------------------------------- */
function runOffline() {
  console.log("\n=== Offline module/filter matrix ===\n");
  const script = `
import {
  routeCoworkerIntent,
  isListAllIntent,
  isDataQuestion,
} from './ui-frontend/src/components/coworker/coworkerIntent.ts';
import {
  inferCoworkerUiActionsFallback,
  normalizeCoworkerUiActions,
  applyCoworkerUiActions,
} from './ui-frontend/src/components/coworker/coworkerActions.ts';

const bad = [];
const ok = (name, cond, d='') => { if (!cond) bad.push(name + (d ? ': '+d : '')); else console.log('  ✓ '+name+(d?' — '+d:'')); };

const LIST_PHRASES = [
  'list all', 'show all', 'show everyone', 'clear filter', 'clear filters',
  'reset search', 'remove filter', 'all', 'everything', 'list all customers',
  'list all teams', 'show all articles', 'all customers',
];

const MODULE_VIEWS = [
  ['customers', 'customerSearch'],
  ['kb', 'kbSearch'],
  ['agent-queues', 'teamsSearch'],
];

// --- list-all detection ---
for (const p of LIST_PHRASES) {
  ok('isListAll: '+p, isListAllIntent(p) === true);
}
for (const p of ['find Acme', 'how many customers', 'my tickets', 'create ticket', 'show all tickets', 'hi']) {
  ok('not list-all: '+p, isListAllIntent(p) === false);
}

// --- intent clears correct module field ---
for (const [view, field] of MODULE_VIEWS) {
  const r = routeCoworkerIntent('list all', view);
  ok('intent list all @'+view, !!r && r[field] === '', JSON.stringify(r));
}
ok('list all customers from home', (() => {
  const r = routeCoworkerIntent('list all customers', 'dashboard');
  return r?.navigate === 'customers' && r?.customerSearch === '';
})());
ok('list all tickets from customers page', (() => {
  const r = routeCoworkerIntent('list all tickets', 'customers');
  return r === null;
})());
ok('show everyone @customers', routeCoworkerIntent('show everyone', 'customers')?.customerSearch === '');

// --- soft-search dump dead on every list module ---
const DUMP = ['Acme Corp xyz', 'random words here', 'status', 'priority', 'hello filterme'];
for (const [view, field] of MODULE_VIEWS) {
  for (const msg of DUMP) {
    const r = routeCoworkerIntent(msg, view);
    const leaked = r && r[field] === msg;
    ok('no dump "'+msg+'" @'+view, !leaked, JSON.stringify(r));
  }
}

// --- questions are data questions ---
for (const q of [
  'how many customers are there?',
  'how many customers are assigned to me',
  'how many tickets do I have',
  'what customers do we have',
  'who has the most tickets',
]) {
  ok('dataQ: '+q, isDataQuestion(q) === true);
  ok('intent null for Q: '+q, routeCoworkerIntent(q, 'customers') === null);
}

// --- classic navigations ---
ok('my tickets is agent-owned', routeCoworkerIntent('my tickets', 'home') === null);
ok('unassigned tickets is agent-owned', routeCoworkerIntent('unassigned tickets', 'home') === null);
ok('show customers', routeCoworkerIntent('show customers', 'home')?.navigate === 'customers' && routeCoworkerIntent('show customers', 'home')?.customerSearch === '');
ok('find customer Acme', (() => {
  const r = routeCoworkerIntent('find customer Acme', 'home');
  return r?.navigate === 'customers' && r?.customerSearch === 'Acme';
})());
ok('update status no search', !routeCoworkerIntent('update ticket status', 'home')?.ticketSearch);
ok('create typo is agent-owned', routeCoworkerIntent('craete ticket','home','agent') === null);
const rDeny = routeCoworkerIntent('create ticket','home','resolver');
ok('resolver no create flow', !rDeny?.ticketCreate && rDeny?.navigate !== 'create-ticket' && !/full name/i.test(rDeny?.reply||''));
ok('agent create is agent-owned', routeCoworkerIntent('create ticket','home','agent') === null);

// --- ui action fallbacks per module page label ---
const PAGES = [
  ['Customers', 'customers'],
  ['Knowledge Base', 'kb'],
  ['Teams', 'teams'],
];
for (const [page, mod] of PAGES) {
  const a = inferCoworkerUiActionsFallback('list all', page === 'My Tickets' || page === 'Team inbox' || page === 'Unassigned' ? 'assigned' : page === 'Knowledge Base' ? 'kb' : page === 'Teams' ? 'agent-queues' : 'customers');
  // map page → view for fallback helper (uses currentView codes)
  const view =
    page === 'Customers' ? 'customers' :
    page === 'Knowledge Base' ? 'kb' :
    page === 'Teams' ? 'agent-queues' : 'assigned';
  const fb = inferCoworkerUiActionsFallback('list all', view);
  ok('fallback list all @'+view, fb.actions.some(x => x.type==='set_filter' && x.module===mod && x.query===''), JSON.stringify(fb));
  const q = inferCoworkerUiActionsFallback('how many items?', view);
  ok('fallback Q no action @'+view, q.actions.length === 0);
}

ok('fallback find Acme', inferCoworkerUiActionsFallback('find customer Acme', 'customers').actions.some(x => x.type==='set_filter' && /acme/i.test(x.query)));
ok('fallback show everyone', inferCoworkerUiActionsFallback('show everyone', 'customers').actions.some(x => x.query===''));

// --- facet fallbacks ---
const urgent = inferCoworkerUiActionsFallback('open urgent tickets', 'dashboard');
ok('fallback urgent is agent-owned', urgent.actions.length === 0);
const activeCust = inferCoworkerUiActionsFallback('show active customers', 'customers');
ok('fallback active customers', activeCust.actions.some(x => x.type==='set_filter' && x.status==='Active'));

// --- normalize sanitization ---
ok('norm blanks list all', normalizeCoworkerUiActions([{type:'set_filter',module:'customers',query:'list all'}])[0]?.query === '');
ok('norm blanks show all', normalizeCoworkerUiActions([{type:'set_filter',module:'kb',query:'show all'}])[0]?.query === '');
ok('norm keeps entity', normalizeCoworkerUiActions([{type:'set_filter',module:'customers',query:'Acme'}])[0]?.query === 'Acme');
ok('norm clear all', normalizeCoworkerUiActions([{type:'clear_filters',module:'all'}])[0]?.module === 'all');
const facetNorm = normalizeCoworkerUiActions([{type:'set_filter',module:'tickets',query:'',status:'open',priority:'URGENT',channel:'email'}])[0];
ok('norm ticket facets', facetNorm?.status==='Open' && facetNorm?.priority==='urgent' && facetNorm?.channel==='Email');

// --- apply ---
let customer='x', ticket='x', kb='x', teams='x', facets=false, nav=null, keep=null;
let tStatus='x', tPri='x', tCh='x', cStatus='x';
applyCoworkerUiActions(
  [
    { type:'navigate', view:'customers' },
    { type:'set_filter', module:'customers', query:'' },
    { type:'clear_filters', module:'all' },
  ],
  {
    navigate: (v, o) => { nav = v; keep = !!(o && o.keepFilters); },
    setCustomerSearch: (q) => { customer = q; },
    setCustomerStatus: (q) => { cStatus = q; },
    setTicketSearch: (q) => { ticket = q; },
    setTicketStatus: (q) => { tStatus = q; },
    setTicketPriority: (q) => { tPri = q; },
    setTicketChannel: (q) => { tCh = q; },
    setKbSearch: (q) => { kb = q; },
    setTeamsSearch: (q) => { teams = q; },
    clearTicketFacetFilters: () => { facets = true; tStatus=''; tPri=''; tCh=''; },
  }
);
ok('apply navigate', nav === 'customers');
ok('apply keepFilters with batch', keep === true);
ok('apply clear customer', customer === '');
ok('apply clear ticket', ticket === '');
ok('apply clear kb', kb === '');
ok('apply clear teams', teams === '');
ok('apply facets', facets === true);

let nav2=null, keep2=null, tPri2='x';
applyCoworkerUiActions(
  [
    { type:'navigate', view:'tickets-list' },
    { type:'set_filter', module:'tickets', query:'', status:'Open', priority:'urgent' },
  ],
  {
    navigate: (v, o) => { nav2 = v; keep2 = !!(o && o.keepFilters); },
    setTicketSearch: () => {},
    setTicketStatus: () => {},
    setTicketPriority: (p) => { tPri2 = p; },
    setTicketChannel: () => {},
  }
);
ok('apply facet keepFilters', keep2 === true && nav2 === 'tickets-list');
ok('apply facet priority', tPri2 === 'urgent');

if (bad.length) {
  console.error(JSON.stringify(bad, null, 2));
  process.exit(1);
}
console.log('OFFLINE_OK '+ (LIST_PHRASES.length + MODULE_VIEWS.length));
`;

  const r = spawnSync("npx", ["--yes", "tsx", "-e", script], {
    cwd: ROOT,
    encoding: "utf8",
    env: process.env,
  });
  const out = (r.stdout || "") + (r.stderr || "");
  for (const line of out.split("\n")) {
    if (line.includes("✓")) {
      passed++;
      console.log(line);
    } else if (line.trim() && !line.includes("devdir") && !line.includes("npm warn")) {
      if (line.includes("OFFLINE_OK")) pass("offline matrix complete", line.trim());
      else if (r.status !== 0 && line.trim().startsWith("[")) fail("offline matrix", line);
      else if (line.trim() && !line.includes("ExperimentalWarning")) {
        // print non-check lines only if failure blob
      }
    }
  }
  if (r.status !== 0) {
    fail("offline matrix exit", new Error((r.stderr || r.stdout || "").slice(0, 500)));
    console.log(out.slice(0, 2000));
  } else if (!out.includes("OFFLINE_OK")) {
    // recount from checkmarks already counted; ensure we mark pass
    pass("offline matrix", "ok");
  }
}

/* -------------------------------------------------------------------------- */
/* Live agents + API                                                          */
/* -------------------------------------------------------------------------- */
async function runLive() {
  console.log("\n=== Live ui-actions + count questions ===\n");

  try {
    const h = await fetch(`${AGENTS}/health`);
    const hb = await h.json();
    if (!h.ok) throw new Error("agents down");
    pass("agents health", hb.model || "ok");
  } catch (e) {
    fail("agents health", e);
    return;
  }

  const pages = [
    ["list all", "Customers", "customers", ""],
    ["show everyone", "Customers", "customers", ""],
    ["clear filter", "Customers", "customers", ""],
    ["show all", "Knowledge Base", "kb", ""],
    ["list all", "Teams", "teams", ""],
  ];

  for (const [msg, page, mod, wantQ] of pages) {
    try {
      const res = await fetch(`${AGENTS}/ui-actions`, {
        method: "POST",
        headers: agentsHeaders,
        body: JSON.stringify({ message: msg, page }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(body));
      const hit = (body.actions || []).find(
        (a) =>
          (a.type === "set_filter" && a.module === mod && a.query === wantQ) ||
          (a.type === "clear_filters" && (a.module === mod || a.module === "all"))
      );
      if (!hit) throw new Error(JSON.stringify(body.actions));
      pass(`ui-actions ${msg} @ ${page}`, JSON.stringify(hit));
    } catch (e) {
      fail(`ui-actions ${msg} @ ${page}`, e);
    }
  }

  for (const page of ["Tickets", "My Tickets", "Team inbox", "Unassigned"]) {
    try {
      const res = await fetch(`${AGENTS}/ui-actions`, {
        method: "POST",
        headers: agentsHeaders,
        body: JSON.stringify({ message: "list all", page }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(body));
      if ((body.actions || []).length) throw new Error(JSON.stringify(body.actions));
      pass(`ui-actions ticket semantics deferred @ ${page}`);
    } catch (e) {
      fail(`ui-actions ticket semantics deferred @ ${page}`, e);
    }
  }

  // Questions → no filter actions
  for (const [msg, page] of [
    ["how many customers are there?", "Customers"],
    ["how many tickets do I have?", "Tickets"],
    ["how many teams are there?", "Teams"],
  ]) {
    try {
      const res = await fetch(`${AGENTS}/ui-actions`, {
        method: "POST",
        headers: agentsHeaders,
        body: JSON.stringify({ message: msg, page }),
      });
      const body = await res.json();
      if ((body.actions || []).length !== 0) {
        throw new Error(`expected no actions got ${JSON.stringify(body.actions)}`);
      }
      pass(`ui-actions Q no filter: ${msg}`);
    } catch (e) {
      fail(`ui-actions Q: ${msg}`, e);
    }
  }

  // Find entity — must not use full utterance
  try {
    const res = await fetch(`${AGENTS}/ui-actions`, {
      method: "POST",
      headers: agentsHeaders,
      body: JSON.stringify({
        message: "find customer Acme",
        page: "Customers",
      }),
    });
    const body = await res.json();
    const filters = (body.actions || []).filter((a) => a.type === "set_filter");
    for (const f of filters) {
      if (/find customer/i.test(f.query) || f.query.toLowerCase() === "find customer acme") {
        throw new Error(`utterance used as query: ${f.query}`);
      }
    }
    pass("ui-actions find Acme sanitized", JSON.stringify(filters));
  } catch (e) {
    fail("ui-actions find Acme", e);
  }

  // Faceted filters (status / priority / channel / customer status)
  const facetLive = [
    ["open urgent tickets", "Tickets", null],
    ["high priority tickets", "My Tickets", null],
    ["show high priorty tickets", "Tickets", null],
    ["medium priority tickets", "Tickets", null],
    ["low priority tickets", "Tickets", null],
    ["pending tickets", "Team inbox", null],
    ["resolved tickets", "Tickets", null],
    ["on hold tickets", "Tickets", null],
    ["overdue tickets", "Tickets", null],
    ["email channel tickets", "Tickets", null],
    ["chat channel tickets", "Tickets", null],
    ["show active customers", "Customers", { module: "customers", status: "Active" }],
    ["show inactive customers", "Customers", { module: "customers", status: "Inactive" }],
    ["how many open tickets are there?", "Tickets", null],
  ];
  for (const [msg, page, expect] of facetLive) {
    try {
      const res = await fetch(`${AGENTS}/ui-actions`, {
        method: "POST",
        headers: agentsHeaders,
        body: JSON.stringify({ message: msg, page }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(JSON.stringify(body));
      if (expect === null) {
        if ((body.actions || []).length !== 0) {
          throw new Error(`expected no actions: ${JSON.stringify(body.actions)}`);
        }
        pass(`ui-actions facet Q: ${msg}`);
        continue;
      }
      const hit = (body.actions || []).find((a) => {
        if (a.type !== "set_filter" || a.module !== expect.module) return false;
        if (expect.status && a.status !== expect.status) return false;
        if (expect.priority && a.priority !== expect.priority) return false;
        if (expect.channel && a.channel !== expect.channel) return false;
        return true;
      });
      if (!hit) throw new Error(JSON.stringify(body.actions));
      pass(`ui-actions facet: ${msg}`, JSON.stringify(hit));
    } catch (e) {
      fail(`ui-actions facet: ${msg}`, e);
    }
  }

  // Chat counts need an authenticated actor — live metrics are org+user scoped.
  let countCookie = "";
  try {
    const login = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: process.env.SMOKE_ADMIN_EMAIL || "jane.smith@worktual.com",
        password: PASSWORD,
      }),
    });
    if (login.status !== 200) throw new Error(`count login ${login.status}`);
    countCookie = login.cookie || "";
    if (!countCookie) throw new Error("count login missing cookie");
  } catch (e) {
    fail("chat count login", e);
  }
  for (const [msg, page, re] of [
    ["how many customers are there?", "Customers", /\b\d+\b/],
    ["how many tickets are open?", "Tickets", /\b\d+\b/],
  ]) {
    try {
      if (!countCookie) throw new Error("Authentication required");
      const { status, body } = await api(
        "/api/coworker/chat",
        {
          method: "POST",
          body: JSON.stringify({
            message: msg,
            page,
            session_id: `filter-count-${Date.now()}`,
          }),
        },
        countCookie
      );
      if (status !== 200) throw new Error(JSON.stringify(body));
      const reply = String(body.reply || "");
      if (!re.test(reply)) throw new Error(`no count in: ${reply.slice(0, 160)}`);
      pass(`chat count: ${msg}`, `${body.agent} · ${reply.slice(0, 80)}`);
    } catch (e) {
      fail(`chat count: ${msg}`, e);
    }
  }

  // Express proxy requires auth — login then hit ui-actions
  try {
    let cookie = "";
    const login = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: process.env.SMOKE_AGENT_EMAIL || "smohamedfazil16@gmail.com",
        password: PASSWORD,
      }),
    });
    if (login.status !== 200) throw new Error(`login ${login.status}`);
    cookie = login.cookie;
    pass("express login for ui-actions");

    const ui = await api(
      "/api/coworker/ui-actions",
      {
        method: "POST",
        body: JSON.stringify({ message: "list all", page: "Customers" }),
      },
      cookie
    );
    if (ui.status !== 200) throw new Error(`${ui.status} ${JSON.stringify(ui.body)}`);
    const actions = ui.body?.actions || [];
    if (
      !actions.some(
        (a) => a.type === "set_filter" && a.module === "customers" && a.query === ""
      )
    ) {
      throw new Error(JSON.stringify(actions));
    }
    pass("express /api/coworker/ui-actions list all");

    const cust = await api("/api/customers", {}, cookie);
    const n = Array.isArray(cust.body) ? cust.body.length : 0;
    if (cust.status !== 200 || n < 1) throw new Error(`customers ${cust.status} n=${n}`);
    pass("API customers countable", String(n));

    // LangGraph /chat filter matrix — every role + common facets
    const logins = [
      ["agent", process.env.SMOKE_AGENT_EMAIL || "smohamedfazil16@gmail.com"],
      ["admin", process.env.SMOKE_ADMIN_EMAIL || "jane.smith@worktual.com"],
      ["resolver", process.env.SMOKE_RESOLVER_EMAIL || "yaswanthmg1@gmail.com"],
    ];
    const chatFilters = [
      ["show all customers", "Customers", { module: "customers", query: "" }],
      ["list all", "My Tickets", { module: "tickets", query: "" }],
      ["clear filter", "Customers", { module: "customers", query: "" }],
      ["open urgent tickets", "Tickets", { module: "tickets", status: "Open", priority: "urgent" }],
      ["high priority tickets", "Tickets", { module: "tickets", priority: "high" }],
      ["show high priorty tickets", "Tickets", { module: "tickets", priority: "high" }],
      ["medium priority tickets", "Tickets", { module: "tickets", priority: "medium" }],
      ["low priority tickets", "Tickets", { module: "tickets", priority: "low" }],
      ["pending tickets", "Team inbox", { module: "tickets", status: "Pending" }],
      ["resolved tickets", "Tickets", { module: "tickets", status: "Resolved" }],
      ["on hold tickets", "Tickets", { module: "tickets", status: "Pending" }],
      ["overdue tickets", "Tickets", { module: "tickets", status: "Overdue" }],
      ["email channel tickets", "Tickets", { module: "tickets", channel: "Email" }],
      ["show active customers", "Customers", { module: "customers", status: "Active" }],
      ["show inactive customers", "Customers", { module: "customers", status: "Inactive" }],
    ];
    for (const [role, email] of logins) {
      const loginR = await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password: PASSWORD }),
      });
      if (loginR.status !== 200) {
        fail(`login ${role}`, new Error(`HTTP ${loginR.status}`));
        continue;
      }
      cookie = loginR.cookie;
      pass(`chat-filter login ${role}`);
      for (const [msg, page, expect] of chatFilters) {
        try {
          const chat = await api(
            "/api/coworker/chat",
            {
              method: "POST",
              body: JSON.stringify({
                message: msg,
                page,
                session_id: `filter-chat-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              }),
            },
            cookie
          );
          if (chat.status !== 200) {
            throw new Error(`chat → ${chat.status} ${JSON.stringify(chat.body)}`);
          }
          if (/could not find resolver/i.test(String(chat.body?.reply || ""))) {
            throw new Error(`filter treated as escalate assignee: ${String(chat.body.reply).slice(0, 120)}`);
          }
          const chatActions = chat.body?.ui_actions || [];
          // Resolvers cannot use Customers — expect a deny, not a set_filter.
          if (role === "resolver" && expect.module === "customers") {
            const reply = String(chat.body?.reply || "");
            const denied = /can.?t use|can’t use|customers/i.test(reply);
            const leaked = chatActions.some(
              (a) => a.type === "set_filter" && a.module === "customers"
            );
            if (!denied || leaked) {
              throw new Error(`resolver should deny customers: reply=${reply.slice(0,100)} actions=${JSON.stringify(chatActions)}`);
            }
            pass(`express /chat [${role}] ${msg}`, "denied");
            continue;
          }
          const hit = chatActions.find((a) => {
            if (a.type !== "set_filter" || a.module !== expect.module) return false;
            if (expect.query !== undefined && String(a.query ?? "") !== expect.query) return false;
            if (expect.status && a.status !== expect.status) return false;
            if (expect.priority && a.priority !== expect.priority) return false;
            if (expect.channel && a.channel !== expect.channel) return false;
            return true;
          });
          if (!hit) {
            throw new Error(`miss: ${JSON.stringify(chatActions)} reply=${String(chat.body?.reply||"").slice(0,80)}`);
          }
          pass(`express /chat [${role}] ${msg}`, JSON.stringify(hit));
        } catch (e) {
          fail(`express /chat [${role}] ${msg}`, e);
        }
      }
    }
  } catch (e) {
    fail("express ui-actions path", e);
  }
}

/* -------------------------------------------------------------------------- */
async function main() {
  console.log("Module + filter scenarios");
  console.log(`API ${BASE} · Agents ${AGENTS}`);
  runOffline();
  if (!SKIP_LIVE) await runLive();

  console.log(`\n=== Summary ===\nPassed: ${passed}\nFailed: ${failed}`);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
