import type { FastifyInstance } from "fastify";
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
export declare const jwtPlugin: (app: FastifyInstance) => Promise<void>;
