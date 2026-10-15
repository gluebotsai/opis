import type { FastifyInstance } from "fastify";
import { embedSessionHandler } from "./handler.js";

/** CRM iframe session exchange — validates CRM JWT (6-step connect spec). */
export default async function embedRoutes(server: FastifyInstance) {
  server.post("/session", {
    schema: {
      tags: ["Embed"],
      summary: "CRM embed session exchange (CRM JWT → ok)",
      description:
        "Verifies Worktual CRM access JWT and applies CRM connect rules. " +
        "Campaign iframe auth also uses Bearer JWT on /api/* directly.",
    },
    handler: embedSessionHandler,
  });
}
