import type { Queue } from "bullmq";
import type Redis from "ioredis";
import type { Pool } from "pg";
import type { Server as SocketIOServer } from "socket.io";
import type { AppEnv } from "../config/env.js";
import type { QueuePayloadMap } from "../jobs/types.js";
import type { AuthPrincipal } from "../modules/auth/types.js";
import type { RlsTransaction } from "../plugins/postgres.js";

declare module "fastify" {
  interface FastifyInstance {
    config: AppEnv;
    pg: Pool;
    withRlsTransaction: RlsTransaction;
    redis: Redis | null;
    queues:
      | {
          [K in keyof QueuePayloadMap]: Queue<
            QueuePayloadMap[K],
            unknown,
            string
          >;
        }
      | null;
    io: SocketIOServer;
    authenticate: (request: FastifyRequest) => Promise<void>;
  }

  interface FastifyRequest {
    principal: AuthPrincipal | null;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: AuthPrincipal;
    user: AuthPrincipal;
  }
}
