import type { FastifyInstance } from "fastify";
import { CHANNEL_TEMPLATE } from "../../helpers/constants.js";
import { validateSession } from "../../middlewares/authendication.js";
import {
  appendChannelTemplateMessagesHandler,
  createTemplatesBatchHandler,
  getChannelTemplateHandler,
  listRecentOrgTemplatesHandler,
  listSessionTemplatesHandler,
  syncSessionTemplatesHandler,
  updateChannelTemplateFieldsHandler,
} from "./handler.js";

export default async function channelTemplateRoutes(server: FastifyInstance) {
  server.addHook("preValidation", validateSession);

  server.post(CHANNEL_TEMPLATE.BATCH, {
    schema: {
      tags: ["Channel Templates"],
      summary: "Create or update a batch of channel templates for a session",
    },
    handler: createTemplatesBatchHandler,
  });

  server.post(CHANNEL_TEMPLATE.SYNC, {
    schema: {
      tags: ["Channel Templates"],
      summary: "Backfill missing session templates into DB (idempotent)",
    },
    handler: syncSessionTemplatesHandler,
  });

  server.get(CHANNEL_TEMPLATE.BY_SESSION, {
    schema: {
      tags: ["Channel Templates"],
      summary: "List channel templates for a create-campaign session",
    },
    handler: listSessionTemplatesHandler,
  });

  server.get(CHANNEL_TEMPLATE.RECENT, {
    schema: {
      tags: ["Channel Templates"],
      summary: "List recent channel templates for the organization (fingerprint history)",
    },
    handler: listRecentOrgTemplatesHandler,
  });

  server.get(CHANNEL_TEMPLATE.GET, {
    schema: {
      tags: ["Channel Templates"],
      summary: "Get one channel template and its edit messages",
    },
    handler: getChannelTemplateHandler,
  });

  server.patch(CHANNEL_TEMPLATE.UPDATE_FIELDS, {
    schema: {
      tags: ["Channel Templates"],
      summary: "Update current key/value fields for a template",
    },
    handler: updateChannelTemplateFieldsHandler,
  });

  server.post(CHANNEL_TEMPLATE.APPEND_MESSAGES, {
    schema: {
      tags: ["Channel Templates"],
      summary: "Append edit-space chat messages for a template",
    },
    handler: appendChannelTemplateMessagesHandler,
  });
}
