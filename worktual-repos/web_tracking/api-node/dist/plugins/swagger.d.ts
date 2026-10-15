import type { FastifyInstance } from "fastify";
/** Register OpenAPI spec generation — must run before routes. */
export declare const swaggerOpenApiPlugin: (app: FastifyInstance) => Promise<void>;
/** Register Swagger UI — must run after all routes are registered. */
export declare const swaggerUiPlugin: (app: FastifyInstance) => Promise<void>;
