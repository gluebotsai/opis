import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createTicketingClient,
  TicketingApiError,
  TicketingAuthError,
  signWorktualPayload,
  verifyWorktualSignature,
} from "../../src/index.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    return handler(url, init);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("createTicketingClient auth", () => {
  it("sends X-Api-Key for intake.createTicket", async () => {
    const fetchMock = mockFetch(() =>
      Response.json(
        {
          ticketId: "1",
          ticketNumber: "TKT-1",
          status: "Open",
          channel: "API",
          subject: "Hi",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
        { status: 201 }
      )
    );

    const client = createTicketingClient({
      baseUrl: "http://127.0.0.1:3001/",
      apiKey: "wt_live_testkey",
    });

    await client.intake.createTicket({
      channel: "api",
      requester: { name: "Riya", email: "riya@example.com" },
      subject: "VPN",
      description: "down",
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:3001/api/intake/tickets");
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("X-Api-Key")).toBe("wt_live_testkey");
    expect(headers.get("Authorization")).toBeNull();
  });

  it("throws TicketingAuthError when apiKey missing for intake", async () => {
    const client = createTicketingClient({ baseUrl: "http://127.0.0.1:3001" });
    await expect(
      client.intake.createTicket({
        channel: "api",
        requester: { email: "a@b.com" },
        subject: "x",
      })
    ).rejects.toBeInstanceOf(TicketingAuthError);
  });

  it("sends Authorization Bearer for tickets.list", async () => {
    const fetchMock = mockFetch(() => Response.json([]));

    const client = createTicketingClient({
      baseUrl: "http://127.0.0.1:3001",
      accessToken: "staff.jwt.token",
    });

    await client.tickets.list({ scope: "org", limit: 10 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/tickets?");
    expect(String(url)).toContain("scope=org");
    expect(String(url)).toContain("limit=10");
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer staff.jwt.token");
  });

  it("throws TicketingAuthError when accessToken missing for staff routes", async () => {
    const client = createTicketingClient({
      baseUrl: "http://127.0.0.1:3001",
      apiKey: "wt_live_only",
    });
    await expect(client.tickets.list()).rejects.toBeInstanceOf(TicketingAuthError);
    await expect(client.customers.list()).rejects.toBeInstanceOf(TicketingAuthError);
    await expect(client.queues.list()).rejects.toBeInstanceOf(TicketingAuthError);
  });

  it("maps non-2xx to TicketingApiError", async () => {
    mockFetch(() =>
      Response.json({ error: "Invalid or revoked API key" }, { status: 401 })
    );

    const client = createTicketingClient({
      baseUrl: "http://127.0.0.1:3001",
      apiKey: "wt_live_bad",
    });

    try {
      await client.intake.createTicket({
        channel: "api",
        requester: { email: "x@y.com" },
        subject: "nope",
      });
      expect.fail("expected error");
    } catch (e) {
      expect(e).toBeInstanceOf(TicketingApiError);
      const err = e as TicketingApiError;
      expect(err.status).toBe(401);
      expect(err.message).toContain("Invalid or revoked");
    }
  });

  it("encodes ticket numbers in path", async () => {
    const fetchMock = mockFetch(() =>
      Response.json({
        id: "TKT-9",
        subject: "s",
        description: "",
        customerName: "A",
        customerEmail: "a@b.com",
        channel: "Web",
        assignee: "Unassigned",
        priority: "medium",
        status: "Open",
        updatedAt: "now",
        createdAt: "2026-01-01T00:00:00.000Z",
      })
    );

    const client = createTicketingClient({
      baseUrl: "http://127.0.0.1:3001",
      accessToken: "tok",
    });
    await client.tickets.get("TKT/9");
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "http://127.0.0.1:3001/api/tickets/TKT%2F9"
    );
  });
});

describe("partner session and co-worker", () => {
  it("mints a session with the partner key and locale", async () => {
    const fetchMock = mockFetch(() =>
      Response.json(
        {
          sessionToken: "jwt",
          sessionId: "9",
          expiresAt: "2026-10-06T00:00:00.000Z",
          locale: "es",
          organizationId: "1000",
          actor: { id: "2", name: "Jane", email: "jane@worktual.com", role: "admin" },
        },
        { status: 201 }
      )
    );
    const client = createTicketingClient({
      baseUrl: "http://127.0.0.1:3001",
      partnerApiKey: "wt_live_partner",
      locale: "en",
    });
    await client.auth.createSession({
      actor: { email: "jane@worktual.com" },
      locale: "es",
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://127.0.0.1:3001/api/sdk/sessions");
    const headers = new Headers(init?.headers);
    expect(headers.get("X-Api-Key")).toBe("wt_live_partner");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      actor: { email: "jane@worktual.com" },
      locale: "es",
    });
  });

  it("sends ai.turn with locale, focus, and session token", async () => {
    const fetchMock = mockFetch(() =>
      Response.json({
        assistantText: "Listo",
        reply: "Listo",
        agent: "ticket_lifecycle_executor",
        session_id: "chat-1",
        ui_actions: [],
        toolProposals: [{ name: "escalate_ticket", args: { ticket: "#1" }, risk: "high", auto: false }],
      })
    );
    const client = createTicketingClient({
      baseUrl: "http://127.0.0.1:3001",
      locale: "es",
    });
    const turn = await client.ai.turn({
      sessionToken: "session.jwt",
      message: "Escala este ticket",
      focusedTicketId: "#1",
    });
    expect(turn.status).toBe("confirmation_required");
    expect(turn.locale).toBe("es");
    const [, init] = fetchMock.mock.calls[0];
    const headers = new Headers(init?.headers);
    expect(headers.get("Authorization")).toBe("Bearer session.jwt");
    expect(headers.get("X-Worktual-Sdk-Feature")).toBe("ai.turn");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      message: "Escala este ticket",
      locale: "es",
      entity_id: "#1",
      focused_entity: { type: "ticket", ticketNumber: "#1" },
    });
    expect(JSON.parse(String(init?.body)).debug).toBeUndefined();
  });

  it("sends debug and keeps only the routing endpoints", async () => {
    const fetchMock = mockFetch(() =>
      Response.json({
        assistantText: "Listo",
        agent: "ticket_lifecycle_executor",
        trace: {
          agents: ["ticketing_coworker", "ticket_lifecycle_executor"],
          routes: [{ from: "ticketing_coworker", to: "ticket_lifecycle_executor", query: "secret" }],
        },
      })
    );
    const client = createTicketingClient({ baseUrl: "http://127.0.0.1:3001" });
    const turn = await client.ai.turn({
      sessionToken: "session.jwt",
      message: "Hola",
      debug: true,
    });
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).debug).toBe(true);
    expect(turn.trace).toEqual({
      agents: ["ticketing_coworker", "ticket_lifecycle_executor"],
      routes: [{ from: "ticketing_coworker", to: "ticket_lifecycle_executor" }],
    });
    expect(JSON.stringify(turn.trace)).not.toContain("secret");
  });

  it("reads usage events with partner, turn, and confirmation fields", async () => {
    const fetchMock = mockFetch(() =>
      Response.json({
        organizationId: "1000",
        events: [
          {
            id: "9",
            partnerId: "42",
            tenantId: "1000",
            actorId: "7",
            sessionId: "3",
            surface: "headless",
            component: null,
            feature: "ai.turn",
            skill: "ticket-create",
            executor: "ticket_creation_executor",
            locale: "es",
            agentTurns: 1,
            confirmRequired: true,
            ok: true,
            createdAt: "2026-10-01T00:00:00.000Z",
          },
        ],
      })
    );
    const client = createTicketingClient({
      baseUrl: "http://127.0.0.1:3001",
      partnerApiKey: "wt_live_partner",
    });
    const listed = await client.usage.events({ from: "2026-10-01T00:00:00.000Z", limit: 20 });
    expect(listed.events[0]).toMatchObject({
      partnerId: "42",
      tenantId: "1000",
      agentTurns: 1,
      confirmRequired: true,
    });
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/sdk/usage/events");
    expect(String(fetchMock.mock.calls[0][0])).toContain("limit=20");
  });

  it("confirms and rejects on the same turn route", async () => {
    const fetchMock = mockFetch(() =>
      Response.json({
        assistantText: "Hecho",
        reply: "Hecho",
        agent: "general",
        toolProposals: [{ name: "update_ticket", auto: true, risk: "low" }],
      })
    );
    const client = createTicketingClient({
      baseUrl: "http://127.0.0.1:3001",
      accessToken: "fallback",
    });
    const confirmed = await client.ai.confirm({
      confirmTool: { name: "update_ticket", args: { status: "Resolved" } },
    });
    expect(confirmed.status).toBe("applied");
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("X-Worktual-Sdk-Feature")).toBe(
      "ai.confirm"
    );

    await client.ai.reject({ message: "No" });
    const rejectBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(rejectBody.message).toBe("No");
    expect(rejectBody.confirm_tool).toBeUndefined();
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get("X-Worktual-Sdk-Feature")).toBe(
      "ai.reject"
    );
  });

  it("reads the final SSE result and progress events", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode('event: progress\ndata: {"step":"super"}\n\n')
        );
        controller.enqueue(
          encoder.encode(
            'event: result\ndata: {"assistantText":"Hola","reply":"Hola","agent":"general","ui_actions":[]}\n\n'
          )
        );
        controller.enqueue(encoder.encode("event: done\ndata: {}\n\n"));
        controller.close();
      },
    });
    const fetchMock = mockFetch(
      () => new Response(stream, { headers: { "Content-Type": "text/event-stream" } })
    );
    const client = createTicketingClient({
      baseUrl: "http://127.0.0.1:3001",
      accessToken: "tok",
    });
    const progress: string[] = [];
    const turn = await client.ai.stream({
      message: "Hola",
      locale: "es",
      onProgress: (event) => progress.push(String(event.step)),
    });
    expect(turn.reply).toBe("Hola");
    expect(progress).toEqual(["super"]);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/api/coworker/agent-turn/stream");
  });

  it("reads usage with the partner key", async () => {
    const fetchMock = mockFetch(() =>
      Response.json({
        from: "2026-09-01T00:00:00.000Z",
        to: "2026-10-01T00:00:00.000Z",
        organizationId: "1000",
        logins: 1,
        sessionEnds: 0,
        turns: 2,
        streams: 0,
        confirms: 1,
        rejects: 0,
        byFeature: [{ feature: "ai.turn", count: 2 }],
        bySkill: [{ skill: "analytics-query", count: 2 }],
      })
    );
    const client = createTicketingClient({
      baseUrl: "http://127.0.0.1:3001",
      apiKey: "wt_live_partner",
    });
    const summary = await client.usage.summary({ from: "2026-09-01T00:00:00.000Z" });
    expect(summary.turns).toBe(2);
    expect(summary.bySkill).toEqual([{ skill: "analytics-query", count: 2 }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("from=2026-09-01");
    expect(new Headers(init?.headers).get("X-Api-Key")).toBe("wt_live_partner");
  });

  it("surfaces a quota rejection before treating it as a turn", async () => {
    mockFetch(
      () =>
        new Response(JSON.stringify({ error: "This workspace has reached its AI turn limit. Try again shortly.", code: "quota_exceeded" }), {
          status: 429,
          headers: { "Content-Type": "application/json" },
        })
    );
    const client = createTicketingClient({
      baseUrl: "http://127.0.0.1:3001",
      accessToken: "session.jwt",
    });
    await expect(client.ai.turn({ message: "Hola", locale: "en" })).rejects.toMatchObject({
      status: 429,
      code: "quota_exceeded",
    });
  });
});

