import type { FastifyInstance } from "fastify";
import {
  handlePublicWebPushConfig,
  handlePublicWebPushSubscribe,
} from "./public-routes.js";

/** Contract alias: POST /api/v1/push/subscribe (My Accounts snippet / SDK). */
export default async function webPushV1Routes(server: FastifyInstance) {
  server.get("/config", handlePublicWebPushConfig);
  server.post("/subscribe", handlePublicWebPushSubscribe);
}
