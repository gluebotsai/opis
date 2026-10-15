import type { FastifyInstance } from "fastify";
import { MEDIA } from "../../helpers/constants.js";
import { validateSessionOrInternalServiceKey } from "../../middlewares/authendication.js";
import { getMediaHandler, uploadMediaHandler, uploadWhatsAppMetaMediaHandler } from "./handler.js";

export default async function mediaRoutes(server: FastifyInstance) {
  const max = 4 * 1024 * 1024;

  server.post(MEDIA.UPLOAD, {
    preValidation: validateSessionOrInternalServiceKey,
    bodyLimit: max,
    schema: {
      tags: ["Media"],
      summary: "Upload a local template image (JPEG/PNG/GIF/WebP, any filename)",
    },
    handler: uploadMediaHandler,
  });

  server.post(MEDIA.WHATSAPP_UPLOAD, {
    preValidation: validateSessionOrInternalServiceKey,
    bodyLimit: max,
    schema: {
      tags: ["Media"],
      summary: "Upload image to Meta for WhatsApp template IMAGE headers",
    },
    handler: uploadWhatsAppMetaMediaHandler,
  });

  server.get(MEDIA.GET, {
    schema: {
      tags: ["Media"],
      summary: "Public image for template preview (no extension required)",
    },
    handler: getMediaHandler,
  });
}