describe("named tasks", () => {
  it("pins summarize on the co-worker turn", async () => {
    const fetchMock = mockFetch(() =>
      Response.json({
        assistantText: "VPN outage, waiting on the customer.",
        agent: "investigation_summary_executor",
        toolProposals: [{ name: "update_ticket", auto: true, risk: "low" }],
      })
    );
    const client = createTicketingClient({
      baseUrl: "http://127.0.0.1:3001",
      accessToken: "session.jwt",
      locale: "es",
    });
    const card = await client.ai.tasks.summarize({ ticketNumber: "#128" });
    expect(card.task).toBe("ticket.summarize");
    expect(card.status).toBe("applied");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("http://127.0.0.1:3001/api/coworker/agent-turn");
    expect(new Headers(init?.headers).get("X-Worktual-Sdk-Feature")).toBe("ai.tasks.summarize");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      sdk_task: "ticket.summarize",
      message: "Summarize this ticket.",
      locale: "es",
      entity_id: "#128",
      focused_entity: { type: "ticket", ticketNumber: "#128" },
    });
  });

  it("returns an editable draft and keeps similar tickets as a recommendation", async () => {
    const fetchMock = mockFetch((url) => {
      if (String(url).includes("agent-turn")) {
        return Response.json({
          assistantText: "Hola, ya revisamos la VPN.",
          agent: "customer_reply_drafting_executor",
          data: { tickets: [{ ticketNumber: "#90", subject: "VPN" }] },
          toolProposals: [
            { name: "add_ticket_note", auto: false, risk: "high", args: { ticket_number: "#128" } },
          ],
        });
      }
      return Response.json({ assistantText: "ok" });
    });
    const client = createTicketingClient({
      baseUrl: "http://127.0.0.1:3001",
      accessToken: "session.jwt",
    });
    const draft = await client.ai.tasks.draftReply({
      ticketNumber: "#128",
    });
    expect(draft.status).toBe("confirmation_required");
    expect(draft.draft).toBe("Hola, ya revisamos la VPN.");
    expect(draft.proposal?.name).toBe("add_ticket_note");

    const similar = await client.ai.tasks.similar({ ticketNumber: "#128" });
    expect(similar.status).toBe("recommendation");
    expect(similar.tickets[0]?.ticketNumber).toBe("#90");
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get("X-Worktual-Sdk-Feature")).toBe(
      "ai.tasks.similar"
    );
  });

  it("requires an issue for deflect and marks a deflected answer", async () => {
    const client = createTicketingClient({
      baseUrl: "http://127.0.0.1:3001",
      accessToken: "session.jwt",
    });
    await expect(client.ai.tasks.deflect({})).rejects.toMatchObject({ status: 400 });
    const fetchMock = mockFetch(() =>
      Response.json({
        assistantText: "Reset the VPN from Settings.",
        agent: "dssa",
        data: { dssa_deflected: true, articles: [{ title: "Reset VPN" }] },
      })
    );
    const card = await createTicketingClient({
      baseUrl: "http://127.0.0.1:3001",
      accessToken: "session.jwt",
    }).ai.tasks.deflect({ message: "How do I reset VPN?" });
    expect(card.status).toBe("deflected");
    expect(card.deflected).toBe(true);
    expect(card.articles[0]?.title).toBe("Reset VPN");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).message).toBe(
      "How do I reset VPN?"
    );
  });
});

