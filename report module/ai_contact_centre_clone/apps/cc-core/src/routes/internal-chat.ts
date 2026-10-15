import type { FastifyInstance } from "fastify";
import { joinApiV1 } from "@ai-contact-center/api-paths";
import multipart from "@fastify/multipart";
import { z } from "zod";

import { withOrganizationContext } from "../lib/rls.js";
import { jsonStringifyEntityPayload } from "../lib/id-schema.js";
import { requireTenantId } from "../services/reporting.js";
import {
  assertRoomAccess,
  bootstrapInternalChat,
  createDmRoomSchema,
  createGroupRoom,
  createGroupRoomSchema,
  getAttachmentForDownload,
  getOrCreateDmRoom,
  getRoomAvatarForDownload,
  getVoiceForDownload,
  listAssignableMembers,
  listMessages,
  listRoomsForUser,
  markRoomRead,
  renameGroupRoom,
  renameGroupRoomSchema,
  updateGroupRoom,
  updateGroupRoomSchema,
  sendInternalChatMessageSchema,
  sendMessage,
  toggleFavourite,
  updateGroupMembers,
  updateGroupMembersSchema,
} from "../services/internal-chat.js";
import {
  buildInternalChatStorageKey,
  ensureInternalChatUploadRoot,
  guessInternalChatContentType,
  readInternalChatFile,
  sha256Hex,
  writeInternalChatFile,
} from "../services/internal-chat-storage.js";
import {
  emitInternalChatMessageCreated,
  emitInternalChatRoomRead,
  emitInternalChatRoomUpdated,
} from "../services/realtime.js";

function handleRouteError(app: FastifyInstance, error: unknown): never {
  if (error instanceof z.ZodError) {
    throw app.httpErrors.badRequest(error.issues[0]?.message ?? "Invalid payload");
  }
  if (
    typeof error === "object" &&
    error &&
    "status" in error &&
    typeof (error as { status: number }).status === "number"
  ) {
    const status = (error as { status: number }).status;
    const message = error instanceof Error ? error.message : "Request failed";
    if (status === 404) throw app.httpErrors.notFound(message);
    if (status === 403) throw app.httpErrors.forbidden(message);
    if (status === 400) throw app.httpErrors.badRequest(message);
  }
  throw error;
}

function apiBase(apiV1Base: string): string {
  return apiV1Base.replace(/\/$/, "");
}

