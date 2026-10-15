import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

import type { FastifyInstance } from "fastify";
import { joinApiV1 } from "@ai-contact-center/api-paths";

import { withOrganizationContext } from "../lib/rls.js";
import {
  getOrganizationRecordingSettings,
  getOrganizationRoutingProfile,
  upsertOrganizationRecordingSchema,
  upsertOrganizationRecordingSettings,
  upsertOrganizationRoutingProfile,
  upsertOrganizationRoutingProfileSchema,
} from "../services/organization-settings.js";
import { findVoiceRecordingUrl, listVoiceRecordings } from "../services/voice-recordings.js";

function requireTenantId(app: FastifyInstance, request: { tenantId?: string }): string {
  if (!request.tenantId) {
    throw app.httpErrors.unauthorized("Missing tenant context");
  }
  return request.tenantId;
}

export async function registerOrganizationSettingsRoutes(
  app: FastifyInstance,
  apiV1Base: string,
): Promise<void> {
  await app.register(async (scoped) => {
    scoped.addHook("preHandler", app.requireContactCenter);
    const routingPrefix = joinApiV1(apiV1Base, "/setup/organization/routing-profile");
    const recordingPrefix = joinApiV1(apiV1Base, "/setup/organization/recording");

    scoped.get(routingPrefix, async (request) => {
      const organizationId = requireTenantId(app, request);
      return withOrganizationContext(app.prisma, organizationId, (db) =>
        getOrganizationRoutingProfile(db, organizationId),
      );
    });

    scoped.put(routingPrefix, async (request) => {
      const organizationId = requireTenantId(app, request);
      const payload = upsertOrganizationRoutingProfileSchema.parse(request.body);
      return withOrganizationContext(app.prisma, organizationId, (db) =>
        upsertOrganizationRoutingProfile(db, organizationId, payload),
      );
    });

    scoped.get(`${recordingPrefix}/calls/:recordingId/audio`, async (request, reply) => {
      const organizationId = requireTenantId(app, request);
      const recordingId = (request.params as { recordingId?: string }).recordingId ?? "";
      const url = await withOrganizationContext(app.prisma, organizationId, (db) =>
        findVoiceRecordingUrl(db, organizationId, recordingId),
      );
      if (!url) {
        throw app.httpErrors.notFound("Recording not found");
      }
      const upstream = await fetch(url, {
        headers: {
          Accept: "audio/mpeg,*/*",
          "User-Agent": "Mozilla/5.0",
        },
        redirect: "follow",
      });
      if (!upstream.ok || !upstream.body) {
        throw app.httpErrors.badGateway("Recording file is unavailable");
      }
      const contentType = upstream.headers.get("content-type") || "audio/mpeg";
      reply.header("Content-Type", contentType);
      reply.header("Cache-Control", "private, max-age=300");
      return reply.send(Readable.fromWeb(upstream.body as NodeReadableStream));
    });

    scoped.get(`${recordingPrefix}/calls`, async (request) => {
      const organizationId = requireTenantId(app, request);
      const query = request.query as {
        limit?: string | number;
        offset?: string | number;
        q?: string;
        direction?: string;
        queue?: string;
        agent?: string;
        from?: string;
        to?: string;
      };
      const limit = Number(query?.limit);
      const offset = Number(query?.offset);
      return withOrganizationContext(app.prisma, organizationId, (db) =>
        listVoiceRecordings(db, organizationId, {
          limit: Number.isFinite(limit) ? limit : undefined,
          offset: Number.isFinite(offset) ? offset : undefined,
          search: typeof query?.q === "string" ? query.q : undefined,
          direction: typeof query?.direction === "string" ? query.direction : undefined,
          queue: typeof query?.queue === "string" ? query.queue : undefined,
          agent: typeof query?.agent === "string" ? query.agent : undefined,
          from: typeof query?.from === "string" ? query.from : undefined,
          to: typeof query?.to === "string" ? query.to : undefined,
        }),
      );
    });

    scoped.get(recordingPrefix, async (request) => {
      const organizationId = requireTenantId(app, request);
      return withOrganizationContext(app.prisma, organizationId, (db) =>
        getOrganizationRecordingSettings(db, organizationId),
      );
    });

    scoped.put(recordingPrefix, async (request) => {
      const organizationId = requireTenantId(app, request);
      const payload = upsertOrganizationRecordingSchema.parse(request.body);
      return withOrganizationContext(app.prisma, organizationId, (db) =>
        upsertOrganizationRecordingSettings(db, organizationId, payload),
      );
    });
  });
}
