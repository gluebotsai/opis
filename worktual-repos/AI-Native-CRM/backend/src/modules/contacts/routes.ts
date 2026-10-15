import type { FastifyPluginAsync } from "fastify";
import { CONTACT_LIST_PAGE_SIZE } from "@/lib/pagination";
import type { ContactInput } from "@/dao/contacts/contact-service";
import {
  convertLeadCommand,
  createActivityCommand,
  createContactCommand,
  deleteActivityCommand,
  deleteContactCommand,
  executeMergeCommand,
  exportContactsCommand,
  importContactsCommand,
  getContactImportSampleCommand,
  findDuplicatesCommand,
  getContactCommand,
  getContactFormOptionsCommand,
  getDuplicatesForContactCommand,
  listContactsCommand,
  listTaskFormOptionsCommand,
  previewMergeCommand,
  searchContactsForComposeCommand,
  searchMeetingParticipantsCommand,
  setContactPinnedCommand,
  updateContactCommand,
  updateTaskStatusCommand,
} from "@/service/contacts/contact-commands";
import { listContactsForSelect } from "@/dao/contacts/contact-service";
import { ForbiddenError } from "@/service/auth/require-role";
import {
  assertLeadSummaryAccess,
  draftNbaFollowUpCommand,
  getLeadSummaryCommand,
  setManualLeadScoreCommand,
} from "@/service/ai/lead-summary-commands";
import { subscribeLeadSummaryEvents } from "@/service/ai/lead-summary-events";
import {
  getLeadEnrichmentStatus,
  kickLeadEnrichmentIfActive,
  softCompleteLeadEnrichment,
} from "@/service/ai/lead-enrichment-job";
import {
  subscribeEnrichmentEvents,
  subscribeEnrichmentStepEvents,
  type EnrichmentEventPayload,
  type EnrichmentStepEventPayload,
} from "@/service/ai/lead-enrichment-events";
import { findEnrichmentJobByOrgContact } from "@/dao/ai/lead-enrichment-store";
import { listStepsForJob } from "@/dao/ai/agent-step-events";
import { getContact } from "@/dao/contacts/contact-service";
import { assertRecordAccess } from "@/service/auth/ownership-scope";
import { getCurrentOrganizationId } from "@/service/auth/require-role";
import { resolveSessionUserId, requireSessionOrApiKey, withUser, replyStaleCrmSession } from "../../middlewares/auth.js";
import { sendSuccess, sendError, sendResult } from "../../helpers/response.js";
import {
  getProspectPullCommand,
  importProspectPullCommand,
  startProspectPullCommand,
} from "@/service/contacts/prospect-pull-commands";
import { getCustomer360Command } from "@/service/contacts/customer-360";
import {
  acceptSalesFollowUpCommand,
  acceptSalesTaskCommand,
  applySalesDispositionCommand,
  getSalesGuideCommand,
  suggestSalesObjectionCommand,
} from "@/service/contacts/sales-guide";

type ActivityTypeBody =
  | "note"
  | "task"
  | "call"
  | "email"
  | "meeting"
  | "other";
type TaskStatusBody = "open" | "completed" | "cancelled";


