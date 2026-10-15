import type { FastifyInstance } from "fastify";
import { validateSession } from "../../middlewares/authendication.js";
import {
  createRegulatedTemplateHandler,
  deleteRegulatedTemplateHandler,
  listRegulatedTemplatesHandler,
  refreshWhatsAppStatusHandler,
  sendRegulatedTemplateHandler,
  setRegulatedStatusHandler,
  smsConfigReadyHandler,
  submitWhatsAppApprovalHandler,
  syncMetaWhatsAppTemplatesHandler,
  updateRegulatedTemplateHandler,
  whatsappConfigReadyHandler,
} from "./handler.js";
import {
  bumpLibraryTemplateUsedHandler,
  createLibraryTemplateHandler,
  deleteLibraryTemplateHandler,
  getLibraryTemplateHandler,
  listLibraryTemplatesHandler,
  updateLibraryTemplateHandler,
} from "./library-handler.js";
import {
  getGalleryStatusHandler,
  postGalleryBootstrapHandler,
} from "./gallery-handler.js";

/**
 * Regulated SMS / WhatsApp approval templates + marketing library templates.
 * WhatsApp: submit + poll via social-service. SMS: manual status + configured send.
 */
export default async function templateRoutes(server: FastifyInstance) {
  server.addHook("preValidation", validateSession);

  server.get("/library", {
    schema: {
      tags: ["Library Templates"],
      summary: "List Template Gallery rows (generated + user uploads)",
    },
    handler: listLibraryTemplatesHandler,
  });

  server.post("/gallery/bootstrap", {
    schema: {
      tags: ["Library Templates"],
      summary: "Queue automatic Template Gallery bootstrap for this org",
    },
    handler: postGalleryBootstrapHandler,
  });

  server.get("/gallery/status", {
    schema: {
      tags: ["Library Templates"],
      summary: "Template Gallery bootstrap job status",
    },
    handler: getGalleryStatusHandler,
  });

  server.get("/library/:id", {
    schema: {
      tags: ["Library Templates"],
      summary: "Get one marketing library template",
    },
    handler: getLibraryTemplateHandler,
  });

  server.post("/library", {
    schema: {
      tags: ["Library Templates"],
      summary: "Create / upload a marketing library template for this org",
    },
    handler: createLibraryTemplateHandler,
  });

  server.patch("/library/:id", {
    schema: {
      tags: ["Library Templates"],
      summary: "Update a marketing library template",
    },
    handler: updateLibraryTemplateHandler,
  });

  server.delete("/library/:id", {
    schema: {
      tags: ["Library Templates"],
      summary: "Delete a marketing library template",
    },
    handler: deleteLibraryTemplateHandler,
  });

  server.post("/library/:id/use", {
    schema: {
      tags: ["Library Templates"],
      summary: "Increment used_count for a library template",
    },
    handler: bumpLibraryTemplateUsedHandler,
  });

  server.get("/regulated", {
    schema: {
      tags: ["Regulated Templates"],
      summary: "List SMS / WhatsApp approval templates",
    },
    handler: listRegulatedTemplatesHandler,
  });

  server.get("/regulated/whatsapp/ready", {
    schema: {
      tags: ["Regulated Templates"],
      summary: "Check if WhatsApp channel config exists (no UUID returned)",
    },
    handler: whatsappConfigReadyHandler,
  });

  server.post("/regulated/whatsapp/sync-meta", {
    schema: {
      tags: ["Regulated Templates"],
      summary:
        "Sync Meta WhatsApp templates into Pending / Approved / Rejected library sections",
    },
    handler: syncMetaWhatsAppTemplatesHandler,
  });

  server.get("/regulated/sms/ready", {
    schema: {
      tags: ["Regulated Templates"],
      summary: "Check if SMS channel is configured for send",
    },
    handler: smsConfigReadyHandler,
  });

  server.post("/regulated", {
    schema: {
      tags: ["Regulated Templates"],
      summary: "Create SMS or WhatsApp template (draft or SMS approved upload)",
    },
    handler: createRegulatedTemplateHandler,
  });

  server.patch("/regulated/:id", {
    schema: {
      tags: ["Regulated Templates"],
      summary: "Update a draft template (locked after submit)",
    },
    handler: updateRegulatedTemplateHandler,
  });

  server.delete("/regulated/:id", {
    schema: {
      tags: ["Regulated Templates"],
      summary: "Delete a regulated template",
    },
    handler: deleteRegulatedTemplateHandler,
  });

  server.post("/regulated/:id/status", {
    schema: {
      tags: ["Regulated Templates"],
      summary: "Manually set SMS template status (pending/approved/rejected)",
    },
    handler: setRegulatedStatusHandler,
  });

  server.post("/regulated/:id/submit-approval", {
    schema: {
      tags: ["Regulated Templates"],
      summary: "Submit WhatsApp template to Meta via social-service",
    },
    handler: submitWhatsAppApprovalHandler,
  });

  server.post("/regulated/:id/refresh-status", {
    schema: {
      tags: ["Regulated Templates"],
      summary: "Poll Meta approval status for a WhatsApp template",
    },
    handler: refreshWhatsAppStatusHandler,
  });

  server.post("/regulated/:id/send", {
    schema: {
      tags: ["Regulated Templates"],
      summary:
        "Send an approved SMS or WhatsApp template to phones and/or selected contacts",
    },
    handler: sendRegulatedTemplateHandler,
  });
}
