import type { FastifyInstance } from "fastify";
import { INDUSTRY_PACK } from "../../helpers/constants.js";
import { validateSession } from "../../middlewares/authendication.js";
import {
  addIndustryPackRuleHandler,
  deleteIndustryPackFieldHandler,
  deleteIndustryPackRuleHandler,
  getIndustryPackHandler,
  learnIndustryPackFieldsHandler,
  updateIndustryPackFieldHandler,
  updateIndustryPackRuleHandler,
  upsertIndustryPackFieldHandler,
} from "./handler.js";

export default async function industryPackRoutes(server: FastifyInstance) {
  server.addHook("preValidation", validateSession);

  server.get(INDUSTRY_PACK.GET, {
    schema: {
      tags: ["Industry Pack"],
      summary: "Get or seed this company's industry pack",
    },
    handler: getIndustryPackHandler,
  });

  server.post(INDUSTRY_PACK.ADD_RULE, {
    schema: {
      tags: ["Industry Pack"],
      summary: "Add a company pack rule",
    },
    handler: addIndustryPackRuleHandler,
  });

  server.patch(INDUSTRY_PACK.UPDATE_RULE, {
    schema: {
      tags: ["Industry Pack"],
      summary: "Edit a company pack rule",
    },
    handler: updateIndustryPackRuleHandler,
  });

  server.delete(INDUSTRY_PACK.DELETE_RULE, {
    schema: {
      tags: ["Industry Pack"],
      summary: "Delete a company pack rule",
    },
    handler: deleteIndustryPackRuleHandler,
  });

  server.post(INDUSTRY_PACK.UPSERT_FIELD, {
    schema: {
      tags: ["Industry Pack"],
      summary: "Add or replace a company pack field hint",
    },
    handler: upsertIndustryPackFieldHandler,
  });

  server.patch(INDUSTRY_PACK.UPDATE_FIELD, {
    schema: {
      tags: ["Industry Pack"],
      summary: "Update or confirm a company pack field",
    },
    handler: updateIndustryPackFieldHandler,
  });

  server.delete(INDUSTRY_PACK.DELETE_FIELD, {
    schema: {
      tags: ["Industry Pack"],
      summary: "Delete a company pack field hint",
    },
    handler: deleteIndustryPackFieldHandler,
  });

  server.post(INDUSTRY_PACK.LEARN, {
    schema: {
      tags: ["Industry Pack"],
      summary:
        "Suggest pack fields from volunteered custom_fields (confirm required)",
    },
    handler: learnIndustryPackFieldsHandler,
  });
}
