import { PrismaClient } from "@prisma/client";
import type { FastifyInstance } from "fastify";
declare module "fastify" {
    interface FastifyInstance {
        prisma: AppPrismaClient;
    }
}
/** App code types against PrismaClient; read-only mode uses $extends at runtime. */
export type AppPrismaClient = PrismaClient;
export declare const prismaPlugin: (app: FastifyInstance) => Promise<void>;
