import type { Express, RequestHandler } from "express";
import type { AuthUser } from "../types";
import type { Request, Response } from "express";
import {
  createSdkSession,
  endSdkSession,
  meterSdkFeature,
  normalizeSdkLocale,
  refreshSdkSession,
  sdkRequestLocale,
  sdkUsageEvents,
  sdkUsageLogins,
  sdkPartnerOrganizationId,
  sdkUsageSummary,
  sendSdkError,
} from "./sdkPartner";
import { sdkErrorMessage, sdkWidgetEmbed } from "./sdkTasks";
import { decideSdkProposal, listSdkProposals } from "./sdkProposalStore";
import { createOrgWidget, listOrgWidgets, updateOrgWidget } from "./orgWidgets";
import { writeAuditEvent } from "./audit";

type AuthedRequest = Request & { user?: AuthUser };

export function registerSdkPartnerRoutes(app: Express, requireAuth: RequestHandler): void {
  app.post("/api/sdk/sessions", async (req, res) => {
    try {
      const actor = req.body?.actor;
      if (!actor || typeof actor !== "object") {
        return res.status(400).json({
          error: "actor.id or actor.email is required",
          code: "validation_error",
        });
      }
      const locale = normalizeSdkLocale(req.body?.locale);
      const created = await createSdkSession(req, {
        tenantId: req.body?.tenantId ? String(req.body.tenantId) : undefined,
        actor: {
          id: actor.id ? String(actor.id) : undefined,
          email: actor.email ? String(actor.email) : undefined,
        },
        locale,
      });
      res.status(201).json(created);
    } catch (err) {
      sendSdkError(res, err);
    }
  });

  app.post("/api/sdk/sessions/end", requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          error: sdkErrorMessage("auth_required", sdkRequestLocale(req)),
          code: "auth_required",
        });
      }
      res.json(await endSdkSession(req.user, sdkRequestLocale(req)));
    } catch (err) {
      sendSdkError(res, err);
    }
  });

  app.post("/api/sdk/sessions/refresh", requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          error: sdkErrorMessage("auth_required", sdkRequestLocale(req)),
          code: "auth_required",
        });
      }
      res.json(await refreshSdkSession(req.user, sdkRequestLocale(req)));
    } catch (err) {
      sendSdkError(res, err);
    }
  });

  app.get("/api/sdk/proposals", requireAuth, async (req: AuthedRequest, res: Response) => {
    try {
      if (!req.user) {
        return res.status(401).json({
          error: sdkErrorMessage("auth_required", sdkRequestLocale(req)),
          code: "auth_required",
        });
      }
      if (req.user.role === "customer") {
        return res.status(403).json({
          error: sdkErrorMessage("forbidden", sdkRequestLocale(req)),
          code: "forbidden",
        });
      }
      const items = await listSdkProposals(String(req.user.organizationId), {
        ticketNumber: req.query.ticketNumber ? String(req.query.ticketNumber) : undefined,
        status: req.query.status ? String(req.query.status) : undefined,
      });
      res.json({ items });
      void meterSdkFeature(req, "ai.proposals.list", true, 200);
    } catch (err) {
      sendSdkError(res, err);
    }
  });

  app.post("/api/sdk/proposals/:id/decide", requireAuth, async (req: AuthedRequest, res: Response) => {
    const decision = String(req.body?.decision || "").trim();
    const feature = decision === "reject" ? "ai.proposals.reject" : "ai.proposals.confirm";
    try {
      if (!req.user) {
        return res.status(401).json({
          error: sdkErrorMessage("auth_required", sdkRequestLocale(req)),
          code: "auth_required",
        });
      }
      if (!["admin", "agent", "resolver"].includes(String(req.user.role || ""))) {
        return res.status(403).json({
          error: sdkErrorMessage("forbidden", sdkRequestLocale(req)),
          code: "forbidden",
        });
      }
      const edits = req.body?.edits;
      const text =
        edits && typeof edits === "object" && edits.text != null ? String(edits.text) : undefined;
      const toolArgs =
        edits && typeof edits === "object" && edits.toolArgs && typeof edits.toolArgs === "object"
          ? (edits.toolArgs as Record<string, unknown>)
          : undefined;
      const result = await decideSdkProposal(req.user, String(req.params.id || ""), decision, {
        text,
        toolArgs,
      });
      res.json(result);
      void meterSdkFeature(req, feature, true, 200);
    } catch (err) {
      const status =
        err && typeof err === "object" && "status" in err ? Number((err as { status?: number }).status) : 500;
      void meterSdkFeature(req, feature, false, status);
      sendSdkError(res, err);
    }
  });

  app.get("/api/sdk/usage/summary", async (req, res) => {
    try {
      res.json(await sdkUsageSummary(req));
    } catch (err) {
      sendSdkError(res, err);
    }
  });

  app.get("/api/sdk/usage/logins", async (req, res) => {
    try {
      res.json(await sdkUsageLogins(req));
    } catch (err) {
      sendSdkError(res, err);
    }
  });

  app.get("/api/sdk/widgets", async (req, res) => {
    try {
      const tenantId = String(req.query.tenantId || req.query.tenant_id || "").trim();
      const organizationId = await sdkPartnerOrganizationId(req, tenantId || undefined);
      res.json({ widgets: await listOrgWidgets(organizationId) });
    } catch (err) {
      sendSdkError(res, err);
    }
  });

  app.post("/api/sdk/widgets", async (req, res) => {
    try {
      const tenantId = String(req.body?.tenantId || req.body?.tenant_id || "").trim();
      const organizationId = await sdkPartnerOrganizationId(req, tenantId || undefined);
      const originsRaw = req.body?.allowedOrigins ?? req.body?.allowed_origins ?? [];
      const origins = Array.isArray(originsRaw)
        ? originsRaw.map(String)
        : String(originsRaw || "")
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean);
      const widget = await createOrgWidget({
        organizationId,
        name: String(req.body?.name || "Help widget"),
        allowedOrigins: origins,
        buttonLabel: req.body?.buttonLabel || req.body?.button_label,
      });
      await writeAuditEvent({
        organizationId,
        actorName: "Partner SDK",
        action: "integration.widget_created",
        meta: { widgetId: widget.id, publicId: widget.publicId, source: "sdk" },
      });
      const host = `${req.protocol}://${req.get("host")}`;
      res.status(201).json({ widget, embed: sdkWidgetEmbed(host, widget.publicId) });
    } catch (err) {
      sendSdkError(res, err);
    }
  });

  app.patch("/api/sdk/widgets/:id", async (req, res) => {
    try {
      const tenantId = String(req.body?.tenantId || req.query.tenantId || "").trim();
      const organizationId = await sdkPartnerOrganizationId(req, tenantId || undefined);
      let origins: string[] | undefined;
      if (req.body?.allowedOrigins !== undefined || req.body?.allowed_origins !== undefined) {
        const raw = req.body?.allowedOrigins ?? req.body?.allowed_origins;
        origins = Array.isArray(raw)
          ? raw.map(String)
          : String(raw || "")
              .split(",")
              .map((item) => item.trim())
              .filter(Boolean);
      }
      const widget = await updateOrgWidget({
        organizationId,
        widgetId: String(req.params.id || ""),
        name: req.body?.name,
        buttonLabel: req.body?.buttonLabel || req.body?.button_label,
        enabled: req.body?.enabled,
        allowedOrigins: origins,
      });
      if (!widget) {
        return res.status(404).json({ error: "Widget not found", code: "not_found" });
      }
      const host = `${req.protocol}://${req.get("host")}`;
      res.json({ widget, embed: sdkWidgetEmbed(host, widget.publicId) });
    } catch (err) {
      sendSdkError(res, err);
    }
  });

  app.get("/api/sdk/usage/events", async (req, res) => {
    try {
      res.json(await sdkUsageEvents(req));
    } catch (err) {
      sendSdkError(res, err);
    }
  });
}
