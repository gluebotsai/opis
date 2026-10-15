import type { FastifyInstance } from "fastify";
import { AGENT_SESSION } from "../../helpers/constants.js";
import { validateSession } from "../../middlewares/authendication.js";
import {
  deleteAgentSessionHandler,
  deleteTempContactsHandler,
  getAudienceRefsHandler,
  getOrCreateAgentSessionHandler,
  listAgentSessionsHandler,
  pinAgentSessionHandler,
  listTempContactsHandler,
  putAudienceRefsHandler,
  putTempContactsHandler,
  saveAgentSessionHandler,
} from "./handler.js";

export default async function agentSessionRoutes(server: FastifyInstance) {
  server.addHook("preValidation", validateSession);

  server.get(AGENT_SESSION.LIST, {
    schema: {
      tags: ["Agent Sessions"],
      summary: "List create-campaign agent sessions (drafts) for current user",
    },
    handler: listAgentSessionsHandler,
  });

  server.patch(AGENT_SESSION.PIN, {
    schema: {
      tags: ["Agent Sessions"],
      summary: "Pin or unpin a create-campaign draft",
    },
    handler: pinAgentSessionHandler,
  });

  server.get(AGENT_SESSION.GET, {
    schema: {
      tags: ["Agent Sessions"],
      summary:
        "Get or create agent session (pass create=false to fetch only)",
    },
    handler: getOrCreateAgentSessionHandler,
  });

  server.put(AGENT_SESSION.SAVE, {
    schema: {
      tags: ["Agent Sessions"],
      summary: "Persist create-campaign agent session payload",
    },
    handler: saveAgentSessionHandler,
  });

  server.delete(AGENT_SESSION.DELETE, {
    schema: {
      tags: ["Agent Sessions"],
      summary: "Delete create-campaign agent session (draft)",
    },
    handler: deleteAgentSessionHandler,
  });

  server.get(AGENT_SESSION.AUDIENCE, {
    schema: {
      tags: ["Agent Sessions"],
      summary: "Load audience contact ID refs for a session",
    },
    handler: getAudienceRefsHandler,
  });

  server.put(AGENT_SESSION.AUDIENCE, {
    schema: {
      tags: ["Agent Sessions"],
      summary: "Replace audience contact ID refs for a session",
    },
    handler: putAudienceRefsHandler,
  });

  server.get(AGENT_SESSION.TEMP_CONTACTS, {
    schema: {
      tags: ["Agent Sessions"],
      summary: "List temporary contacts uploaded for this create-campaign session",
    },
    handler: listTempContactsHandler,
  });

  server.put(AGENT_SESSION.TEMP_CONTACTS, {
    schema: {
      tags: ["Agent Sessions"],
      summary:
        "Replace temporary contacts for this session (validated sheet rows)",
    },
    handler: putTempContactsHandler,
  });

  server.delete(AGENT_SESSION.TEMP_CONTACTS, {
    schema: {
      tags: ["Agent Sessions"],
      summary: "Clear temporary contacts for this session",
    },
    handler: deleteTempContactsHandler,
  });
}
