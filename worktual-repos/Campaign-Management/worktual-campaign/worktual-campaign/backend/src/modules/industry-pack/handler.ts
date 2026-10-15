import type { FastifyReply, FastifyRequest } from "fastify";
import {
  addPackRuleDao,
  deletePackFieldDao,
  deletePackRuleDao,
  getOrSeedIndustryPackDao,
  learnPackFieldsDao,
  updatePackFieldDao,
  updatePackRuleDao,
  upsertPackFieldDao,
} from "../../dao/industry-pack.js";
import { RESPONSE } from "../../helpers/constants.js";
import { AppError, sendSuccess } from "../../helpers/response-builders.js";
import { requireSession } from "../../middlewares/authendication.js";
import { enqueueGalleryIndustryAppend } from "../../services/gallery-bootstrap-worker.js";

export async function getIndustryPackHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const pack = await getOrSeedIndustryPackDao(session);
  return sendSuccess(reply, RESPONSE.industryPackSuccess, { pack });
}

export async function addIndustryPackRuleHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const body = (request.body || {}) as { text?: string; source?: string };
  const text = String(body.text || "").trim();
  if (!text) throw new AppError("Rule text is required");
  const pack = await addPackRuleDao(session, {
    text,
    source: body.source === "agent" ? "agent" : "user",
  });
  void enqueueGalleryIndustryAppend(session).catch(() => {});
  return sendSuccess(reply, RESPONSE.industryPackRuleAdded, { pack });
}

export async function updateIndustryPackRuleHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const ruleId = String((request.params as { ruleId?: string })?.ruleId || "").trim();
  const body = (request.body || {}) as { text?: string };
  const text = String(body.text || "").trim();
  if (!ruleId || !text) throw new AppError("ruleId and text are required");
  const pack = await updatePackRuleDao(session, ruleId, { text });
  if (!pack) throw new AppError("Rule not found", 404);
  void enqueueGalleryIndustryAppend(session).catch(() => {});
  return sendSuccess(reply, RESPONSE.industryPackRuleUpdated, { pack });
}

export async function deleteIndustryPackRuleHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const ruleId = String((request.params as { ruleId?: string })?.ruleId || "").trim();
  if (!ruleId) throw new AppError("ruleId is required");
  const pack = await deletePackRuleDao(session, ruleId);
  if (!pack) throw new AppError("Rule not found", 404);
  return sendSuccess(reply, RESPONSE.industryPackRuleDeleted, { pack });
}

export async function upsertIndustryPackFieldHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const body = (request.body || {}) as {
    key?: string;
    label?: string;
    type?: string;
    ask?: string;
    status?: string;
    source?: string;
  };
  const key = String(body.key || "").trim();
  if (!key) throw new AppError("Field key is required");
  try {
    const pack = await upsertPackFieldDao(session, {
      key,
      label: body.label,
      type: body.type === "number" ? "number" : "string",
      ask: body.ask === "recommended" ? "recommended" : "optional",
      status: body.status === "suggested" ? "suggested" : "active",
      source:
        body.source === "learned" || body.source === "seed"
          ? body.source
          : "user",
    });
    void enqueueGalleryIndustryAppend(session).catch(() => {});
    return sendSuccess(reply, RESPONSE.industryPackFieldSaved, { pack });
  } catch (err) {
    throw new AppError(err instanceof Error ? err.message : "Invalid field");
  }
}

export async function updateIndustryPackFieldHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const key = String((request.params as { key?: string })?.key || "").trim();
  const body = (request.body || {}) as {
    label?: string;
    type?: string;
    ask?: string;
    status?: string;
  };
  if (!key) throw new AppError("Field key is required");
  const pack = await updatePackFieldDao(session, key, {
    ...(body.label != null ? { label: String(body.label) } : {}),
    ...(body.type === "number" || body.type === "string"
      ? { type: body.type }
      : {}),
    ...(body.ask === "recommended" || body.ask === "optional"
      ? { ask: body.ask }
      : {}),
    ...(body.status === "active" || body.status === "suggested"
      ? { status: body.status }
      : {}),
  });
  if (!pack) throw new AppError("Field not found", 404);
  void enqueueGalleryIndustryAppend(session).catch(() => {});
  return sendSuccess(reply, RESPONSE.industryPackFieldSaved, { pack });
}

export async function deleteIndustryPackFieldHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const key = String((request.params as { key?: string })?.key || "").trim();
  if (!key) throw new AppError("Field key is required");
  const pack = await deletePackFieldDao(session, key);
  if (!pack) throw new AppError("Field not found", 404);
  return sendSuccess(reply, RESPONSE.industryPackFieldDeleted, { pack });
}

export async function learnIndustryPackFieldsHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const body = (request.body || {}) as {
    customFields?: Record<string, unknown>;
  };
  const result = await learnPackFieldsDao(session, body.customFields || {});
  void enqueueGalleryIndustryAppend(session).catch(() => {});
  return sendSuccess(reply, RESPONSE.industryPackLearned, {
    pack: result.pack,
    suggested: result.suggested,
  });
}
