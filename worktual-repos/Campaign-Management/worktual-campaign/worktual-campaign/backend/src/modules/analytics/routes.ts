import type { FastifyInstance } from "fastify";
import { validateSession } from "../../middlewares/authendication.js";
import { analyticsAskHandler } from "./handler.js";

export default async function analyticsRoutes(server: FastifyInstance) {
  server.addHook("preValidation", validateSession);

  server.post("/ask", {
    schema: {
      tags: ["Analytics"],
      summary:
        "Allowlisted Campaign NL analytics (QueryPlan over campaign metrics)",
      body: {
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string" },
          period: {
            type: "object",
            nullable: true,
            properties: {
              relative: {
                type: "string",
                enum: [
                  "today",
                  "yesterday",
                  "last_7_days",
                  "last_30_days",
                  "last_month",
                ],
                nullable: true,
              },
              fromDate: { type: "string", nullable: true },
              toDate: { type: "string", nullable: true },
            },
          },
        },
      },
    },
    handler: analyticsAskHandler,
  });
}