describe("proposals", () => {
  it("lists open proposals for a ticket and decides one", async () => {
    const fetchMock = mockFetch((url) => {
      if (String(url).includes("/decide")) {
        return Response.json({ id: "approval:12", ok: true, status: "applied" });
      }
      return Response.json({
        items: [
          {
            id: "approval:12",
            kind: "approval",
            status: "confirmation_required",
            agentId: "crda",
            ticketNumber: "#128",
            summary: "Send this reply",
            draft: "Hola",
          },
        ],
      });
    });
    const client = createTicketingClient({
      baseUrl: "http://127.0.0.1:3001",
      accessToken: "session.jwt",
    });
    const listed = await client.ai.proposals.list({ ticketNumber: "#128", status: "open" });
    expect(listed.items[0]?.id).toBe("approval:12");
    expect(String(fetchMock.mock.calls[0][0])).toContain("ticketNumber=%23128");
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("X-Worktual-Sdk-Feature")).toBe(
      "ai.proposals.list"
    );
    const decided = await client.ai.proposals.decide({
      id: "approval:12",
      decision: "confirm",
      edits: { text: "Hola, listo" },
    });
    expect(decided.status).toBe("applied");
    const sent = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(sent).toEqual({ decision: "confirm", edits: { text: "Hola, listo" } });
    expect(String(fetchMock.mock.calls[1][0])).toContain("/api/sdk/proposals/approval%3A12/decide");
    expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get("X-Worktual-Sdk-Feature")).toBe(
      "ai.proposals.confirm"
    );
  });

  it("rejects a malformed proposal id before fetch", async () => {
    const client = createTicketingClient({
      baseUrl: "http://127.0.0.1:3001",
      accessToken: "session.jwt",
    });
    await expect(client.ai.proposals.decide({ id: "12", decision: "reject" })).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe("insights", () => {
  it("asks for certified metrics and copies values from the tool payload", async () => {
    const fetchMock = mockFetch(() =>
      Response.json({
        assistantText: "There are 12 open tickets.",
        agent: "analytics_audit_query_executor",
        sessionMemoryPatch: {
          lastToolOutcome: {
            success: true,
            payload: { metrics: [{ id: "open_tickets", label: "Open", value: 12 }] },
          },
        },
      })
    );
    const client = createTicketingClient({
      baseUrl: "http://127.0.0.1:3001",
      accessToken: "session.jwt",
    });
    const card = await client.ai.tasks.askMetrics({ message: "How many open tickets?" });
    expect(card.status).toBe("answered");
    expect(card.metrics).toEqual([{ id: "open_tickets", label: "Open", value: 12 }]);
    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.sdk_task).toBe("analytics.ask");
    expect(body.message).toBe("How many open tickets?");
    expect(body.sql).toBeUndefined();
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("X-Worktual-Sdk-Feature")).toBe(
      "ai.tasks.askMetrics"
    );
  });

  it("drops invented numbers when Context Layer is unavailable", async () => {
    const client = createTicketingClient({
      baseUrl: "http://127.0.0.1:3001",
      accessToken: "session.jwt",
    });
    await expect(client.ai.tasks.askWhy({ message: "" })).rejects.toMatchObject({ status: 400 });
    mockFetch(() =>
      Response.json({
        assistantText: "SLA fell because of 40 breaches.",
        data: { code: "temporarily_unavailable" },
      })
    );
    const card = await createTicketingClient({
      baseUrl: "http://127.0.0.1:3001",
      accessToken: "session.jwt",
    }).ai.tasks.askWhy({ message: "Why did SLA drop?" });
    expect(card.status).toBe("temporarily_unavailable");
    expect(card.reply).toBe("This answer is temporarily unavailable.");
    expect(card.code).toBe("temporarily_unavailable");
    expect(card.metrics).toEqual([]);
    expect(card.why).toBeUndefined();
  });
});

