import jwt from "@fastify/jwt";
import fp from "fastify-plugin";
import { UnauthorizedError } from "../helpers/errors.js";
import { DefaultAuthService } from "../modules/auth/service.js";
import type { AuthPrincipal } from "../modules/auth/types.js";

export default fp(
  async (app) => {
    await app.register(jwt, {
      secret: app.config.JWT_SECRET,
      sign: { iss: app.config.JWT_ISSUER, aud: app.config.JWT_AUDIENCE },
      verify: {
        allowedIss: app.config.JWT_ISSUER,
        allowedAud: app.config.JWT_AUDIENCE,
      },
    });

    const authService = new DefaultAuthService();
    app.decorateRequest("principal", null);
    app.decorate("authenticate", async (request) => {
      const authorization = request.headers.authorization;
      const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
      if (!token) throw new UnauthorizedError();

      try {
        const principal = await request.jwtVerify<AuthPrincipal>();
        request.principal = { ...principal, tokenKind: "jwt" };
      } catch {
        request.principal = await authService.verifyLegacyBearer(token);
        if (!request.principal)
          throw new UnauthorizedError("Invalid or expired bearer token");
      }
    });
  },
  { name: "auth" },
);
