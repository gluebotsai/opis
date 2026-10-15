import type { FastifyInstance } from "fastify";
import { CONTACT } from "../../helpers/constants.js";
import { validateSession } from "../../middlewares/authendication.js";
import {
  audienceInsightsHandler,
  audienceSegmentationSummaryHandler,
  createContactHandler,
  deleteContactHandler,
  filterContactsHandler,
  listFilterableFieldsHandler,
  getContactHandler,
  getContactCampaignActivityHandler,
  importContactsHandler,
  listContactsHandler,
  lookupContactsHandler,
  personalizationPreviewHandler,
  updateContactHandler,
  updateContactPreferencesHandler,
  refreshContactPreferencesHandler,
} from "./handler.js";
import { contactSchemas } from "./schema.js";

export default async function contactRoutes(server: FastifyInstance) {
  server.addHook("preValidation", validateSession);

  server.get(CONTACT.LIST, {
    schema: {
      tags: ["Contacts"],
      summary: "List contacts from cdp.customer_profile + identity_keys",
    },
    handler: listContactsHandler,
  });

  server.get(CONTACT.FILTERABLE_FIELDS, {
    schema: {
      tags: ["Contacts"],
      summary:
        "Core columns plus custom_fields keys that exist on this tenant's contacts",
    },
    handler: listFilterableFieldsHandler,
  });

  server.get(CONTACT.AUDIENCE_SUMMARY, {
    schema: {
      tags: ["Contacts"],
      summary:
        "Aggregated audience segmentation (city, segment, join windows) for campaign agent",
    },
    handler: audienceSegmentationSummaryHandler,
  });

  server.post(CONTACT.FILTER, {
    schema: {
      tags: ["Contacts"],
      summary: "Filter contacts for create-campaign audience",
      body: contactSchemas.filterBody,
    },
    handler: filterContactsHandler,
  });

  server.post(CONTACT.LOOKUP, {
    schema: {
      tags: ["Contacts"],
      summary: "Lookup contacts by email, phone, or full name",
    },
    handler: lookupContactsHandler,
  });

  server.post(CONTACT.IMPORT, {
    schema: {
      tags: ["Contacts"],
      summary: "Bulk import contacts (CCUIA) — CSV mapped rows as JSON",
    },
    handler: importContactsHandler,
  });

  server.post(CONTACT.INSIGHTS, {
    schema: {
      tags: ["Contacts"],
      summary:
        "Soft CPMA + ASA audience insights by contact ids (warnings only, never blocks)",
    },
    handler: audienceInsightsHandler,
  });

  server.post(CONTACT.PERSONALIZATION_PREVIEW, {
    schema: {
      tags: ["Contacts"],
      summary:
        "Preview per-recipient dynamic merge tags / product offers (agent sampling)",
      body: contactSchemas.personalizationPreviewBody,
    },
    handler: personalizationPreviewHandler,
  });

  server.post(CONTACT.CREATE, {
    schema: {
      tags: ["Contacts"],
      summary: "Create a contact in cdp.customer_profile + identity_keys",
      body: contactSchemas.createBody,
    },
    handler: createContactHandler,
  });

  // Static paths before /:id
  server.get(CONTACT.CAMPAIGN_ACTIVITY, {
    schema: {
      tags: ["Contacts"],
      summary:
        "Per-contact campaign activity — active, draft, past sends with channel metrics",
      params: contactSchemas.idParams,
    },
    handler: getContactCampaignActivityHandler,
  });

  server.put(CONTACT.PREFERENCES, {
    schema: {
      tags: ["Contacts"],
      summary:
        "Update preferences_json (0|1 per channel; optional timezone/timing). Does not change other contact fields.",
      params: contactSchemas.idParams,
      body: contactSchemas.preferencesBody,
    },
    handler: updateContactPreferencesHandler,
  });

  server.post(CONTACT.PREFERENCES_REFRESH, {
    schema: {
      tags: ["Contacts"],
      summary:
        "Recompute channel flags from engagement; fill missing send windows. Writes preferences_json only.",
      params: contactSchemas.idParams,
    },
    handler: refreshContactPreferencesHandler,
  });

  server.get("/:id", {
    schema: {
      tags: ["Contacts"],
      summary: "Get one contact by id",
      params: contactSchemas.idParams,
    },
    handler: getContactHandler,
  });

  server.put(CONTACT.UPDATE, {
    schema: {
      tags: ["Contacts"],
      summary: "Update a contact in cdp.customer_profile + identity_keys",
      params: contactSchemas.idParams,
      body: contactSchemas.updateBody,
    },
    handler: updateContactHandler,
  });

  server.delete(CONTACT.DELETE, {
    schema: {
      tags: ["Contacts"],
      summary: "Soft-delete a contact (is_active=false)",
      params: contactSchemas.idParams,
    },
    handler: deleteContactHandler,
  });
}