describe("partner error codes", () => {
  it("replaces a refusal and a missing customer with the locale sentence", async () => {
    mockFetch(() =>
      Response.json({
        assistantText: "Payroll is outside Ticketing.",
        agent: "ticketing_super_agent",
        data: { refusal: { code: "unsupported_product", message: "Payroll is outside Ticketing." } },
      })
    );
    const refused = await createTicketingClient({
      baseUrl: "http://127.0.0.1:3001",
      accessToken: "session.jwt",
    }).ai.turn({ message: "Refund payroll", locale: "es", sessionToken: "session.jwt" });
    expect(refused.code).toBe("unsupported_operation");
    expect(refused.reply).toBe("Esta solicitud no está admitida.");
    expect(refused.reply).not.toContain("Payroll");

    mockFetch(() =>
      Response.json({
        assistantText: "I could not find that person.",
        data: { ticket_draft: { customer_not_found: true } },
      })
    );
    const missing = await createTicketingClient({
      baseUrl: "http://127.0.0.1:3001",
      accessToken: "session.jwt",
    }).ai.turn({ message: "Open a ticket for Ada", locale: "de", sessionToken: "session.jwt" });
    expect(missing.code).toBe("customer_not_found");
    expect(missing.reply).toBe("Es wurde kein passender Kunde gefunden.");
  });
});

