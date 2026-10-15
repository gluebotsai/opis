import fp from "fastify-plugin";
import { env } from "../config/env.js";
export const jwtPlugin = fp(async function jwtPlugin(app) {
    await app.register(import("@fastify/jwt"), {
        secret: env.API_SECRET_KEY,
        sign: { expiresIn: `${env.JWT_EXPIRE_MINUTES}m`, algorithm: env.JWT_ALGORITHM },
    });
    app.decorate("authenticate", async (request) => {
        const query = request.query;
        if (!request.headers.authorization && typeof query?.token === "string" && query.token.trim()) {
            request.headers.authorization = `Bearer ${query.token.trim()}`;
        }
        await request.jwtVerify();
        const payload = request.user;
        request.admin = {
            id: Number(payload.sub),
            email: payload.email,
            organization_id: payload.organization_id ?? null,
            website_id: payload.website_id,
            website_url: payload.website_url,
        };
    });
});
