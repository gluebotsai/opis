import type { Express, Request, Response } from "express";
import { TicketingProductError } from "./accountsSync";
import {
  createDirectoryCustomer,
  CustomerDirectoryError,
  findActiveCustomer,
  listDirectoryCustomers,
  mapDirectoryCustomer,
  parseCustomerImport,
} from "./customersDirectory";
import {
  clearPortalCookie,
  consumeSetPasswordToken,
  createPortalSession,
  getOrgPortalConfig,
  getOrgPortalConfigBySlug,
  loginPortalPassword,
  peekPortalCustomer,
  requirePortalAuth,
  requestPortalOtp,
  requestPortalPasswordReset,
  revokePortalSession,
  setPortalCookie,
  signPortalToken,
  verifyPortalOtp,
  type PortalAuthedRequest,
} from "./portalAuth";
import { runPortalChat } from "./portalChat";
import {
  addPortalPublicNote,
  createPortalTicket,
  getPortalTicket,
  listPortalTickets,
  submitPortalCsat,
} from "./portalTickets";
import {
  getPublishedHelpArticle,
  listHelpCategories,
  listPublishedHelpArticles,
} from "./helpCenter";

function clientMeta(req: Request) {
  const ip =
    (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() ||
    req.socket.remoteAddress ||
    "127.0.0.1";
  return {
    ipAddress: ip,
    userAgent: String(req.headers["user-agent"] || "").slice(0, 400),
    deviceLabel: "Support portal",
  };
}

export function registerPortalRoutes(app: Express): void {
  app.get("/api/public/support/:slug", async (req, res) => {
    try {
      const org = await getOrgPortalConfigBySlug(String(req.params.slug));
      if (!org) return res.status(404).json({ error: "Support portal not found." });
      res.json({
        slug: org.slug,
        name: org.name,
        portalLabel: org.portalLabel || org.name,
        portalAuthMode: org.portalAuthMode,
        businessType: org.businessType,
        supportPath: `/support/${encodeURIComponent(org.slug)}`,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load support portal." });
    }
  });

  app.get("/api/public/support/:slug/articles", async (req, res) => {
    try {
      const org = await getOrgPortalConfigBySlug(String(req.params.slug));
      if (!org) return res.status(404).json({ error: "Support portal not found." });
      const [articles, categories] = await Promise.all([
        listPublishedHelpArticles({
          organizationId: org.id,
          q: String(req.query.q || ""),
          category: String(req.query.category || ""),
          limit: Number(req.query.limit || 50),
        }),
        listHelpCategories(org.id),
      ]);
      res.json({ articles, categories });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load articles." });
    }
  });

  app.get("/api/public/support/:slug/articles/:articleId", async (req, res) => {
    try {
      const org = await getOrgPortalConfigBySlug(String(req.params.slug));
      if (!org) return res.status(404).json({ error: "Support portal not found." });
      const article = await getPublishedHelpArticle({
        organizationId: org.id,
        articleId: String(req.params.articleId),
      });
      if (!article) return res.status(404).json({ error: "Article not found." });
      res.json(article);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load article." });
    }
  });

  app.post("/api/public/support/:slug/otp/request", async (req, res) => {
    try {
      const org = await getOrgPortalConfigBySlug(String(req.params.slug));
      if (!org) return res.status(404).json({ error: "Support portal not found." });
      if (org.portalAuthMode !== "otp") {
        return res.status(400).json({ error: "This portal uses password sign-in." });
      }
      const result = await requestPortalOtp({
        organizationId: org.id,
        identifier: String(req.body?.identifier || req.body?.email || req.body?.phone || ""),
      });
      if (result.ok === false) {
        return res.status(result.status).json({
          error: result.error,
          code: result.code,
          identifierKind: result.identifierKind,
        });
      }
      res.json({ ok: true, channel: result.channel, masked: result.masked });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Could not send a verification code." });
    }
  });

  app.post("/api/public/support/:slug/otp/verify", async (req, res) => {
    try {
      const org = await getOrgPortalConfigBySlug(String(req.params.slug));
      if (!org) return res.status(404).json({ error: "Support portal not found." });
      if (org.portalAuthMode !== "otp") {
        return res.status(400).json({ error: "This portal uses password sign-in." });
      }
      const result = await verifyPortalOtp({
        organizationId: org.id,
        identifier: String(req.body?.identifier || req.body?.email || req.body?.phone || ""),
        code: String(req.body?.code || ""),
      });
      if (result.ok === false) {
        return res.status(result.status).json({
          error: result.error,
          code: result.code,
          identifierKind: result.identifierKind,
        });
      }
      const meta = clientMeta(req);
      const session = await createPortalSession({
        customer: result.customer,
        ...meta,
      });
      const token = signPortalToken(session);
      setPortalCookie(res, token, req);
      res.json({ customer: publicCustomer(session), token });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Could not verify the code." });
    }
  });

  app.post("/api/public/support/:slug/login", async (req, res) => {
    try {
      const org = await getOrgPortalConfigBySlug(String(req.params.slug));
      if (!org) return res.status(404).json({ error: "Support portal not found." });
      if (org.portalAuthMode !== "password") {
        return res.status(400).json({ error: "This portal uses one-time codes." });
      }
      const result = await loginPortalPassword({
        organizationId: org.id,
        email: String(req.body?.email || ""),
        password: String(req.body?.password || ""),
      });
      if (result.ok === false) {
        return res.status(result.status).json({
          error: result.error,
          code: result.code,
          identifierKind: result.identifierKind,
        });
      }
      const meta = clientMeta(req);
      const session = await createPortalSession({
        customer: result.customer,
        ...meta,
      });
      const token = signPortalToken(session);
      setPortalCookie(res, token, req);
      res.json({ customer: publicCustomer(session), token });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Sign-in failed." });
    }
  });

  app.post("/api/public/support/:slug/forgot-password", async (req, res) => {
    try {
      const org = await getOrgPortalConfigBySlug(String(req.params.slug));
      if (!org) return res.status(404).json({ error: "Support portal not found." });
      if (org.portalAuthMode !== "password") {
        return res.status(400).json({ error: "This portal uses one-time codes." });
      }
      const email = String(req.body?.email || "").trim();
      if (!email) {
        return res.status(400).json({ error: "Email is required." });
      }
      await requestPortalPasswordReset({
        organizationId: org.id,
        email,
        slug: org.slug,
      });
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Could not send a reset email." });
    }
  });

  app.post("/api/public/support/:slug/set-password", async (req, res) => {
    try {
      const result = await consumeSetPasswordToken({
        token: String(req.body?.token || ""),
        password: String(req.body?.password || ""),
      });
      if (result.ok === false) {
        return res.status(result.status).json({ error: result.error });
      }
      const org = await getOrgPortalConfig(result.customer.organizationId);
      if (org && org.portalAuthMode === "password") {
        const meta = clientMeta(req);
        const session = await createPortalSession({
          customer: result.customer,
          ...meta,
        });
        const token = signPortalToken(session);
        setPortalCookie(res, token, req);
        return res.json({ ok: true, customer: publicCustomer(session), token });
      }
      res.json({ ok: true });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Could not set password." });
    }
  });

  app.post("/api/portal/logout", async (req, res) => {
    try {
      const customer = await peekPortalCustomer(req);
      await revokePortalSession(customer?.sessionId, customer?.id);
    } catch {
      /* ignore */
    }
    clearPortalCookie(res, req);
    res.json({ ok: true });
  });

  app.get("/api/portal/me", requirePortalAuth, async (req: PortalAuthedRequest, res) => {
    const c = req.portalCustomer!;
    const full = await findActiveCustomer({
      organizationId: c.organizationId,
      customerId: c.id,
    });
    if (!full) return res.status(401).json({ error: "Session expired." });
    res.json({ customer: mapDirectoryCustomer(full) });
  });

  app.get("/api/portal/profile", requirePortalAuth, async (req: PortalAuthedRequest, res) => {
    try {
      const c = req.portalCustomer!;
      const full = await findActiveCustomer({
        organizationId: c.organizationId,
        customerId: c.id,
      });
      if (!full) return res.status(404).json({ error: "Customer not found." });
      const org = await getOrgPortalConfig(c.organizationId);
      const tickets = await listPortalTickets(c);
      res.json({
        customer: mapDirectoryCustomer(full),
        businessType: org?.businessType || "b2c",
        tickets,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load profile." });
    }
  });

  app.get("/api/portal/tickets", requirePortalAuth, async (req: PortalAuthedRequest, res) => {
    try {
      res.json(await listPortalTickets(req.portalCustomer!));
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load tickets." });
    }
  });

  app.get(
    "/api/portal/tickets/:ticketNumber",
    requirePortalAuth,
    async (req: PortalAuthedRequest, res) => {
      try {
        const found = await getPortalTicket(
          req.portalCustomer!,
          String(req.params.ticketNumber)
        );
        if (!found) return res.status(404).json({ error: "Ticket not found." });
        res.json(found);
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to load ticket." });
      }
    }
  );

  app.post("/api/portal/tickets", requirePortalAuth, async (req: PortalAuthedRequest, res) => {
    try {
      const created = await createPortalTicket(req.portalCustomer!, {
        subject: req.body?.subject,
        description: req.body?.description,
        issue: req.body?.issue,
        forceCreate: Boolean(req.body?.forceCreate || req.body?.force_create),
      });
      res.status(201).json(created);
    } catch (err) {
      if (err && typeof err === "object" && (err as { deflected?: boolean }).deflected) {
        return res.status(409).json({
          deflected: true,
          agent: "dssa",
          reply: String((err as { reply?: string }).reply || (err as Error).message || ""),
          confidence: (err as { confidence?: number }).confidence,
        });
      }
      if (err instanceof TicketingProductError) {
        return res
          .status(err.status)
          .json({ error: err.message, code: err.code });
      }
      const status = Number((err as { status?: number }).status || 500);
      if (status >= 400 && status < 500) {
        return res.status(status).json({ error: (err as Error).message });
      }
      console.error(err);
      res.status(500).json({ error: "Failed to create ticket." });
    }
  });

  app.post(
    "/api/portal/tickets/:ticketNumber/csat",
    requirePortalAuth,
    async (req: PortalAuthedRequest, res) => {
      try {
        const result = await submitPortalCsat(
          req.portalCustomer!,
          String(req.params.ticketNumber),
          req.body?.score ?? req.body?.csatScore,
          req.body?.comment ?? req.body?.csatComment
        );
        if (result.ok === false) {
          return res.status(result.status).json({ error: result.error });
        }
        res.json({ ok: true, ticket: result.ticket });
      } catch (err) {
        console.error(err);
        res.status(500).json({ error: "Failed to submit rating." });
      }
    }
  );

  app.post(
    "/api/portal/tickets/:ticketNumber/notes",
    requirePortalAuth,
    async (req: PortalAuthedRequest, res) => {
      try {
        const note = await addPortalPublicNote(
          req.portalCustomer!,
          String(req.params.ticketNumber),
          String(req.body?.text || req.body?.body || "")
        );
        if (!note) return res.status(404).json({ error: "Ticket not found." });
        res.status(201).json(note);
      } catch (err) {
        const status = Number((err as { status?: number }).status || 500);
        if (status >= 400 && status < 500) {
          return res.status(status).json({ error: (err as Error).message });
        }
        console.error(err);
        res.status(500).json({ error: "Failed to add note." });
      }
    }
  );

  app.post("/api/portal/chat", async (req: PortalAuthedRequest, res) => {
    try {
      const slug = String(req.body?.slug || req.query.slug || "").trim();
      const org = slug
        ? await getOrgPortalConfigBySlug(slug)
        : null;
      if (!org) return res.status(400).json({ error: "Support portal slug is required." });

      const peeked = await peekPortalCustomer(req);
      const customer =
        peeked && peeked.organizationId === org.id ? peeked : null;

      const result = await runPortalChat({
        organizationId: org.id,
        slug: org.slug,
        message: String(req.body?.message || ""),
        sessionId: req.body?.sessionId
          ? String(req.body.sessionId)
          : req.body?.session_id
            ? String(req.body.session_id)
            : undefined,
        history: Array.isArray(req.body?.history) ? req.body.history : undefined,
        customer,
        authMode: org.portalAuthMode,
      });
      res.json(result);
    } catch (err) {
      console.error(err);
      const status = Number((err as { status?: number }).status || 500);
      const detail = String((err as Error).message || "").trim();
      res.status(status).json({
        error:
          status >= 500
            ? "Chat is temporarily unavailable."
            : detail || "Chat is temporarily unavailable.",
      });
    }
  });

  app.get("/api/internal/portal/kb", requirePortalInternal, async (req, res) => {
    try {
      const orgId = String(req.headers["x-coworker-org-id"] || "");
      const articles = await listPublishedHelpArticles({
        organizationId: orgId,
        q: String(req.query.q || ""),
        limit: Math.min(Math.max(Number(req.query.limit || 50), 1), 100),
        includeContent: true,
      });
      res.json({ articles });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load help articles.", articles: [] });
    }
  });

  app.get("/api/internal/portal/kb/:articleId", requirePortalInternal, async (req, res) => {
    try {
      const orgId = String(req.headers["x-coworker-org-id"] || "");
      const article = await getPublishedHelpArticle({
        organizationId: orgId,
        articleId: String(req.params.articleId || ""),
      });
      if (!article) return res.status(404).json({ error: "Article not found." });
      res.json({ article });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to load help article." });
    }
  });

  app.get("/api/internal/portal/tickets", requirePortalInternal, async (req, res) => {
    const orgId = String(req.headers["x-coworker-org-id"] || "");
    const customerId = String(req.headers["x-portal-customer-id"] || "");
    if (!customerId) return res.status(401).json({ error: "portal customer required" });
    const customer = await findActiveCustomer({ organizationId: orgId, customerId });
    if (!customer) return res.status(404).json({ error: "Customer not found." });
    const tickets = await listPortalTickets({
      id: customer.id,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      organizationId: customer.organizationId,
    });
    res.json(tickets);
  });

  app.post("/api/internal/portal/tickets", requirePortalInternal, async (req, res) => {
    const orgId = String(req.headers["x-coworker-org-id"] || "");
    const customerId = String(req.headers["x-portal-customer-id"] || "");
    if (!customerId) return res.status(401).json({ error: "portal customer required" });
    const customer = await findActiveCustomer({ organizationId: orgId, customerId });
    if (!customer) return res.status(404).json({ error: "Customer not found." });
    try {
      const created = await createPortalTicket(
        {
          id: customer.id,
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
          organizationId: customer.organizationId,
        },
        {
          subject: req.body?.subject,
          description: req.body?.description,
          issue: req.body?.issue,
          forceCreate: Boolean(req.body?.forceCreate || req.body?.force_create),
        }
      );
      res.status(201).json(created);
    } catch (err) {
      if (err && typeof err === "object" && (err as { deflected?: boolean }).deflected) {
        return res.status(409).json({
          deflected: true,
          agent: "dssa",
          reply: String((err as { reply?: string }).reply || (err as Error).message || ""),
          confidence: (err as { confidence?: number }).confidence,
        });
      }
      if (err instanceof TicketingProductError) {
        return res
          .status(err.status)
          .json({ error: err.message, code: err.code });
      }
      const status = Number((err as { status?: number }).status || 500);
      res.status(status).json({ error: (err as Error).message });
    }
  });
}

export async function adminCreateCustomer(input: {
  organizationId: string;
  slug: string;
  portalAuthMode: "password" | "otp";
  body: Record<string, unknown>;
}) {
  const created = await createDirectoryCustomer({
    organizationId: input.organizationId,
    name: String(input.body.name || ""),
    email: String(input.body.email || ""),
    phone: String(input.body.phone || ""),
    externalId: String(input.body.externalId || ""),
    accountName: String(input.body.accountName || ""),
    productCodes: Array.isArray(input.body.productCodes)
      ? (input.body.productCodes as unknown[]).map((p) => String(p))
      : String(input.body.products || "")
          .split(/[;,|]/)
          .map((s) => s.trim())
          .filter(Boolean),
  });
  return { customer: mapDirectoryCustomer(created), inviteSent: false };
}

export async function adminImportCustomers(input: {
  organizationId: string;
  slug: string;
  portalAuthMode: "password" | "otp";
  csvText?: string;
  filename?: string;
  contentBase64?: string;
}) {
  let buffer: Buffer | undefined;
  const b64 = String(input.contentBase64 || "").trim();
  if (b64) {
    const raw = b64.includes(",") ? b64.slice(b64.indexOf(",") + 1) : b64;
    buffer = Buffer.from(raw, "base64");
  }
  const rows = await parseCustomerImport({
    text: input.csvText,
    buffer,
    filename: input.filename,
  });
  if (!rows.length) {
    throw new CustomerDirectoryError("No customer rows found in the import file.");
  }
  const created: unknown[] = [];
  const errors: Array<{ row: number; error: string }> = [];
  for (let i = 0; i < rows.length; i++) {
    try {
      const row = rows[i];
      row.organizationId = input.organizationId;
      const customer = await createDirectoryCustomer(row);
      created.push(mapDirectoryCustomer(customer));
    } catch (err) {
      errors.push({
        row: i + 2,
        error: err instanceof Error ? err.message : "Failed",
      });
    }
  }
  return { created: created.length, customers: created, errors };
}

export { listDirectoryCustomers, CustomerDirectoryError };

function publicCustomer(c: { id: string; name: string; email: string; phone: string }) {
  return { id: c.id, name: c.name, email: c.email, phone: c.phone };
}

function requirePortalInternal(req: Request, res: Response, next: () => void) {
  const expected =
    process.env.COWORKER_TASKS_SECRET || "worktual-tasks-dev-secret";
  const key = String(req.headers["x-coworker-tasks-key"] || "").trim();
  const orgId = String(req.headers["x-coworker-org-id"] || "").trim();
  if (!key || key !== expected || !orgId) {
    return res.status(401).json({ error: "Invalid internal portal key" });
  }
  next();
}
