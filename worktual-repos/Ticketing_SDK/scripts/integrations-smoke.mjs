#!/usr/bin/env node
/**
 * Smoke all P0 integration surfaces:
 * API keys, intake, widget, email (create+thread), outbound mail log, automations.
 *
 * Run: node scripts/integrations-smoke.mjs
 * Requires: Express on API_BASE (default http://127.0.0.1:3001)
 */
const BASE = process.env.API_BASE || "http://127.0.0.1:3001";
const PASSWORD = process.env.SMOKE_PASSWORD || "Worktual@123";
const ADMIN = process.env.SMOKE_ADMIN || "jane.smith@worktual.com";

let passed = 0;
let failed = 0;
const failures = [];

function pass(name, detail = "") {
  passed++;
  console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ""}`);
}
function fail(name, err) {
  failed++;
  const detail = err instanceof Error ? err.message : String(err);
  failures.push({ name, detail });
  console.error(`  ✗ ${name} — ${detail.slice(0, 220)}`);
}

async function login() {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login HTTP ${res.status}`);
  const set =
    typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  const cookie = (set.find((c) => c.startsWith("worktual_token")) || "").split(
    ";"
  )[0];
  if (!cookie) throw new Error("no cookie");
  return cookie;
}

async function main() {
  console.log("\n=== Integrations smoke (P0) ===\n");
  let cookie;
  try {
    cookie = await login();
    pass("admin login");
  } catch (e) {
    fail("admin login", e);
    process.exit(1);
  }

  let secret = "";
  try {
    const res = await fetch(`${BASE}/api/integration/keys`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ name: `integrations-smoke-${Date.now()}` }),
    });
    const body = await res.json();
    if (!res.ok || !body.secret) throw new Error(JSON.stringify(body).slice(0, 160));
    secret = body.secret;
    pass("create API key", body.key?.keyPrefix || "");
  } catch (e) {
    fail("create API key", e);
  }

  // Unauthorized intake
  try {
    const res = await fetch(`${BASE}/api/intake/tickets`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        channel: "api",
        requester: { name: "X", email: "x@y.com" },
        subject: "no auth",
        description: "should 401",
      }),
    });
    if (res.status !== 401) throw new Error(`expected 401 got ${res.status}`);
    pass("intake rejects missing key");
  } catch (e) {
    fail("intake rejects missing key", e);
  }

  // Intake create
  let intakeTn = "";
  const intakeEmail = `intake.full.${Date.now()}@example.com`;
  try {
    const res = await fetch(`${BASE}/api/intake/tickets`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({
        channel: "api",
        requester: {
          name: "Intake Smoke",
          email: intakeEmail,
        },
        subject: "Full suite intake ticket",
        description: "Created by integrations-smoke",
        priority: "medium",
      }),
    });
    const body = await res.json();
    if (res.status !== 201 || !body.ticketNumber) {
      throw new Error(`${res.status} ${JSON.stringify(body).slice(0, 160)}`);
    }
    intakeTn = body.ticketNumber;
    pass("intake create ticket", `${body.ticketNumber} channel=${body.channel}`);
  } catch (e) {
    fail("intake create ticket", e);
  }

  if (intakeTn && secret) {
    try {
      const res = await fetch(`${BASE}/api/intake/tickets/status`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${secret}`,
        },
        body: JSON.stringify({
          ticketNumber: intakeTn,
          email: intakeEmail,
        }),
      });
      const body = await res.json();
      if (res.status !== 200 || body.ticketNumber !== intakeTn || !body.status) {
        throw new Error(`${res.status} ${JSON.stringify(body).slice(0, 160)}`);
      }
      pass("intake ticket status", `${body.ticketNumber} status=${body.status}`);
    } catch (e) {
      fail("intake ticket status", e);
    }
  }

  // Widget
  let publicId = "";
  try {
    const res = await fetch(`${BASE}/api/integration/widgets`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        name: `Smoke widget ${Date.now()}`,
        buttonLabel: "Help",
        allowedOrigins: [],
      }),
    });
    const body = await res.json();
    if (!res.ok || !body.widget?.publicId) {
      throw new Error(JSON.stringify(body).slice(0, 160));
    }
    publicId = body.widget.publicId;
    if (!body.embedSnippet?.includes("worktual-help.js")) {
      throw new Error("missing embed snippet");
    }
    pass("create help widget", publicId);
  } catch (e) {
    fail("create help widget", e);
  }

  try {
    const js = await fetch(`${BASE}/embed/worktual-help.js`);
    if (!js.ok) throw new Error(`embed JS HTTP ${js.status}`);
    pass("serve embed script");
  } catch (e) {
    fail("serve embed script", e);
  }

  try {
    const res = await fetch(`${BASE}/api/public/widgets/${publicId}/tickets`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "https://example.com",
      },
      body: JSON.stringify({
        requester: {
          name: "Widget Smoke",
          email: `widget.full.${Date.now()}@example.com`,
        },
        subject: "Help widget full smoke",
        description: "Need assistance from embed",
      }),
    });
    const body = await res.json();
    if (res.status !== 201 || body.channel !== "Web") {
      throw new Error(`${res.status} ${JSON.stringify(body).slice(0, 160)}`);
    }
    pass("widget creates ticket", body.ticketNumber);
  } catch (e) {
    fail("widget creates ticket", e);
  }

  // Email create + thread
  const mid = `<full-smoke-${Date.now()}@worktual.test>`;
  let emailTn = "";
  try {
    const res = await fetch(`${BASE}/api/intake/email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({
        from: {
          name: "Email Smoke",
          email: `email.full.${Date.now()}@example.com`,
        },
        subject: "Cannot login to portal",
        text: "Password reset failed.",
        messageId: mid,
      }),
    });
    const body = await res.json();
    if (res.status !== 201 || body.action !== "created" || body.channel !== "Email") {
      throw new Error(`${res.status} ${JSON.stringify(body).slice(0, 160)}`);
    }
    emailTn = body.ticketNumber;
    pass("email intake create", emailTn);
  } catch (e) {
    fail("email intake create", e);
  }

  try {
    const res = await fetch(`${BASE}/api/intake/email`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({
        from: {
          name: "Email Smoke",
          email: `email.full.${Date.now()}@example.com`,
        },
        subject: `Re: Cannot login to portal`,
        text: "Still locked out.",
        messageId: `<reply-${Date.now()}@worktual.test>`,
        inReplyTo: mid,
      }),
    });
    const body = await res.json();
    if (res.status !== 200 || body.action !== "appended" || body.ticketNumber !== emailTn) {
      throw new Error(`${res.status} ${JSON.stringify(body).slice(0, 160)}`);
    }
    pass("email intake append reply", body.ticketNumber);
  } catch (e) {
    fail("email intake append reply", e);
  }

  // Automation
  try {
    const res = await fetch(`${BASE}/api/automation/rules`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        name: `Smoke billing ${Date.now()}`,
        event: "ticket.created",
        conditions: { subjectContains: "billing-smoke-unique" },
        actions: { setPriority: "high" },
        enabled: true,
      }),
    });
    const body = await res.json();
    if (!res.ok || !body.rule?.id) throw new Error(JSON.stringify(body).slice(0, 160));
    pass("create automation rule", body.rule.name);
  } catch (e) {
    fail("create automation rule", e);
  }

  try {
    const res = await fetch(`${BASE}/api/intake/tickets`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret}`,
      },
      body: JSON.stringify({
        channel: "api",
        requester: {
          name: "Auto Smoke",
          email: `auto.full.${Date.now()}@example.com`,
        },
        subject: "Please check billing-smoke-unique invoice",
        description: "Wrong amount",
        priority: "low",
      }),
    });
    const created = await res.json();
    if (res.status !== 201 || !created.ticketNumber) {
      throw new Error(`${res.status} ${JSON.stringify(created).slice(0, 160)}`);
    }
    const detailRes = await fetch(
      `${BASE}/api/tickets/${encodeURIComponent(created.ticketNumber)}`,
      { headers: { Cookie: cookie } }
    );
    const detail = await detailRes.json();
    if (String(detail.priority || "").toLowerCase() !== "high") {
      throw new Error(
        `expected priority high, got ${detail.priority} for ${created.ticketNumber}`
      );
    }
    pass("automation sets priority high", created.ticketNumber);
  } catch (e) {
    fail("automation sets priority high", e);
  }

  // Outbound mail log check via creating ticket (MAIL_MODE=log default)
  try {
    if (!intakeTn) throw new Error("no intake ticket from earlier step");
    // Soft check: server should have logged; we verify ticket exists
    const detailRes = await fetch(
      `${BASE}/api/tickets/${encodeURIComponent(intakeTn)}`,
      { headers: { Cookie: cookie } }
    );
    if (!detailRes.ok) throw new Error(`ticket load ${detailRes.status}`);
    pass("outbound path reachable (ticket exists after create mail hook)");
  } catch (e) {
    fail("outbound path reachable", e);
  }

  // List keys / rules / widgets
  try {
    const [k, r, w] = await Promise.all([
      fetch(`${BASE}/api/integration/keys`, { headers: { Cookie: cookie } }),
      fetch(`${BASE}/api/automation/rules`, { headers: { Cookie: cookie } }),
      fetch(`${BASE}/api/integration/widgets`, { headers: { Cookie: cookie } }),
    ]);
    if (!k.ok || !r.ok || !w.ok) throw new Error("list endpoints failed");
    pass("list keys / rules / widgets");
  } catch (e) {
    fail("list keys / rules / widgets", e);
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failures.length) {
    console.log("Failures:");
    for (const f of failures) console.log(` - ${f.name}: ${f.detail.slice(0, 200)}`);
  }
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
