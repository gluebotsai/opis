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
