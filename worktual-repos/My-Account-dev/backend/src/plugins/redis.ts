import fp from "fastify-plugin";
import { Redis } from "ioredis";

export default fp(
  async (app) => {
    if (!app.config.REDIS_URL) {
      app.log.warn(
        "REDIS_URL is unset; cache, queues, and cross-node sockets are disabled",
      );
      app.decorate("redis", null);
      return;
    }

    const redis = new Redis(app.config.REDIS_URL, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: true,
    });
    redis.on("error", (error: Error) =>
      app.log.error({ err: error }, "Redis error"),
    );
    await redis.connect();
    app.decorate("redis", redis);
    app.addHook("onClose", async () => redis.quit());
  },
  { name: "redis" },
);
