import type { FastifyInstance } from "fastify";
import { OPPORTUNITY_EVENTS } from "../../helpers/constants.js";
import { validateSession } from "../../middlewares/authendication.js";
import {
  agentEventsSnapshotHandler,
  deleteOpportunityEventHandler,
  listOpportunityEventsHandler,
  putOpportunityEventsHandler,
} from "./handler.js";

export default async function opportunityEventsRoutes(
  server: FastifyInstance,
) {
  server.addHook("preValidation", validateSession);

  server.get(OPPORTUNITY_EVENTS.AGENT_SNAPSHOT, {
    schema: {
      tags: ["Opportunity events"],
      summary: "Events + form submissions snapshot for agents",
    },
    handler: agentEventsSnapshotHandler,
  });

  server.get(OPPORTUNITY_EVENTS.LIST, {
    schema: {
      tags: ["Opportunity events"],
      summary: "List opportunity events for the current tenant",
    },
    handler: listOpportunityEventsHandler,
  });

  server.put(OPPORTUNITY_EVENTS.PUT, {
    schema: {
      tags: ["Opportunity events"],
      summary: "Upsert opportunity events for the current tenant",
    },
    handler: putOpportunityEventsHandler,
  });

  server.delete(OPPORTUNITY_EVENTS.DELETE, {
    schema: {
      tags: ["Opportunity events"],
      summary: "Delete an opportunity event",
    },
    handler: deleteOpportunityEventHandler,
  });
}
