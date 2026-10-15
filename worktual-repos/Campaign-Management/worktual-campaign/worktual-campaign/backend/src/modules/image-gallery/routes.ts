import type { FastifyInstance } from "fastify";
import { validateSession } from "../../middlewares/authendication.js";
import {
  archiveImageGalleryHandler,
  listImageGalleryHandler,
  registerImageGalleryHandler,
} from "./handler.js";

export default async function imageGalleryRoutes(server: FastifyInstance) {
  server.addHook("preValidation", validateSession);

  server.get("/", {
    schema: {
      tags: ["Image Gallery"],
      summary: "List reusable org images (Image Gallery)",
    },
    handler: listImageGalleryHandler,
  });

  server.post("/register", {
    schema: {
      tags: ["Image Gallery"],
      summary: "Register a media URL in the org Image Gallery (idempotent)",
    },
    handler: registerImageGalleryHandler,
  });

  server.patch("/:id/archive", {
    schema: {
      tags: ["Image Gallery"],
      summary: "Archive an image from the gallery",
    },
    handler: archiveImageGalleryHandler,
  });
}