export async function registerInternalChatRoutes(
  app: FastifyInstance,
  apiV1Base: string,
): Promise<void> {
  await app.register(async (scoped) => {
    scoped.addHook("preHandler", app.requireContactCenter);
    await scoped.register(multipart, {
      limits: { fileSize: 25 * 1024 * 1024 },
    });

    await ensureInternalChatUploadRoot();

    const prefix = joinApiV1(apiV1Base, "/internal-chat");
    const base = apiBase(apiV1Base);

    scoped.get(`${prefix}/bootstrap`, async (request, reply) => {
      const { organizationId, userId } = requireTenantId(app, request);
      const payload = await withOrganizationContext(app.prisma, organizationId, (db) =>
        bootstrapInternalChat(db, organizationId, userId, base),
      );
      reply.type("application/json");
      return reply.send(JSON.parse(jsonStringifyEntityPayload(payload)));
    });

    scoped.get(`${prefix}/rooms`, async (request, reply) => {
      const { organizationId, userId } = requireTenantId(app, request);
      const rooms = await withOrganizationContext(app.prisma, organizationId, (db) =>
        listRoomsForUser(db, organizationId, userId, base),
      );
      reply.type("application/json");
      return reply.send(JSON.parse(jsonStringifyEntityPayload({ rooms })));
    });

    scoped.post(`${prefix}/rooms`, async (request, reply) => {
      try {
        const { organizationId, userId } = requireTenantId(app, request);
        const payload = createGroupRoomSchema.parse(request.body);
        const room = await withOrganizationContext(app.prisma, organizationId, (db) =>
          createGroupRoom(
            db,
            organizationId,
            userId,
            request.userRole === "admin" ? "admin" : "agent",
            payload,
            base,
          ),
        );
        emitInternalChatRoomUpdated(organizationId, [room.id], {
          lastMessageAt: room.lastMessageAt,
          lastMessagePreview: room.lastMessagePreview,
        });
        reply.type("application/json");
        return reply.send(JSON.parse(jsonStringifyEntityPayload({ room })));
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.post(`${prefix}/dm`, async (request, reply) => {
      try {
        const { organizationId, userId } = requireTenantId(app, request);
        const payload = createDmRoomSchema.parse(request.body);
        const room = await withOrganizationContext(app.prisma, organizationId, (db) =>
          getOrCreateDmRoom(db, organizationId, userId, payload.targetUserId, base),
        );
        reply.type("application/json");
        return reply.send(JSON.parse(jsonStringifyEntityPayload({ room })));
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.patch(`${prefix}/rooms/:roomId`, async (request, reply) => {
      try {
        const { organizationId, userId } = requireTenantId(app, request);
        const { roomId } = request.params as { roomId: string };
        const body = request.body as Record<string, unknown>;
        const room = await withOrganizationContext(app.prisma, organizationId, async (db) => {
          if (
            body.description !== undefined ||
            body.category !== undefined ||
            body.avatarStorageKey !== undefined
          ) {
            const payload = updateGroupRoomSchema.parse(body);
            return updateGroupRoom(db, organizationId, userId, roomId, payload, base);
          }
          const payload = renameGroupRoomSchema.parse(body);
          return renameGroupRoom(db, organizationId, userId, roomId, payload.name, base);
        });
        emitInternalChatRoomUpdated(organizationId, [roomId], {
          name: room.name,
          description: room.description,
          category: room.category,
          avatarUrl: room.avatarUrl,
          memberIds: room.memberIds,
        });
        reply.type("application/json");
        return reply.send(JSON.parse(jsonStringifyEntityPayload({ room })));
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.put(`${prefix}/rooms/:roomId/members`, async (request, _reply) => {
      try {
        const { organizationId, userId } = requireTenantId(app, request);
        const { roomId } = request.params as { roomId: string };
        const payload = updateGroupMembersSchema.parse(request.body);
        const memberIds = await withOrganizationContext(app.prisma, organizationId, (db) =>
          updateGroupMembers(db, organizationId, userId, roomId, payload.memberIds),
        );
        emitInternalChatRoomUpdated(organizationId, [roomId], { memberIds });
        return { ok: true };
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.get(`${prefix}/rooms/:roomId/messages`, async (request, reply) => {
      try {
        const { organizationId, userId } = requireTenantId(app, request);
        const { roomId } = request.params as { roomId: string };
        const query = z
          .object({
            before: z.string().optional(),
            limit: z.coerce.number().int().positive().max(100).optional(),
          })
          .parse(request.query ?? {});
        const result = await withOrganizationContext(app.prisma, organizationId, (db) =>
          listMessages(db, organizationId, userId, roomId, base, query),
        );
        reply.type("application/json");
        return reply.send(JSON.parse(jsonStringifyEntityPayload(result)));
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.post(`${prefix}/rooms/:roomId/messages`, async (request, reply) => {
      try {
        const { organizationId, userId } = requireTenantId(app, request);
        const { roomId } = request.params as { roomId: string };
        const payload = sendInternalChatMessageSchema.parse(request.body);
        const message = await withOrganizationContext(app.prisma, organizationId, (db) =>
          sendMessage(db, organizationId, userId, roomId, payload, base),
        );
        emitInternalChatMessageCreated(organizationId, roomId, message);
        emitInternalChatRoomUpdated(organizationId, [roomId], {
          lastMessageAt: message.createdAt,
          lastMessagePreview:
            message.voiceDurationMs != null
              ? "🎤 Voice message"
              : message.attachments?.length
                ? message.attachments.map((item) => item.name).join(", ")
                : message.body,
        });
        reply.type("application/json");
        return reply.send(JSON.parse(jsonStringifyEntityPayload({ message })));
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.post(`${prefix}/rooms/:roomId/read`, async (request, _reply) => {
      try {
        const { organizationId, userId } = requireTenantId(app, request);
        const { roomId } = request.params as { roomId: string };
        const lastReadAt = await withOrganizationContext(app.prisma, organizationId, (db) =>
          markRoomRead(db, organizationId, userId, roomId),
        );
        emitInternalChatRoomRead(organizationId, userId, roomId, lastReadAt);
        return { lastReadAt };
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.post(`${prefix}/rooms/:roomId/favourite`, async (request, _reply) => {
      try {
        const { organizationId, userId } = requireTenantId(app, request);
        const { roomId } = request.params as { roomId: string };
        const favourite = await withOrganizationContext(app.prisma, organizationId, (db) =>
          toggleFavourite(db, organizationId, userId, roomId),
        );
        return { favourite };
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.get(`${prefix}/members`, async (request, reply) => {
      const { organizationId, userId } = requireTenantId(app, request);
      const members = await withOrganizationContext(app.prisma, organizationId, (db) =>
        listAssignableMembers(db, organizationId, userId),
      );
      reply.type("application/json");
      return reply.send(JSON.parse(jsonStringifyEntityPayload({ members })));
    });

    scoped.post(`${prefix}/avatar-upload`, async (request, _reply) => {
      try {
        const { organizationId, userId } = requireTenantId(app, request);
        const file = await request.file();
        if (!file) {
          throw app.httpErrors.badRequest("File is required");
        }
        const buffer = await file.toBuffer();
        const fileName = file.filename || "avatar.jpg";
        const storageKey = buildInternalChatStorageKey(organizationId, `pending/${userId}`, fileName);
        await writeInternalChatFile(storageKey, buffer);
        return {
          storageKey,
          fileName,
          contentType: file.mimetype || "image/jpeg",
          byteSize: buffer.byteLength,
          checksumSha256: sha256Hex(buffer),
        };
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.post(`${prefix}/rooms/:roomId/uploads`, async (request, _reply) => {
      try {
        const { organizationId, userId } = requireTenantId(app, request);
        const { roomId } = request.params as { roomId: string };
        await withOrganizationContext(app.prisma, organizationId, (db) =>
          assertRoomAccess(db, organizationId, userId, roomId),
        );
        const file = await request.file();
        if (!file) {
          throw app.httpErrors.badRequest("File is required");
        }
        const buffer = await file.toBuffer();
        const fileName = file.filename || "upload.bin";
        const storageKey = buildInternalChatStorageKey(organizationId, roomId, fileName);
        await writeInternalChatFile(storageKey, buffer);
        return {
          storageKey,
          fileName,
          contentType: file.mimetype || "application/octet-stream",
          byteSize: buffer.byteLength,
          checksumSha256: sha256Hex(buffer),
        };
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.get(`${prefix}/files/:attachmentId`, async (request, reply) => {
      try {
        const { organizationId, userId } = requireTenantId(app, request);
        const { attachmentId } = request.params as { attachmentId: string };
        const file = await withOrganizationContext(app.prisma, organizationId, (db) =>
          getAttachmentForDownload(db, organizationId, userId, attachmentId),
        );
        const buffer = await readInternalChatFile(file.storageKey);
        reply.header("Content-Type", file.contentType);
        reply.header("Content-Disposition", `inline; filename="${file.fileName}"`);
        return reply.send(buffer);
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.get(`${prefix}/messages/:messageId/voice`, async (request, reply) => {
      try {
        const { organizationId, userId } = requireTenantId(app, request);
        const { messageId } = request.params as { messageId: string };
        const file = await withOrganizationContext(app.prisma, organizationId, (db) =>
          getVoiceForDownload(db, organizationId, userId, messageId),
        );
        const buffer = await readInternalChatFile(file.storageKey);
        reply.header("Content-Type", file.contentType);
        return reply.send(buffer);
      } catch (error) {
        handleRouteError(app, error);
      }
    });

    scoped.get(`${prefix}/room-avatars/:roomId`, async (request, reply) => {
      try {
        const { organizationId, userId } = requireTenantId(app, request);
        const { roomId } = request.params as { roomId: string };
        const file = await withOrganizationContext(app.prisma, organizationId, (db) =>
          getRoomAvatarForDownload(db, organizationId, userId, roomId),
        );
        const buffer = await readInternalChatFile(file.storageKey);
        reply.header("Content-Type", guessInternalChatContentType(file.storageKey));
        return reply.send(buffer);
      } catch (error) {
        handleRouteError(app, error);
      }
    });
  });
}
