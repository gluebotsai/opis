import type { FastifyInstance, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { env } from "../config/env.js";

export interface JwtPayload {
  sub: string;
  email: string;
  organization_id: number | null;
  website_id: number;
  website_url: string;
}

declare module "fastify" {
  interface FastifyInstance {
    authenticate: (request: FastifyRequest) => Promise<void>;
  }
  interface FastifyRequest {
    admin: {
      id: number;
      email: string;
      organization_id: number | null;
      website_id: number;
      website_url: string;
    };
  }
}

export const jwtPlugin = fp(async function jwtPlugin(app: FastifyInstance) {
  await app.register(import("@fastify/jwt"), {
    secret: env.API_SECRET_KEY,
    sign: { expiresIn: `${env.JWT_EXPIRE_MINUTES}m`, algorithm: env.JWT_ALGORITHM as "HS256" },
  });

  app.decorate("authenticate", async (request: FastifyRequest) => {
    const query = request.query as { token?: string };
    if (!request.headers.authorization && typeof query?.token === "string" && query.token.trim()) {
      request.headers.authorization = `Bearer ${query.token.trim()}`;
    }
    await request.jwtVerify();
    const payload = request.user as JwtPayload;
    request.admin = {
      id: Number(payload.sub),
      email: payload.email,
      organization_id: payload.organization_id ?? null,
      website_id: payload.website_id,
      website_url: payload.website_url,
    };
  });
});
