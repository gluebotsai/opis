import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { requireSession } from "../../middlewares/authendication.js";
import { AppError, sendSuccess } from "../../helpers/response-builders.js";
import { RESPONSE } from "../../helpers/constants.js";
import { dbIdParam } from "../../helpers/id-schema.js";
import {
  archiveImageGalleryAssetDao,
  listImageGalleryAssetsDao,
  registerImageGalleryAssetDao,
} from "../../dao/image-gallery.js";

const registerBody = z.object({
  media_id: z.string().max(64).optional(),
  image_url: z.string().min(8).max(4096),
  short_description: z.string().max(500).optional(),
  generation_prompt: z.string().max(8000).optional(),
  source: z.enum(["ai_generated", "uploaded", "imported"]).optional(),
  channel: z.string().max(64).optional(),
  context: z.record(z.unknown()).optional(),
  reuse_tags: z.record(z.unknown()).optional(),
});

const listQuery = z.object({
  q: z.string().max(200).optional(),
  status: z.enum(["active", "archived"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});

export async function listImageGalleryHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const query = listQuery.parse(request.query ?? {});
  const result = await listImageGalleryAssetsDao(session.organizationId, query);
  return sendSuccess(reply, RESPONSE.imageGallerySuccess, result);
}

export async function registerImageGalleryHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const body = registerBody.safeParse(request.body ?? {});
  if (!body.success) {
    throw new AppError("Invalid image gallery register payload", 400);
  }
  try {
    const asset = await registerImageGalleryAssetDao(session, body.data);
    return sendSuccess(reply, RESPONSE.imageGalleryRegistered, { asset });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Register failed";
    throw new AppError(msg, 400);
  }
}

export async function archiveImageGalleryHandler(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const session = requireSession(request);
  const { id } = dbIdParam().parse(request.params);
  const asset = await archiveImageGalleryAssetDao(session, id);
  if (!asset) throw new AppError("Image not found", 404);
  return sendSuccess(reply, RESPONSE.imageGalleryArchived, { asset });
}