describe("login, inbox, and the remaining named tasks", () => {
  it("creates a ticket from the issue and keeps workload as advice", async () => {
    const client = createTicketingClient({
      baseUrl: "http://127.0.0.1:3001",
      accessToken: "session.jwt",
    });
    await expect(client.ai.tasks.createTicket({})).rejects.toMatchObject({ status: 400 });
    const fetchMock = mockFetch(() =>
      Response.json({
        assistantText: "Created #200",
        agent: "ticket_creation_executor",
        toolProposals: [{ name: "create_ticket", auto: false, risk: "high", args: { subject: "VPN" } }],
      })
    );
    const created = await createTicketingClient({
      baseUrl: "http://127.0.0.1:3001",
      accessToken: "session.jwt",
    }).ai.tasks.createTicket({ message: "VPN is down" });
    expect(created.status).toBe("confirmation_required");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).sdk_task).toBe("ticket.create");
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("X-Worktual-Sdk-Feature")).toBe(
      "ai.tasks.createTicket"
    );

    fetchMock.mockImplementation(async () =>
      Response.json({
        assistantText: "Move two tickets off Alex.",
        agent: "workload_optimization_executor",
        toolProposals: [{ name: "assign_ticket", auto: false, risk: "high" }],
      })
    );
    const load = await createTicketingClient({
      baseUrl: "http://127.0.0.1:3001",
      accessToken: "session.jwt",
    }).ai.tasks.workload({});
    expect(load.status).toBe("recommendation");
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body)).sdk_task).toBe("ticket.workload");
  });

  it("logs in without an API key and lists the inbox", async () => {
    const fetchMock = mockFetch((url) => {
      if (String(url).includes("/api/auth/login")) {
        return Response.json({ token: "staff.jwt", user: { email: "jane@worktual.com" } });
      }
      if (String(url).includes("/otp/verify")) {
        return Response.json({ token: "portal.jwt", customer: { id: "c1" } });
      }
      return Response.json([
        { id: "n1", title: "Assigned", message: "You own #128", ticketId: "#128", read: false, kind: "assignment" },
      ]);
    });
    const client = createTicketingClient({ baseUrl: "http://127.0.0.1:3001" });
    const staff = await client.auth.login({ email: "jane@worktual.com", password: "secret" });
    expect(staff.sessionToken).toBe("staff.jwt");
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("Authorization")).toBeNull();
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("X-Api-Key")).toBeNull();
    const portal = await client.auth.portal.verifyOtp({ slug: "acme", identifier: "a@b.com", code: "123456" });
    expect(portal.sessionToken).toBe("portal.jwt");
    const inbox = await createTicketingClient({
      baseUrl: "http://127.0.0.1:3001",
      accessToken: "staff.jwt",
    }).inbox.list();
    expect(inbox.items[0]).toMatchObject({ id: "n1", ticketNumber: "#128", read: false });
  });

  it("parses a create stream", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('event: progress\ndata: {"step":"intake"}\n\n'));
        controller.enqueue(
          encoder.encode(
            'event: result\ndata: {"assistantText":"Ready to file","agent":"ticket_creation_executor","toolProposals":[]}\n\n'
          )
        );
        controller.close();
      },
    });
    const fetchMock = mockFetch(() => new Response(stream, { headers: { "Content-Type": "text/event-stream" } }));
    const steps: string[] = [];
    const result = await createTicketingClient({
      baseUrl: "http://127.0.0.1:3001",
      accessToken: "session.jwt",
    }).ai.stream({
      message: "VPN is down",
      sdkTask: "ticket.create",
      onProgress: (event) => steps.push(String(event.step || "")),
    });
    expect(steps).toEqual(["intake"]);
    expect(result.reply).toBe("Ready to file");
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get("X-Worktual-Sdk-Feature")).toBe(
      "ai.tasks.createTicket"
    );
  });
});

