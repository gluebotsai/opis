import { createServer } from "node:http";
import type { FastifyInstance } from "fastify";
import { Server as SocketIOServer } from "socket.io";
import { env } from "../config/env.js";

/**
 * Attach Socket.IO on a dedicated SOCKET_PORT (default 3002) for host/DevOps
 * publishing, and also on the API server so same-origin / local proxies keep working.
 * Call after `app.listen()`.
 */
export function attachSocketIO(app: FastifyInstance): SocketIOServer {
  const io = new SocketIOServer({
    cors: {
      origin: [
        ...env.corsOrigins,
        ...(env.nodeEnv === "production"
          ? []
          : ["http://localhost:5500", "http://127.0.0.1:5500"]),
      ],
      methods: ["GET", "POST"],
    },
    path: "/socket-io",
  });

  io.attach(app.server);

  const socketPort = env.socketPort;
  if (
    Number.isFinite(socketPort) &&
    socketPort > 0 &&
    socketPort !== env.port
  ) {
    const socketHttp = createServer();
    io.attach(socketHttp);
    socketHttp.listen(socketPort, env.host, () => {
      app.log.info(
        { host: env.host, port: socketPort, path: "/socket-io" },
        "Campaign Socket.IO listening on dedicated port",
      );
    });
  }

  io.on("connection", (socket) => {
    socket.emit("connected", { ok: true, service: "campaign" });
    socket.on("ping", () => {
      socket.emit("pong", { at: new Date().toISOString() });
    });
  });

  return io;
}
