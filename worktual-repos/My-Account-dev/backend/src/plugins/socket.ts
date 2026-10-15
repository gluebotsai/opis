import { createAdapter } from "@socket.io/redis-adapter";
import fp from "fastify-plugin";
import { Server } from "socket.io";

export default fp(
  async (app) => {
    const io = new Server(app.server, {
      path: app.config.SOCKET_IO_PATH,
      cors: {
        origin: app.config.CORS_ORIGINS.split(",").map((origin) =>
          origin.trim(),
        ),
      },
    });

    if (app.redis) {
      const publisher = app.redis.duplicate();
      const subscriber = app.redis.duplicate();
      await Promise.all([publisher.connect(), subscriber.connect()]);
      io.adapter(createAdapter(publisher, subscriber));
      app.addHook("onClose", async () => {
        await Promise.all([publisher.quit(), subscriber.quit()]);
      });
    }

    io.use((socket, next) => {
      const token =
        socket.handshake.auth["token"] ??
        socket.handshake.headers.authorization?.replace(/^Bearer\s+/i, "");
      if (!token || typeof token !== "string") {
        next(new Error("Authentication required"));
        return;
      }
      try {
        socket.data["principal"] = app.jwt.verify(token);
        next();
      } catch {
        next(new Error("Invalid authentication token"));
      }
    });

    app.decorate("io", io);
    app.addHook("onClose", async () => io.close());
  },
  { name: "socket", dependencies: ["redis", "auth"] },
);