describe("usage surface", () => {
  it("sends ui and the widget tag when the client is a component", async () => {
    const fetchMock = mockFetch(() => Response.json({ assistantText: "Hola", agent: "general" }));
    await createTicketingClient({
      baseUrl: "http://127.0.0.1:3001",
      accessToken: "session.jwt",
      surface: "ui",
      component: "worktual-chat",
    }).ai.turn({ message: "Hola" });
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(headers.get("X-Worktual-Sdk-Surface")).toBe("ui");
    expect(headers.get("X-Worktual-Sdk-Component")).toBe("worktual-chat");
  });
});

describe("verifyWorktualSignature", () => {
  it("accepts a matching signature", () => {
    const body = JSON.stringify({ type: "ticket.created", ticketNumber: "TKT-1" });
    const secret = "test-webhook-secret";
    const header = signWorktualPayload(body, secret);
    expect(verifyWorktualSignature(body, header, secret)).toBe(true);
  });

  it("rejects tampered body", () => {
    const body = JSON.stringify({ type: "ticket.created" });
    const secret = "test-webhook-secret";
    const header = signWorktualPayload(body, secret);
    expect(verifyWorktualSignature(body + "x", header, secret)).toBe(false);
  });

  it("rejects missing header or secret", () => {
    expect(verifyWorktualSignature("{}", null, "sec")).toBe(false);
    expect(verifyWorktualSignature("{}", "sha256=abc", "")).toBe(false);
  });
});

