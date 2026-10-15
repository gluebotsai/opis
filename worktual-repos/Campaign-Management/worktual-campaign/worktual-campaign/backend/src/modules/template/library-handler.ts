// @ts-nocheck — worktual_bigint Prisma BigInt ids; runtime coerced to string in plugins/prisma.ts
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireSession } from "../../middlewares/authendication.js";
import { AppError, sendSuccess } from "../../helpers/response-builders.js";
import { RESPONSE } from "../../helpers/constants.js";
import { dbIdParam } from "../../helpers/id-schema.js";
import {
  bumpLibraryTemplateUsedDao,
  createLibraryTemplateDao,
  deleteLibraryTemplateDao,
  getLibraryTemplateDao,
  listLibraryTemplatesDao,
  purgeObsoleteLibraryTemplates,
  updateLibraryTemplateDao,
} from "../../dao/library-template.js";

const channelEnum = z.enum([
  "email",
  "sms",
  "whatsapp",
  "web_push",
  "app_push",
  "ppc",
]);

const previewSchema = z.record(z.unknown()).nullable().optional();

const createBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  styleNotes: z.string().max(4000).optional(),
  goal: z.string().max(200).optional(),
  primaryChannel: channelEnum,
  channels: z.array(z.string()).optional(),
  audience: z.string().max(500).optional(),
  flowSteps: z.array(z.string()).optional(),
  starterMessage: z.string().max(2000).optional(),
  approvalStatus: z.enum(["draft", "approved"]).optional(),
  bodyPreview: z.string().max(4000).optional(),
  contentBody: z.string().max(100_000).optional(),
  previewImage: z.string().max(2000).nullable().optional(),
  preview: previewSchema,
  metadata: z.record(z.unknown()).optional(),
  externalTemplateId: z.string().max(200).optional(),
});

const updateBody = createBody.partial().extend({
  primaryChannel: channelEnum.optional(),
  name: z.string().min(1).max(200).optional(),
});

export async function listLibraryTemplatesHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const query = request.query as { includeLocked?: string; includeHidden?: string };
  await purgeObsoleteLibraryTemplates(session.organizationId);
  const templates = await listLibraryTemplatesDao(session.organizationId, {
    includeLocked: query.includeLocked === "true",
    includeHidden: query.includeHidden === "true",
  });
  return sendSuccess(reply, RESPONSE.libraryTemplatesSuccess, { templates });
}

export async function getLibraryTemplateHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const { id } = dbIdParam().parse(request.params);
  const template = await getLibraryTemplateDao(session.organizationId, id);
  if (!template) throw new AppError("Template not found", 404);
  return sendSuccess(reply, RESPONSE.libraryTemplatesSuccess, { template });
}

export async function createLibraryTemplateHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const body = createBody.safeParse(request.body ?? {});
  if (!body.success) {
    throw new AppError(body.error.issues[0]?.message || "Invalid template body");
  }
  const template = await createLibraryTemplateDao(session.organizationId, {
    ...body.data,
    createdByUserId: session.id ?? null,
  });
  return sendSuccess(reply, RESPONSE.libraryTemplateCreated, { template });
}

export async function updateLibraryTemplateHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const { id } = dbIdParam().parse(request.params);
  const body = updateBody.safeParse(request.body ?? {});
  if (!body.success) {
    throw new AppError(body.error.issues[0]?.message || "Invalid template body");
  }
  const template = await updateLibraryTemplateDao(
    session.organizationId,
    id,
    body.data,
  );
  return sendSuccess(reply, RESPONSE.libraryTemplateUpdated, { template });
}

export async function deleteLibraryTemplateHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const { id } = dbIdParam().parse(request.params);
  await deleteLibraryTemplateDao(session.organizationId, id);
  return sendSuccess(reply, RESPONSE.libraryTemplateDeleted, { id });
}

export async function bumpLibraryTemplateUsedHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const { id } = dbIdParam().parse(request.params);
  const template = await bumpLibraryTemplateUsedDao(
    session.organizationId,
    id,
  );
  if (!template) throw new AppError("Template not found", 404);
  return sendSuccess(reply, RESPONSE.libraryTemplateUpdated, { template });
}
