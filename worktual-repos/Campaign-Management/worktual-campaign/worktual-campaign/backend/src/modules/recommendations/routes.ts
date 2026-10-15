import type { FastifyInstance } from "fastify";
import { RECOMMENDATIONS } from "../../helpers/constants.js";
import { validateSession } from "../../middlewares/authendication.js";
import {
  listRecommendationsHandler,
  putRecommendationsHandler,
} from "./handler.js";

export default async function recommendationsRoutes(server: FastifyInstance) {
  server.addHook("preValidation", validateSession);

  server.get(RECOMMENDATIONS.LIST, {
    schema: {
      tags: ["Recommendations"],
      summary: "List recommendation cards for the current tenant",
    },
    handler: listRecommendationsHandler,
  });

  server.put(RECOMMENDATIONS.PUT, {
    schema: {
      tags: ["Recommendations"],
      summary: "Upsert recommendation cards for the current tenant",
    },
    handler: putRecommendationsHandler,
  });
}