describe("help widgets", () => {
  it("creates a widget with the partner key and submits a public ticket without it", async () => {
    const fetchMock = mockFetch((url) => {
      if (url.includes("/api/sdk/widgets")) {
        return Response.json(
          {
            widget: { id: "4", publicId: "wgt_abc", name: "Help" },
            embed: {
              script: "<script data-widget-id=\"wgt_abc\"></script>",
              iframe: "<iframe src=\"https://tickets.example/embed/help.html?id=wgt_abc\"></iframe>",
            },
          },
          { status: 201 }
        );
      }
      return Response.json({
        ticketId: "9",
        ticketNumber: "TKT-9",
        status: "Open",
        channel: "Web",
        subject: "Cannot log in",
        createdAt: "2026-10-06T00:00:00.000Z",
        updatedAt: "2026-10-06T00:00:00.000Z",
      });
    });
    const client = createTicketingClient({
      baseUrl: "http://127.0.0.1:3001",
      partnerApiKey: "wt_live_partner",
    });
    const created = await client.widgets.create({ name: "Help", allowedOrigins: ["https://partner.example"] });
    expect(created.widget.publicId).toBe("wgt_abc");
    expect(created.embed.iframe).toContain("help.html?id=wgt_abc");
    const createHeaders = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(createHeaders.get("X-Api-Key")).toBe("wt_live_partner");

    const filed = await client.widgets.submitTicket("wgt_abc", {
      name: "Riya",
      email: "riya@clienta.com",
      subject: "Cannot log in",
    });
    expect(filed.ticketNumber).toBe("TKT-9");
    const publicHeaders = new Headers(fetchMock.mock.calls[1][1]?.headers);
    expect(publicHeaders.get("X-Api-Key")).toBeNull();
    expect(publicHeaders.get("Authorization")).toBeNull();
    expect(String(fetchMock.mock.calls[1][0])).toContain("/api/public/widgets/wgt_abc/tickets");
  });
});
