import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireSession } from "../../middlewares/authendication.js";
import {
  appendTemplateMessagesDao,
  createTemplatesBatchDao,
  getTemplateDao,
  listRecentOrgTemplatesDao,
  listTemplatesForSessionDao,
  syncSessionTemplatesDao,
  updateTemplateFieldsDao,
} from "../../dao/channel-template.js";
import { AppError, sendSuccess } from "../../helpers/response-builders.js";
import { RESPONSE } from "../../helpers/constants.js";
import { zDbId, zDbIdNullable } from "../../helpers/id-schema.js";

const sessionIdParam = z.object({
  sessionId: zDbId,
});

const templateIdParam = z.object({
  templateId: zDbId,
});

const fieldsSchema = z.record(z.unknown());

const batchBodySchema = z.object({
  generation_batch_id: zDbIdNullable,
  templates: z
    .array(
      z.object({
        template_id: zDbId.optional(),
        channel: z.string().min(1),
        logo: z.string().optional().nullable(),
        launch_at: z.string().optional().nullable(),
        how_it_works: z.string().optional().nullable(),
        fields: fieldsSchema.optional().default({}),
        preview: z.string().optional().nullable(),
      }),
    )
    .min(1),
});

const updateFieldsBodySchema = z.object({
  fields: fieldsSchema,
});

const appendMessagesBodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant", "system"]),
        kind: z.enum(["text", "template"]),
        payload: z.record(z.unknown()),
      }),
    )
    .min(1),
});

export async function createTemplatesBatchHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const params = sessionIdParam.safeParse(request.params);
  if (!params.success) {
    throw new AppError(params.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const body = batchBodySchema.safeParse(request.body ?? {});
  if (!body.success) {
    throw new AppError(body.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const result = await createTemplatesBatchDao(
    session,
    params.data.sessionId,
    body.data.templates,
    body.data.generation_batch_id,
  );
  return sendSuccess(reply, RESPONSE.channelTemplatesCreated, result, 201);
}

export async function syncSessionTemplatesHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const params = sessionIdParam.safeParse(request.params);
  if (!params.success) {
    throw new AppError(params.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const body = batchBodySchema.safeParse(request.body ?? {});
  if (!body.success) {
    throw new AppError(body.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const result = await syncSessionTemplatesDao(
    session,
    params.data.sessionId,
    body.data.templates,
    body.data.generation_batch_id,
  );
  return sendSuccess(reply, RESPONSE.channelTemplatesCreated, result);
}

export async function listSessionTemplatesHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const params = sessionIdParam.safeParse(request.params);
  if (!params.success) {
    throw new AppError(params.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const result = await listTemplatesForSessionDao(
    session,
    params.data.sessionId,
  );
  return sendSuccess(reply, RESPONSE.channelTemplatesSuccess, result);
}

export async function listRecentOrgTemplatesHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const q = z
    .object({
      channel: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(50).optional(),
    })
    .parse(request.query ?? {});
  const result = await listRecentOrgTemplatesDao(session, {
    channel: q.channel,
    limit: q.limit,
  });
  return sendSuccess(reply, RESPONSE.channelTemplatesSuccess, result);
}

export async function getChannelTemplateHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const params = templateIdParam.safeParse(request.params);
  if (!params.success) {
    throw new AppError(params.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const result = await getTemplateDao(session, params.data.templateId);
  return sendSuccess(reply, RESPONSE.channelTemplateSuccess, result);
}

export async function updateChannelTemplateFieldsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const params = templateIdParam.safeParse(request.params);
  if (!params.success) {
    throw new AppError(params.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const body = updateFieldsBodySchema.safeParse(request.body ?? {});
  if (!body.success) {
    throw new AppError(body.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const result = await updateTemplateFieldsDao(
    session,
    params.data.templateId,
    body.data.fields,
  );
  return sendSuccess(reply, RESPONSE.channelTemplateUpdated, result);
}

export async function appendChannelTemplateMessagesHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const params = templateIdParam.safeParse(request.params);
  if (!params.success) {
    throw new AppError(params.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const body = appendMessagesBodySchema.safeParse(request.body ?? {});
  if (!body.success) {
    throw new AppError(body.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const result = await appendTemplateMessagesDao(
    session,
    params.data.templateId,
    body.data.messages,
  );
  return sendSuccess(reply, RESPONSE.channelTemplateMessagesSaved, result);
}
