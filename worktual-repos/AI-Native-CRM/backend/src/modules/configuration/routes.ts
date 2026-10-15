import type { FastifyPluginAsync } from "fastify";
import {
  disconnectGoogleEmailCommand,
  disconnectMicrosoftEmailCommand,
  getAssignmentSettingsCommand,
  getEmailIntegrationsCommand,
  getFinanceBillingSettingsCommand,
  getInternalDomainsSettingsCommand,
  getLeadNurtureSettingsCommand,
  getResearchProvidersCommand,
  listAssignmentRepsCommand,
  patchAssignmentSettingsCommand,
  patchFinanceBillingSettingsCommand,
  patchInternalDomainsSettingsCommand,
  patchLeadNurtureSettingsCommand,
  patchResearchIcpCommand,
  patchResearchProviderCommand,
  setPreferredSendProviderCommand,
  upsertAssignmentRepCommand,
} from "@/service/configuration/configuration-commands";
import {
  createTenantApiKeyCommand,
  listTenantApiKeysCommand,
  revokeTenantApiKeyCommand,
} from "@/service/configuration/api-key-commands";
import {
  clearPreferredSendProviderCookie,
  setPreferredSendProviderCookie,
} from "@/service/oauth/oauth-send-cookie";
import {
  createProposalCorpusBatchCommand,
  deleteProposalCorpusBatchCommand,
  getProposalCorpusBatchCommand,
  getProposalPlaybookCommand,
  listProposalCorpusBatchesCommand,
  listProposalPlaybooksCommand,
  processProposalCorpusBatchCommand,
  resetProposalPatternsCommand,
  reviewProposalPlaybookCommand,
  scoreProposalCorpusPairCommand,
} from "@/service/sales/proposal-corpus-commands";
import { requireSession, withUser } from "../../middlewares/auth.js";
import { sendSuccess, sendError, sendResult } from "../../helpers/response.js";

