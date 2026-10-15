import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireSession } from "../../middlewares/authendication.js";
import {
  deleteAgentSessionDao,
  getOrCreateAgentSessionDao,
  listAgentSessionsDao,
  loadAudienceRefsDao,
  replaceAudienceRefsDao,
  saveAgentSessionDao,
  setAgentSessionPinnedDao,
} from "../../dao/agent-session.js";
import {
  clearTempContactsDao,
  listTempContactsDao,
  replaceTempContactsDao,
  type TempContactRowInput,
} from "../../dao/temp-contacts.js";
import { AppError, sendSuccess } from "../../helpers/response-builders.js";
import { RESPONSE } from "../../helpers/constants.js";
import { zContactId, zDbId } from "../../helpers/id-schema.js";

const sessionIdParam = z.object({
  sessionId: zDbId,
});

const saveBodySchema = z.object({
  session: z.record(z.unknown()),
});

const audienceBodySchema = z.object({
  // Filter APIs may return numeric ids; coerce so PUT does not 400.
  contact_ids: z
    .array(z.union([z.string(), z.number()]))
    .default([])
    .transform((ids) =>
      ids
        .map((id) => String(id).trim())
        .filter((id) => id.length > 0),
    )
    .pipe(z.array(zContactId)),
});

const tempContactsBodySchema = z.object({
  rows: z
    .array(z.record(z.unknown()))
    .min(1)
    .max(2000),
  replace: z.boolean().optional().default(true),
});

const moduleQuery = z.object({
  module: z.enum(["create_campaign", "contacts", "monitoring"]).optional(),
  /** When false, return 404 if the session does not exist (do not create). Default true. */
  create: z
    .enum(["true", "false", "1", "0"])
    .optional()
    .transform((v) => v !== "false" && v !== "0"),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  bucket: z
    .enum(["all", "live", "scheduled", "completed", "in_progress"])
    .optional(),
});

export async function listAgentSessionsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const query = moduleQuery.safeParse(request.query ?? {});
  const parsed = query.success
    ? query.data
    : { create: true, module: undefined, limit: undefined, offset: undefined, bucket: undefined };
  const result = await listAgentSessionsDao(
    session,
    parsed.module ?? "create_campaign",
    {
      limit: parsed.limit,
      offset: parsed.offset,
      bucket: parsed.bucket,
    },
  );
  return sendSuccess(reply, RESPONSE.agentSessionListSuccess, result);
}

export async function pinAgentSessionHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const params = sessionIdParam.safeParse(request.params);
  if (!params.success) {
    throw new AppError("Invalid session id.", 400);
  }
  const body = z
    .object({ pinned: z.boolean() })
    .safeParse(request.body ?? {});
  if (!body.success) {
    throw new AppError("pinned must be true or false.", 400);
  }
  const result = await setAgentSessionPinnedDao(
    session,
    params.data.sessionId,
    body.data.pinned,
  );
  return sendSuccess(reply, RESPONSE.agentSessionListSuccess, result);
}

export async function getOrCreateAgentSessionHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const parsed = sessionIdParam.safeParse(request.params);
  if (!parsed.success) {
    throw new AppError(parsed.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const query = moduleQuery.safeParse(request.query ?? {});
  const result = await getOrCreateAgentSessionDao(
    session,
    parsed.data.sessionId,
    query.success ? query.data.module : undefined,
    {
      createIfMissing: query.success ? query.data.create !== false : true,
    },
  );
  return sendSuccess(reply, RESPONSE.agentSessionSuccess, result);
}

export async function saveAgentSessionHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const params = sessionIdParam.safeParse(request.params);
  if (!params.success) {
    throw new AppError(params.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const body = saveBodySchema.safeParse(request.body ?? {});
  if (!body.success) {
    throw new AppError(body.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const result = await saveAgentSessionDao(
    session,
    params.data.sessionId,
    body.data.session,
  );
  return sendSuccess(reply, RESPONSE.agentSessionSaved, result);
}

export async function getAudienceRefsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const params = sessionIdParam.safeParse(request.params);
  if (!params.success) {
    throw new AppError(params.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const result = await loadAudienceRefsDao(session, params.data.sessionId);
  return sendSuccess(reply, RESPONSE.agentAudienceSuccess, result);
}

export async function putAudienceRefsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const params = sessionIdParam.safeParse(request.params);
  if (!params.success) {
    throw new AppError(params.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const body = audienceBodySchema.safeParse(request.body ?? {});
  if (!body.success) {
    const rawIds = (request.body as { contact_ids?: unknown } | undefined)
      ?.contact_ids;
    request.log.warn(
      {
        issue: body.error.issues[0]?.message,
        contactIdCount: Array.isArray(rawIds) ? rawIds.length : 0,
      },
      "PUT audience refs rejected",
    );
    throw new AppError(body.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const result = await replaceAudienceRefsDao(
    session,
    params.data.sessionId,
    body.data.contact_ids,
  );
  return sendSuccess(reply, RESPONSE.agentAudienceSaved, result);
}

export async function listTempContactsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const params = sessionIdParam.safeParse(request.params);
  if (!params.success) {
    throw new AppError(params.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const result = await listTempContactsDao(session, params.data.sessionId);
  return sendSuccess(reply, RESPONSE.agentTempContactsSuccess, result);
}

export async function putTempContactsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const params = sessionIdParam.safeParse(request.params);
  if (!params.success) {
    throw new AppError(params.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const body = tempContactsBodySchema.safeParse(request.body ?? {});
  if (!body.success) {
    throw new AppError(body.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const result = await replaceTempContactsDao(
    session,
    params.data.sessionId,
    body.data.rows as TempContactRowInput[],
  );
  return sendSuccess(reply, RESPONSE.agentTempContactsSaved, result);
}

export async function deleteTempContactsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const params = sessionIdParam.safeParse(request.params);
  if (!params.success) {
    throw new AppError(params.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const result = await clearTempContactsDao(session, params.data.sessionId);
  return sendSuccess(reply, RESPONSE.agentTempContactsCleared, result);
}

export async function deleteAgentSessionHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const params = sessionIdParam.safeParse(request.params);
  if (!params.success) {
    throw new AppError(params.error.issues[0]?.message ?? RESPONSE.bad_request);
  }
  const result = await deleteAgentSessionDao(session, params.data.sessionId);
  return sendSuccess(reply, RESPONSE.agentSessionDeleted, result);
}
