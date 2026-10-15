/**
 * Live API tests. Skipped unless RUN_SDK_INTEGRATION=1 and API is up.
 *
 * Prerequisites:
 *   npm run dev:api   # :3001
 *   DATABASE_URL + JWT_SECRET in .env
 *
 * Run:
 *   RUN_SDK_INTEGRATION=1 npm run sdk:test:integration
 */
import { describe, expect, it } from "vitest";
import { createTicketingClient, TicketingApiError } from "../../src/index.js";

const RUN = process.env.RUN_SDK_INTEGRATION === "1";
const BASE = process.env.API_BASE || "http://127.0.0.1:3001";
const ADMIN = process.env.SMOKE_ADMIN || "jane.smith@worktual.com";
const PASSWORD = process.env.SMOKE_PASSWORD || "Worktual@123";

async function login(): Promise<{ token: string; cookie: string }> {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: ADMIN, password: PASSWORD }),
  });
  if (!res.ok) {
    throw new Error(`login HTTP ${res.status}`);
  }
  const body = (await res.json()) as { token?: string };
  if (!body.token) throw new Error("login response missing token");

  const set =
    typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  const cookie =
    (set.find((c) => c.startsWith("worktual_token")) || "").split(";")[0] ||
    `worktual_token=${body.token}`;

  return { token: body.token, cookie };
}

async function createApiKey(cookie: string): Promise<string> {
  const res = await fetch(`${BASE}/api/integration/keys`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ name: `sdk-integration-${Date.now()}` }),
  });
  const body = (await res.json()) as { secret?: string; error?: string };
  if (!res.ok || !body.secret) {
    throw new Error(`create key failed: ${JSON.stringify(body).slice(0, 200)}`);
  }
  return body.secret;
}

describe.runIf(RUN)("SDK live integration", () => {
  it("intake + staff ticket/notes round-trip", async () => {
    const { token, cookie } = await login();
    const apiKey = await createApiKey(cookie);

    const intakeClient = createTicketingClient({ baseUrl: BASE, apiKey });

    try {
      await createTicketingClient({ baseUrl: BASE }).intake.createTicket({
        channel: "api",
        requester: { name: "X", email: "x@y.com" },
        subject: "no auth",
      });
      expect.fail("expected 401");
    } catch (e) {
      expect(e).toBeInstanceOf(TicketingApiError);
      expect((e as TicketingApiError).status).toBe(401);
    }

    const created = await intakeClient.intake.createTicket({
      channel: "api",
      requester: {
        name: "SDK Integration",
        email: `sdk.int.${Date.now()}@example.com`,
      },
      subject: "SDK integration intake ticket",
      description: "Created by packages/ticketing-sdk integration test",
      priority: "medium",
      externalRef: `sdk-int-${Date.now()}`,
    });

    expect(created.ticketNumber).toBeTruthy();

    const staff = createTicketingClient({
      baseUrl: BASE,
      accessToken: token,
    });

    const listed = await staff.tickets.list({ scope: "org", limit: 50 });
    expect(Array.isArray(listed)).toBe(true);
    expect(listed.some((t) => t.id === created.ticketNumber)).toBe(true);

    const got = await staff.tickets.get(created.ticketNumber);
    expect(got.id).toBe(created.ticketNumber);
    expect(got.subject).toContain("SDK integration");

    const note = await staff.notes.add(created.ticketNumber, {
      text: "SDK integration note",
      visibility: "internal",
    });
    expect(note.text).toBe("SDK integration note");

    const notes = await staff.notes.list(created.ticketNumber);
    expect(notes.some((n) => n.text === "SDK integration note")).toBe(true);

    const customers = await staff.customers.list({ q: "sdk.int." });
    expect(Array.isArray(customers)).toBe(true);

    const queues = await staff.queues.list();
    expect(Array.isArray(queues)).toBe(true);
  });
});

describe.skipIf(RUN)("SDK live integration (skipped)", () => {
  it("set RUN_SDK_INTEGRATION=1 with API on :3001 to run", () => {
    expect(true).toBe(true);
  });
});
