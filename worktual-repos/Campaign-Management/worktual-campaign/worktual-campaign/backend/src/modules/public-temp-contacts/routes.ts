import type { FastifyInstance } from "fastify";
import {
  TEMP_CONTACT_TEMPLATE_FILENAME,
  temporaryContactTemplateCsv,
} from "../../helpers/temp-contact-template.js";

/** Unauthenticated sample sheet — linked from create-campaign chat. */
export default async function publicTempContactRoutes(server: FastifyInstance) {
  server.get("/temporary-contact-template.csv", {
    schema: {
      tags: ["Public"],
      summary:
        "Download CSV template for temporary campaign contacts (no auth)",
    },
    handler: async (_request, reply) => {
      const body = temporaryContactTemplateCsv();
      return reply
        .header("Content-Type", "text/csv; charset=utf-8")
        .header(
          "Content-Disposition",
          `attachment; filename="${TEMP_CONTACT_TEMPLATE_FILENAME}"`,
        )
        .header("Cache-Control", "public, max-age=3600")
        .send(body);
    },
  });
}