export const configurationRoutes: FastifyPluginAsync = async (app) => {
  app.get("/email", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const result = await getEmailIntegrationsCommand();
        if (result.preferredCookieToSet) {
          setPreferredSendProviderCookie(reply, result.preferredCookieToSet);
        }
        return sendSuccess(reply, { status: result.status });
      },
      request,
    );
  });

  app.post("/email/disconnect/google", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const result = await disconnectGoogleEmailCommand();
        if (result.ok && result.clearPreferredCookie) {
          clearPreferredSendProviderCookie(reply);
        }
        return sendResult(reply, result);
      },
      request,
    );
  });

  app.post("/email/disconnect/microsoft", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const result = await disconnectMicrosoftEmailCommand();
        if (result.ok && result.clearPreferredCookie) {
          clearPreferredSendProviderCookie(reply);
        }
        return sendResult(reply, result);
      },
      request,
    );
  });

  app.post<{ Body: { provider?: string } }>(
    "/email/preferred",
    async (request, reply) => {
      const userId = await requireSession(request, reply);
      if (!userId) return;
      return withUser(
        userId,
        async () => {
          const provider = request.body?.provider;
          if (provider !== "google" && provider !== "microsoft") {
            return sendError(reply, "provider must be google or microsoft.", 400);
          }
          const result = await setPreferredSendProviderCommand(provider);
          if (!result.ok) return sendResult(reply, result, 400);
          setPreferredSendProviderCookie(reply, provider);
          return sendSuccess(reply, null);
        },
        request,
      );
    },
  );

  app.get("/assignment", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const result = await getAssignmentSettingsCommand();
        return sendResult(reply, result);
      },
      request,
    );
  });

  app.patch<{
    Body: {
      seniorAmountThreshold?: number;
      leadIcp?: {
        targetIndustries?: string[];
        adjacentIndustries?: string[];
        sizeTiers?: string[];
        serviceableGeos?: string[];
      } | null;
      followupPolicy?: {
        hot?: {
          remindMinutes?: number;
          managerMinutes?: number;
          adminMinutes?: number;
        };
        warm?: {
          remindMinutes?: number;
          managerMinutes?: number;
          adminMinutes?: number;
        };
      } | null;
    };
  }>("/assignment", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const result = await patchAssignmentSettingsCommand({
          seniorAmountThreshold: request.body?.seniorAmountThreshold,
          leadIcp: request.body?.leadIcp,
          followupPolicy: request.body?.followupPolicy,
        });
        return sendResult(reply, result);
      },
      request,
    );
  });

  app.get("/nurture", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const result = await getLeadNurtureSettingsCommand();
        if (!result.ok) return sendError(reply, result.error, 403);
        return sendSuccess(reply, { settings: result.settings });
      },
      request,
    );
  });

  app.patch<{
    Body: {
      nurtureCallEnabled?: boolean;
      nurtureCallDelayMinutes?: number;
    };
  }>("/nurture", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const result = await patchLeadNurtureSettingsCommand(request.body ?? {});
        if (!result.ok) return sendError(reply, result.error, 403);
        return sendSuccess(reply, { settings: result.settings });
      },
      request,
    );
  });

  app.get("/research", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const result = await getResearchProvidersCommand();
        return sendResult(reply, result);
      },
      request,
    );
  });

  app.patch<{
    Body: {
      provider?: string;
      enabled?: boolean;
      apiKey?: string | null;
      clearApiKey?: boolean;
      settings?: Record<string, unknown> | null;
    };
  }>("/research/providers", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const result = await patchResearchProviderCommand(request.body ?? {});
        return sendResult(reply, result);
      },
      request,
    );
  });

  app.patch<{
    Body: {
      leadIcp?: {
        targetIndustries?: string[];
        adjacentIndustries?: string[];
        sizeTiers?: string[];
        serviceableGeos?: string[];
      } | null;
      competitorStacks?: string[];
    };
  }>("/research/icp", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const result = await patchResearchIcpCommand(request.body ?? {});
        return sendResult(reply, result);
      },
      request,
    );
  });

  app.get("/assignment/reps", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const result = await listAssignmentRepsCommand();
        return sendResult(reply, result);
      },
      request,
    );
  });

  app.put<{
    Params: { userId: string };
    Body: {
      acceptingLeads?: boolean;
      maxOpenDeals?: number | null;
      seniorityTier?: "junior" | "mid" | "senior" | null;
      onPtoUntil?: string | null;
      country?: string | null;
    };
  }>("/assignment/reps/:userId", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const result = await upsertAssignmentRepCommand(
          request.params.userId,
          request.body ?? {},
        );
        return sendResult(reply, result);
      },
      request,
    );
  });

  app.get("/billing", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const result = await getFinanceBillingSettingsCommand();
        if (!result.ok) return sendError(reply, result.error, 403);
        return sendSuccess(reply, {
          settings: result.settings,
          webhookUrls: result.webhookUrls,
        });
      },
      request,
    );
  });

  app.patch<{ Body: Record<string, unknown> }>(
    "/billing",
    async (request, reply) => {
      const userId = await requireSession(request, reply);
      if (!userId) return;
      return withUser(
        userId,
        async () => {
          const body = request.body ?? {};
          const result = await patchFinanceBillingSettingsCommand({
            defaultPaymentTerms:
              typeof body.defaultPaymentTerms === "string"
                ? body.defaultPaymentTerms
                : undefined,
            zeroAmountAutoPaid:
              typeof body.zeroAmountAutoPaid === "boolean"
                ? body.zeroAmountAutoPaid
                : undefined,
            offlineReferenceMinLen:
              typeof body.offlineReferenceMinLen === "number"
                ? body.offlineReferenceMinLen
                : undefined,
            duplicateInvoiceGuard:
              typeof body.duplicateInvoiceGuard === "boolean"
                ? body.duplicateInvoiceGuard
                : undefined,
            onlinePaymentsEnabled:
              typeof body.onlinePaymentsEnabled === "boolean"
                ? body.onlinePaymentsEnabled
                : undefined,
            paymentRoutingRules:
              body.paymentRoutingRules === null ||
              typeof body.paymentRoutingRules === "object"
                ? (body.paymentRoutingRules as never)
                : undefined,
            bankDetails:
              body.bankDetails === null ||
              (typeof body.bankDetails === "object" &&
                !Array.isArray(body.bankDetails)) ||
              typeof body.bankDetails === "string"
                ? (body.bankDetails as never)
                : undefined,
            stripePublishableKey:
              typeof body.stripePublishableKey === "string"
                ? body.stripePublishableKey
                : body.stripePublishableKey === null
                  ? null
                  : undefined,
            stripeSecretKey:
              typeof body.stripeSecretKey === "string"
                ? body.stripeSecretKey
                : undefined,
            stripeWebhookSecret:
              typeof body.stripeWebhookSecret === "string"
                ? body.stripeWebhookSecret
                : undefined,
            razorpayKeyId:
              typeof body.razorpayKeyId === "string"
                ? body.razorpayKeyId
                : body.razorpayKeyId === null
                  ? null
                  : undefined,
            razorpayKeySecret:
              typeof body.razorpayKeySecret === "string"
                ? body.razorpayKeySecret
                : undefined,
            razorpayWebhookSecret:
              typeof body.razorpayWebhookSecret === "string"
                ? body.razorpayWebhookSecret
                : undefined,
          });
          if (!result.ok) return sendError(reply, result.error, 400);
          return sendSuccess(reply, {
            settings: result.settings,
            webhookUrls: result.webhookUrls,
          });
        },
        request,
      );
    },
  );

  /**
   * Internal-domains resolver (foundation for future Internal Meeting
   * Assist routing). Auto-derived from setup_users work emails; admin can
   * enter a manual list when derivation yields nothing, or add specific
   * email overrides for the alias/personal-email edge case.
   */
  app.get("/internal-domains", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const result = await getInternalDomainsSettingsCommand();
        if (!result.ok) return sendError(reply, result.error, 403);
        return sendSuccess(reply, {
          state: result.state,
          canManage: result.canManage,
        });
      },
      request,
    );
  });

  app.patch<{
    Body: { domains?: string[]; overrideEmails?: string[] };
  }>("/internal-domains", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const body = request.body ?? {};
        const result = await patchInternalDomainsSettingsCommand({
          domains: Array.isArray(body.domains)
            ? body.domains.filter((d): d is string => typeof d === "string")
            : undefined,
          overrideEmails: Array.isArray(body.overrideEmails)
            ? body.overrideEmails.filter(
                (e): e is string => typeof e === "string",
              )
            : undefined,
        });
        if (!result.ok) return sendError(reply, result.error, 400);
        return sendSuccess(reply, { state: result.state });
      },
      request,
    );
  });

  app.get("/api-keys", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const result = await listTenantApiKeysCommand();
        if (!result.ok) {
          return sendError(reply, result.error, result.status ?? 400);
        }
        return sendSuccess(reply, { items: result.items });
      },
      request,
    );
  });

  app.post<{ Body: { name?: string; scopes?: string[] } }>(
    "/api-keys",
    async (request, reply) => {
      const userId = await requireSession(request, reply);
      if (!userId) return;
      return withUser(
        userId,
        async () => {
          const result = await createTenantApiKeyCommand(request.body ?? {});
          if (!result.ok) {
            return sendError(reply, result.error, result.status ?? 400);
          }
          return sendSuccess(
            reply,
            { secret: result.secret, key: result.key },
            "API key created. Copy the secret now — it will not be shown again.",
            201,
          );
        },
        request,
      );
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api-keys/:id",
    async (request, reply) => {
      const userId = await requireSession(request, reply);
      if (!userId) return;
      return withUser(
        userId,
        async () => {
          const result = await revokeTenantApiKeyCommand(request.params.id);
          if (!result.ok) {
            return sendError(reply, result.error, result.status ?? 400);
          }
          return sendSuccess(reply, { id: result.id }, "API key revoked.");
        },
        request,
      );
    },
  );

  app.get("/proposal-patterns/batches", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const result = await listProposalCorpusBatchesCommand();
        return sendResult(reply, result);
      },
      request,
    );
  });

  app.get<{ Params: { id: string } }>(
    "/proposal-patterns/batches/:id",
    async (request, reply) => {
      const userId = await requireSession(request, reply);
      if (!userId) return;
      return withUser(
        userId,
        async () => {
          const result = await getProposalCorpusBatchCommand(request.params.id);
          return sendResult(reply, result);
        },
        request,
      );
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/proposal-patterns/batches/:id",
    async (request, reply) => {
      const userId = await requireSession(request, reply);
      if (!userId) return;
      return withUser(
        userId,
        async () => {
          const result = await deleteProposalCorpusBatchCommand(
            request.params.id,
          );
          return sendResult(reply, result);
        },
        request,
      );
    },
  );

  app.delete("/proposal-patterns", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const result = await resetProposalPatternsCommand();
        return sendResult(reply, result);
      },
      request,
    );
  });

  app.post<{
    Body: {
      requirement?: {
        filename?: string;
        contentBase64?: string;
        mime?: string | null;
      };
      proposal?: {
        filename?: string;
        contentBase64?: string;
        mime?: string | null;
      };
    };
  }>("/proposal-patterns/pair-score", { bodyLimit: 20 * 1024 * 1024 }, async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const body = request.body ?? {};
        const requirement = body.requirement;
        const proposal = body.proposal;
        if (
          !requirement ||
          typeof requirement.filename !== "string" ||
          typeof requirement.contentBase64 !== "string" ||
          !proposal ||
          typeof proposal.filename !== "string" ||
          typeof proposal.contentBase64 !== "string"
        ) {
          return sendError(reply, "Attach a requirement and a proposal to score.", 400);
        }
        const result = await scoreProposalCorpusPairCommand({
          requirement: {
            kind: "requirement",
            filename: requirement.filename,
            contentBase64: requirement.contentBase64,
            mime: requirement.mime ?? null,
          },
          proposal: {
            kind: "proposal",
            filename: proposal.filename,
            contentBase64: proposal.contentBase64,
            mime: proposal.mime ?? null,
          },
        });
        return sendResult(reply, result);
      },
      request,
    );
  });

  app.post<{
    Body: {
      name?: string | null;
      startProcessing?: boolean;
      files?: Array<{
        kind?: string;
        filename?: string;
        contentBase64?: string;
        mime?: string | null;
        pairSlot?: number;
        confidence?: number | null;
        useAnyway?: boolean;
      }>;
      pairs?: Array<{
        pairSlot?: number;
        confidence?: number | null;
        useAnyway?: boolean;
        requirement?: {
          kind?: string;
          filename?: string;
          contentBase64?: string;
          mime?: string | null;
        };
        proposal?: {
          kind?: string;
          filename?: string;
          contentBase64?: string;
          mime?: string | null;
        };
      }>;
    };
  }>("/proposal-patterns/batches", { bodyLimit: 20 * 1024 * 1024 }, async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const body = request.body ?? {};
        const files = Array.isArray(body.files)
          ? body.files
              .filter(
                (f) =>
                  (f.kind === "requirement" || f.kind === "proposal") &&
                  typeof f.filename === "string" &&
                  typeof f.contentBase64 === "string",
              )
              .map((f) => ({
                kind: f.kind as "requirement" | "proposal",
                filename: f.filename as string,
                contentBase64: f.contentBase64 as string,
                mime: f.mime ?? null,
                pairSlot: typeof f.pairSlot === "number" ? f.pairSlot : 0,
                confidence:
                  typeof f.confidence === "number" ? f.confidence : null,
                useAnyway: Boolean(f.useAnyway),
              }))
          : [];
        const pairs = Array.isArray(body.pairs)
          ? body.pairs.flatMap((pair, index) => {
              const req = pair.requirement;
              const prop = pair.proposal;
              if (
                !req ||
                typeof req.filename !== "string" ||
                typeof req.contentBase64 !== "string" ||
                !prop ||
                typeof prop.filename !== "string" ||
                typeof prop.contentBase64 !== "string"
              ) {
                return [];
              }
              return [
                {
                  pairSlot:
                    typeof pair.pairSlot === "number" ? pair.pairSlot : index,
                  requirement: {
                    kind: "requirement" as const,
                    filename: req.filename,
                    contentBase64: req.contentBase64,
                    mime: req.mime ?? null,
                  },
                  proposal: {
                    kind: "proposal" as const,
                    filename: prop.filename,
                    contentBase64: prop.contentBase64,
                    mime: prop.mime ?? null,
                  },
                  confidence:
                    typeof pair.confidence === "number"
                      ? pair.confidence
                      : null,
                  useAnyway: Boolean(pair.useAnyway),
                },
              ];
            })
          : undefined;
        const result = await createProposalCorpusBatchCommand({
          name: body.name,
          files,
          pairs,
          startProcessing: body.startProcessing !== false,
        });
        return sendResult(reply, result);
      },
      request,
    );
  });

  app.post<{ Params: { id: string } }>(
    "/proposal-patterns/batches/:id/process",
    async (request, reply) => {
      const userId = await requireSession(request, reply);
      if (!userId) return;
      return withUser(
        userId,
        async () => {
          const result = await processProposalCorpusBatchCommand(
            request.params.id,
          );
          return sendResult(reply, result);
        },
        request,
      );
    },
  );

  app.get<{ Querystring: { status?: string } }>(
    "/proposal-patterns/playbooks",
    async (request, reply) => {
      const userId = await requireSession(request, reply);
      if (!userId) return;
      return withUser(
        userId,
        async () => {
          const result = await listProposalPlaybooksCommand(
            request.query?.status,
          );
          return sendResult(reply, result);
        },
        request,
      );
    },
  );

  app.get<{ Params: { id: string } }>(
    "/proposal-patterns/playbooks/:id",
    async (request, reply) => {
      const userId = await requireSession(request, reply);
      if (!userId) return;
      return withUser(
        userId,
        async () => {
          const result = await getProposalPlaybookCommand(request.params.id);
          return sendResult(reply, result);
        },
        request,
      );
    },
  );

  app.post<{
    Params: { id: string };
    Body: { action?: string; name?: string };
  }>("/proposal-patterns/playbooks/:id/review", async (request, reply) => {
    const userId = await requireSession(request, reply);
    if (!userId) return;
    return withUser(
      userId,
      async () => {
        const action = request.body?.action;
        if (action !== "approve" && action !== "reject") {
          return sendError(reply, "action must be approve or reject.", 400);
        }
        const result = await reviewProposalPlaybookCommand({
          id: request.params.id,
          action,
          name: request.body?.name,
        });
        return sendResult(reply, result);
      },
      request,
    );
  });
};