export const contactsRoutes: FastifyPluginAsync = async (app) => {
  app.get<{
    Querystring: {
      page?: string;
      pageSize?: string;
      search?: string;
      contactType?: string;
      lifecycleStage?: string;
      stage?: string;
      leadStatus?: string;
      status?: string;
      location?: string;
      leadSource?: string;
      owner?: string;
      company?: string;
      email?: string;
      phone?: string;
      createdOn?: string;
    };
  }>("/", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "contacts");
    if (!userId) return;

    return withUser(userId, async () => {
      const page = Math.max(1, Number(request.query.page) || 1);
      const pageSize = Math.min(
        100,
        Math.max(1, Number(request.query.pageSize) || CONTACT_LIST_PAGE_SIZE),
      );
      const q = request.query;
      const contactType =
        q.contactType ?? q.lifecycleStage ?? q.stage;
      const result = await listContactsCommand({
        page,
        pageSize,
        search: q.search,
        contactType,
        leadStatus: q.leadStatus,
        status: q.status,
        location: q.location,
        leadSource: q.leadSource,
        owner: q.owner,
        company: q.company,
        email: q.email,
        phone: q.phone,
        createdOn: q.createdOn,
      });
      return sendSuccess(reply, result);
    });
  });

  app.get("/export", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "contacts");
    if (!userId) return;
    const q = request.query as Record<string, string | undefined>;
    return withUser(userId, async () => {
      const result = await exportContactsCommand({
        search: q.search,
        contactType: q.contactType ?? q.lifecycleStage ?? q.stage,
        leadStatus: q.leadStatus,
        status: q.status,
        location: q.location,
        leadSource: q.leadSource,
        owner: q.owner,
        company: q.company,
        email: q.email,
        phone: q.phone,
        createdOn: q.createdOn,
        format: q.format,
      });
      return sendResult(reply, result);
    });
  });

  app.post<{ Body: { csvText?: string; dryRun?: boolean } }>(
    "/import",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "contacts");
      if (!userId) return;
      return withUser(userId, async () => {
        const csvText = request.body?.csvText ?? "";
        if (!csvText.trim()) {
          return sendError(reply, "csvText is required.", 400);
        }
        const result = await importContactsCommand({
          csvText,
          dryRun: request.body?.dryRun,
        });
        return sendResult(reply, result);
      });
    },
  );

  app.get("/import/sample", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "contacts");
    if (!userId) return;
    return withUser(userId, async () => {
      try {
        const result = await getContactImportSampleCommand();
        if (!result.ok) {
          return sendError(reply, result.error, 403);
        }
        return reply
          .header("Content-Type", "text/csv; charset=utf-8")
          .header(
            "Content-Disposition",
            `attachment; filename="${result.filename}"`,
          )
          .send(result.content);
      } catch (err) {
        return sendError(
          reply,
          err instanceof Error ? err.message : "Failed to load sample.",
          500,
        );
      }
    });
  });

  app.post<{
    Body: {
      limit?: number;
      sources?: string[];
      criteria?: Record<string, unknown>;
    };
  }>("/prospect-pull", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "contacts");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await startProspectPullCommand({
        limit: request.body?.limit,
        sources: request.body?.sources,
        criteria: (request.body?.criteria ?? {}) as import("@/dao/ai/prospect-pull-store").ProspectCriteria,
      });
      return sendResult(reply, result);
    });
  });

  app.get<{ Params: { jobId: string } }>(
    "/prospect-pull/:jobId",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "contacts");
      if (!userId) return;
      return withUser(userId, async () => {
        const result = await getProspectPullCommand(request.params.jobId);
        return sendResult(reply, result);
      });
    },
  );

  app.post<{
    Params: { jobId: string };
    Body: { selectedIds?: string[] };
  }>("/prospect-pull/:jobId/import", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "contacts");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await importProspectPullCommand({
        jobId: request.params.jobId,
        selectedIds: request.body?.selectedIds,
      });
      return sendResult(reply, result);
    });
  });

  app.get("/form-options", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "contacts");
    if (!userId) return;
    return withUser(userId, async () => {
      try {
        const result = await getContactFormOptionsCommand();
        return sendResult(reply, result);
      } catch (err) {
        if (err instanceof ForbiddenError) {
          return sendError(reply, err.message, 403);
        }
        throw err;
      }
    });
  });

  app.get<{ Querystring: { q?: string } }>(
    "/search-compose",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "contacts");
      if (!userId) return;
      return withUser(userId, async () => {
        const items = await searchContactsForComposeCommand(request.query.q);
        return sendSuccess(reply, { items });
      });
    },
  );

  app.get<{ Querystring: { q?: string } }>(
    "/search-meeting-participants",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "contacts");
      if (!userId) return;
      return withUser(userId, async () => {
        const items = await searchMeetingParticipantsCommand(request.query.q);
        return sendSuccess(reply, { items });
      });
    },
  );

  app.get("/task-options", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "contacts");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await listTaskFormOptionsCommand();
      return sendSuccess(reply, result);
    });
  });

  app.get<{ Querystring: { companyId?: string; limit?: string } }>(
    "/select",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "contacts");
      if (!userId) return;
      return withUser(userId, async () => {
        const items = await listContactsForSelect({
          companyId: request.query.companyId,
          limit: request.query.limit
            ? Number(request.query.limit)
            : undefined,
        });
        return sendSuccess(reply, { items });
      });
    },
  );

  app.post<{ Body: ContactInput }>("/", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "contacts");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await createContactCommand(request.body ?? ({} as ContactInput));
      return sendResult(reply, result);
    });
  });

  app.post<{ Body: Record<string, unknown> }>("/duplicates/find", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "contacts");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await findDuplicatesCommand(
        (request.body ?? {}) as Parameters<typeof findDuplicatesCommand>[0],
      );
      return sendResult(reply, result);
    });
  });

  app.post<{ Body: { contactIds?: string[] } }>("/merge/preview", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "contacts");
    if (!userId) return;
    return withUser(userId, async () => {
      const ids = request.body?.contactIds ?? [];
      const result = await previewMergeCommand(ids);
      return sendResult(reply, result);
    });
  });

  app.post<{
    Body: {
      primaryContactId?: string;
      duplicateContactIds?: string[];
      fieldSources?: Record<string, string>;
    };
  }>("/merge/execute", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "contacts");
    if (!userId) return;
    return withUser(userId, async () => {
      const body = request.body ?? {};
      if (!body.primaryContactId) {
        return sendError(reply, "primaryContactId is required.", 400);
      }
      const result = await executeMergeCommand({
        primaryContactId: body.primaryContactId,
        duplicateContactIds: body.duplicateContactIds ?? [],
        fieldSources: body.fieldSources ?? {},
      });
      return sendResult(reply, result);
    });
  });

  app.get<{ Params: { id: string } }>("/:id/sales-guide", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "contacts");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await getSalesGuideCommand(request.params.id);
      if (!result.ok) return sendError(reply, result.error, result.status);
      return sendResult(reply, result);
    });
  });

  app.post<{ Params: { id: string }; Body: { status?: string; reason?: string } }>(
    "/:id/sales-guide/disposition",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "contacts");
      if (!userId) return;
      return withUser(userId, async () => {
        const result = await applySalesDispositionCommand(
          request.params.id,
          request.body?.status ?? "",
          request.body?.reason,
        );
        if (!result.ok) return sendError(reply, result.error, result.status);
        return sendResult(reply, result);
      });
    },
  );

  app.post<{
    Params: { id: string };
    Body: { title?: string; detail?: string; dueInDays?: number };
  }>("/:id/sales-guide/task", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "contacts");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await acceptSalesTaskCommand(request.params.id, request.body ?? {});
      if (!result.ok) return sendError(reply, result.error, result.status);
      return sendResult(reply, result);
    });
  });

  app.post<{
    Params: { id: string };
    Body: { channel?: string; subject?: string; message?: string; dueInDays?: number };
  }>("/:id/sales-guide/follow-up", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "contacts");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await acceptSalesFollowUpCommand(request.params.id, request.body ?? {});
      if (!result.ok) return sendError(reply, result.error, result.status);
      return sendResult(reply, result);
    });
  });

  app.post<{ Params: { id: string }; Body: { objection?: string } }>(
    "/:id/sales-guide/objection",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "contacts");
      if (!userId) return;
      return withUser(userId, async () => {
        const result = await suggestSalesObjectionCommand(
          request.params.id,
          request.body?.objection ?? "",
        );
        if (!result.ok) return sendError(reply, result.error, result.status);
        return sendResult(reply, result);
      });
    },
  );

  app.get<{ Params: { id: string } }>("/:id/customer-360", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "contacts");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await getCustomer360Command(request.params.id);
      if (!result.ok) {
        return sendError(reply, result.error, result.status);
      }
      return sendResult(reply, result);
    });
  });

  app.get<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "contacts");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await getContactCommand(request.params.id);
      if (!result.ok) {
        return sendError(reply, result.error, result.status);
      }
      return sendResult(reply, result);
    });
  });

  app.get<{ Params: { id: string } }>("/:id/form-options", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "contacts");
    if (!userId) return;
    return withUser(userId, async () => {
      try {
        const result = await getContactFormOptionsCommand(request.params.id);
        return sendResult(reply, result);
      } catch (err) {
        if (err instanceof ForbiddenError) {
          return sendError(reply, err.message, 403);
        }
        throw err;
      }
    });
  });

  app.get<{ Params: { id: string } }>("/:id/duplicates", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "contacts");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await getDuplicatesForContactCommand(request.params.id);
      return sendResult(reply, result);
    });
  });

  app.post<{ Params: { id: string } }>("/:id/hygiene", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "contacts");
    if (!userId) return;
    return withUser(userId, async () => {
      const { runHygieneSuggestCommand } = await import(
        "@/service/ai/hygiene-job"
      );
      const result = await runHygieneSuggestCommand(request.params.id);
      return sendResult(reply, result);
    });
  });

  app.get<{ Params: { id: string }; Querystring: { force?: string } }>(
    "/:id/summary",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "contacts");
      if (!userId) return;
      return withUser(userId, async () => {
        const force =
          request.query.force === "1" || request.query.force === "true";
        const result = await getLeadSummaryCommand(request.params.id, { force });
        return sendResult(reply, result);
      });
    },
  );

  app.post<{ Params: { id: string } }>(
    "/:id/summary/refresh",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "contacts");
      if (!userId) return;
      return withUser(userId, async () => {
        const result = await getLeadSummaryCommand(request.params.id, {
          force: true,
        });
        return sendResult(reply, result);
      });
    },
  );

  app.post<{
    Params: { id: string };
    Body: { nextBestAction?: string };
  }>("/:id/follow-up-draft", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "contacts");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await draftNbaFollowUpCommand(
        request.params.id,
        request.body?.nextBestAction,
      );
      return sendResult(reply, result);
    });
  });

  app.post<{
    Params: { id: string };
    Body: { score?: number; reason?: string };
  }>("/:id/lead-score", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "contacts");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await setManualLeadScoreCommand(request.params.id, {
        score: Number(request.body?.score),
        reason:
          typeof request.body?.reason === "string" ? request.body.reason : "",
      });
      return sendResult(reply, result);
    });
  });

  /**
   * Pushes a "summary" event whenever the lead's timeline changes so the
   * autonomous summary panel can refetch — mirrors the Next SSE route in
   * src/app/api/contacts/[contactId]/summary/events/route.ts.
   */
  app.get<{ Params: { id: string } }>(
    "/:id/summary/events",
    async (request, reply) => {
      const userId = await resolveSessionUserId(request);
      if (!userId) {
        if (request.crmStaleAuthSession) return replyStaleCrmSession(reply);
        return sendError(reply, "Not signed in.", 401);
      }
      const contactId = request.params.id;
      const access = await withUser(userId, () =>
        assertLeadSummaryAccess(contactId),
      );
      if (!access.ok) {
        return sendError(reply, access.error, access.status);
      }

      const HEARTBEAT_MS = 25_000;
      const MAX_WAIT_MS = 10 * 60_000;

      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      });
      reply.hijack();

      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        } catch {
          closed = true;
        }
      };

      const close = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        clearTimeout(deadline);
        unsub();
        try {
          reply.raw.end();
        } catch {
          /* already closed */
        }
      };

      send("ready", { contactId });

      const unsub = subscribeLeadSummaryEvents(contactId, (payload) => {
        send("summary", { contactId, reason: payload.reason ?? null });
      });

      const heartbeat = setInterval(() => send("ping", Date.now()), HEARTBEAT_MS);
      const deadline = setTimeout(close, MAX_WAIT_MS);
      request.raw.on("close", close);
    },
  );

  /**
   * Live enrichment status for the contact detail badge — mirrors
   * src/app/api/contacts/[contactId]/enrichment/events/route.ts.
   */
  app.get<{ Params: { id: string } }>(
    "/:id/enrichment/events",
    async (request, reply) => {
      const userId = await resolveSessionUserId(request);
      if (!userId) {
        if (request.crmStaleAuthSession) return replyStaleCrmSession(reply);
        return sendError(reply, "Not signed in.", 401);
      }
      const contactId = request.params.id;

      const access = await withUser(userId, async () => {
        const contact = await getContact(contactId);
        if (!contact) return { ok: false as const, status: 404 as const, error: "Not found" };
        try {
          await assertRecordAccess(contact.crm.ownerUserId);
          return { ok: true as const };
        } catch (err) {
          if (err instanceof ForbiddenError) {
            return { ok: false as const, status: 403 as const, error: "Forbidden" };
          }
          throw err;
        }
      });
      if (!access.ok) {
        return sendError(reply, access.error, access.status);
      }

      const TERMINAL = new Set(["enriched", "skipped", "failed"]);
      const MAX_WAIT_MS = 28_000;
      const POLL_MS = 1_500;

      reply.raw.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      });
      reply.hijack();

      let closed = false;
      let unsub: (() => void) | null = null;
      let unsubSteps: (() => void) | null = null;
      let pollTimer: ReturnType<typeof setInterval> | null = null;
      let deadlineTimer: ReturnType<typeof setTimeout> | null = null;

      const send = (event: string, data: unknown) => {
        if (closed) return;
        try {
          reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        } catch {
          closed = true;
        }
      };

      const close = () => {
        if (closed) return;
        closed = true;
        if (pollTimer) clearInterval(pollTimer);
        if (deadlineTimer) clearTimeout(deadlineTimer);
        unsub?.();
        unsubSteps?.();
        try {
          reply.raw.end();
        } catch {
          /* already closed */
        }
      };

      const pushTerminal = (payload: EnrichmentEventPayload) => {
        send("enrichment", payload);
        close();
      };

      const toPayload = (
        status: string,
        lastError: string | null,
        resultSummary: unknown,
      ): EnrichmentEventPayload => ({
        contactId,
        status,
        filled: (resultSummary as { filled?: string[] } | null)?.filled,
        lastError,
        resultSummary,
      });

      unsub = subscribeEnrichmentEvents(contactId, (payload) => {
        if (TERMINAL.has(payload.status)) {
          pushTerminal(payload);
        } else {
          send("enrichment", payload);
        }
      });

      unsubSteps = subscribeEnrichmentStepEvents(
        contactId,
        (payload: EnrichmentStepEventPayload) => {
          send("step", payload);
        },
      );

      void (async () => {
        const initial = await getLeadEnrichmentStatus(contactId);
        if (!initial || initial.status === "none") {
          send("enrichment", {
            contactId,
            status: "none",
            lastError: null,
            resultSummary: null,
          });
          close();
          return;
        }

        // Catch up on steps already recorded before this connection opened
        // (e.g. page refresh mid-run, or a run that already finished).
        try {
          const organizationId = await getCurrentOrganizationId();
          const job = await findEnrichmentJobByOrgContact(organizationId, contactId);
          if (job) {
            const steps = await listStepsForJob(job.id);
            for (const step of steps) {
              send("step", {
                contactId,
                jobId: job.id,
                step: step.step,
                label: step.label,
                status: step.status,
                detail: step.detail,
                errorReason: step.errorReason,
              } satisfies EnrichmentStepEventPayload);
            }
          }
        } catch {
          /* best-effort catch-up only */
        }

        if (TERMINAL.has(initial.status)) {
          pushTerminal(
            toPayload(initial.status, initial.lastError, initial.resultSummary),
          );
          return;
        }

        send("enrichment", {
          contactId,
          status: initial.status,
          lastError: initial.lastError ?? null,
          resultSummary: initial.resultSummary ?? null,
        });

        void kickLeadEnrichmentIfActive(contactId);

        let kickedMidWait = false;
        pollTimer = setInterval(() => {
          void (async () => {
            if (closed) return;
            const cur = await getLeadEnrichmentStatus(contactId);
            if (!cur || cur.status === "none") return;
            if (TERMINAL.has(cur.status)) {
              pushTerminal(
                toPayload(cur.status, cur.lastError, cur.resultSummary),
              );
              return;
            }
            if (!kickedMidWait && cur.status === "pending") {
              kickedMidWait = true;
              void kickLeadEnrichmentIfActive(contactId);
            }
          })();
        }, POLL_MS);

        deadlineTimer = setTimeout(() => {
          void (async () => {
            if (closed) return;
            const cur = await getLeadEnrichmentStatus(contactId);
            if (cur && TERMINAL.has(cur.status)) {
              pushTerminal(
                toPayload(cur.status, cur.lastError, cur.resultSummary),
              );
              return;
            }
            const soft = await softCompleteLeadEnrichment(contactId, "wait_budget");
            if (soft) {
              pushTerminal(
                toPayload(soft.status, soft.lastError, soft.resultSummary),
              );
              return;
            }
            pushTerminal({
              contactId,
              status: "skipped",
              lastError: null,
              resultSummary: { reason: "wait_budget" },
            });
          })();
        }, MAX_WAIT_MS);
      })();

      request.raw.on("close", close);
    },
  );

  /** Curated step trace for the latest enrichment run — on-demand fetch (no SSE). */
  app.get<{ Params: { id: string } }>(
    "/:id/enrichment/steps",
    async (request, reply) => {
      const userId = await resolveSessionUserId(request);
      if (!userId) {
        if (request.crmStaleAuthSession) return replyStaleCrmSession(reply);
        return sendError(reply, "Not signed in.", 401);
      }
      const contactId = request.params.id;

      return withUser(userId, async () => {
        const contact = await getContact(contactId);
        if (!contact) return sendError(reply, "Not found.", 404);
        try {
          await assertRecordAccess(contact.crm.ownerUserId);
        } catch (err) {
          if (err instanceof ForbiddenError) {
            return sendError(reply, "Forbidden", 403);
          }
          throw err;
        }

        const organizationId = await getCurrentOrganizationId();
        const job = await findEnrichmentJobByOrgContact(organizationId, contactId);
        if (!job) return sendSuccess(reply, { steps: [] });
        const steps = await listStepsForJob(job.id);
        return sendSuccess(reply, {
          jobId: job.id,
          steps: steps.map((s) => ({
            step: s.step,
            label: s.label,
            status: s.status,
            detail: s.detail,
            errorReason: s.errorReason,
            startedAt: s.startedAt.toISOString(),
            endedAt: s.endedAt ? s.endedAt.toISOString() : null,
          })),
        });
      });
    },
  );

  /** Manual ZoomInfo enrich (gateway; 1 data credit). */
  app.post<{ Params: { id: string }; Body?: { personId?: string } }>(
    "/:id/enrichment/zoominfo",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "contacts");
      if (!userId) return;
      return withUser(userId, async () => {
        const contactId = request.params.id;
        const contact = await getContact(contactId);
        if (!contact) return sendError(reply, "Not found.", 404);
        try {
          await assertRecordAccess(contact.crm.ownerUserId);
        } catch (err) {
          if (err instanceof ForbiddenError) {
            return sendError(reply, "Forbidden", 403);
          }
          throw err;
        }
        const organizationId = await getCurrentOrganizationId();
        const { enrichContactViaZoominfo } = await import(
          "@/service/zoominfo/zoominfo-enrich"
        );
        const result = await enrichContactViaZoominfo({
          organizationId,
          contactId,
          personId: request.body?.personId ?? null,
          actorUserId: userId,
        });
        if (!result.ok) {
          const status = result.skipped ? 409 : 400;
          return sendError(reply, result.reason || "ZoomInfo enrich failed.", status);
        }
        return sendSuccess(reply, result);
      });
    },
  );

  app.patch<{ Params: { id: string }; Body: ContactInput }>(
    "/:id",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "contacts");
      if (!userId) return;
      return withUser(userId, async () => {
        const result = await updateContactCommand(
          request.params.id,
          request.body ?? ({} as ContactInput),
        );
        return sendResult(reply, result);
      });
    },
  );

  app.delete<{ Params: { id: string } }>("/:id", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "contacts");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await deleteContactCommand(request.params.id);
      return sendResult(reply, result);
    });
  });

  app.post<{ Params: { id: string }; Body: { isPinned?: boolean } }>(
    "/:id/pin",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "contacts");
      if (!userId) return;
      return withUser(userId, async () => {
        const result = await setContactPinnedCommand(
          request.params.id,
          Boolean(request.body?.isPinned),
        );
        return sendResult(reply, result);
      });
    },
  );

  app.post<{
    Params: { id: string };
    Body: { dealTitle?: string; amount?: number | null };
  }>("/:id/convert", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "contacts");
    if (!userId) return;
    return withUser(userId, async () => {
      const result = await convertLeadCommand(request.params.id, request.body);
      return sendResult(reply, result);
    });
  });

  app.post<{
    Params: { id: string };
    Body: {
      type?: ActivityTypeBody;
      subject?: string;
      body?: string | null;
      dueAt?: string | null;
      assigneeUserId?: string | null;
      folder?: "inbox" | "sent" | "draft" | "trash";
      threadId?: string | null;
      gmailMessageId?: string | null;
      gmailThreadId?: string | null;
      rfcMessageId?: string | null;
      emailDirection?: "outbound" | "inbound" | null;
    };
  }>("/:id/activities", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "contacts");
    if (!userId) return;
    return withUser(userId, async () => {
      const body = request.body ?? {};
      if (!body.type || !body.subject) {
        return sendError(reply, "type and subject are required.", 400);
      }
      const result = await createActivityCommand(request.params.id, {
        type: body.type,
        subject: body.subject,
        body: body.body,
        dueAt: body.dueAt,
        assigneeUserId: body.assigneeUserId,
        folder: body.folder,
        threadId: body.threadId,
        gmailMessageId: body.gmailMessageId,
        gmailThreadId: body.gmailThreadId,
        rfcMessageId: body.rfcMessageId,
        emailDirection: body.emailDirection,
      });
      return sendResult(reply, result);
    });
  });

  app.patch<{
    Params: { activityId: string };
    Body: { taskStatus?: TaskStatusBody };
  }>("/activities/:activityId/status", async (request, reply) => {
    const userId = await requireSessionOrApiKey(request, reply, "contacts");
    if (!userId) return;
    return withUser(userId, async () => {
      if (!request.body?.taskStatus) {
        return sendError(reply, "taskStatus is required.", 400);
      }
      const result = await updateTaskStatusCommand(
        request.params.activityId,
        request.body.taskStatus,
      );
      return sendResult(reply, result);
    });
  });

  app.delete<{ Params: { id: string; activityId: string } }>(
    "/:id/activities/:activityId",
    async (request, reply) => {
      const userId = await requireSessionOrApiKey(request, reply, "contacts");
      if (!userId) return;
      return withUser(userId, async () => {
        const result = await deleteActivityCommand(
          request.params.id,
          request.params.activityId,
        );
        return sendResult(reply, result);
      });
    },
  );
};
