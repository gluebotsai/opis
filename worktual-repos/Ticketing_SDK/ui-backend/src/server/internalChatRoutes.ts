import fs from "fs";
import path from "path";
import type { Express, NextFunction, Request, RequestHandler, Response } from "express";
import multer from "multer";
import type { AuthUser } from "../types";
import {
  addInternalChatSseClient,
  bootstrapInternalChat,
  buildStorageKey,
  createGroup,
  deleteMessage,
  editMessage,
  getAttachmentForMember,
  getRoom,
  getRoomAvatarForMember,
  getVoiceForMember,
  heartbeatPresence,
  inferAttachmentContentType,
  InternalChatError,
  internalChatUploadRoot,
  listDirectory,
  listMessages,
  listRooms,
  markRead,
  openDm,
  setTyping,
  patchGroup,
  postMessage,
  replaceMembers,
  togglePinnedMessage,
  resolveUploadPath,
  toggleFavourite,
  unreadTotal,
} from "./internalChat";

type AuthedRequest = Request & { user?: AuthUser };

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, _file, cb) => {
      const orgId = String((req as AuthedRequest).user?.organizationId || "pending");
      const roomId = String(req.params.roomId || `pending/${(req as AuthedRequest).user?.id || "anon"}`);
      const dest = path.join(internalChatUploadRoot(), orgId, roomId, "tmp");
      fs.mkdirSync(dest, { recursive: true });
      cb(null, dest);
    },
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
      cb(null, `${Date.now()}-${safe}`);
    },
  }),
  limits: { fileSize: 25 * 1024 * 1024 },
});

function fail(res: Response, err: unknown) {
  if (err instanceof InternalChatError) {
    return res.status(err.status).json({ error: err.message });
  }
  if ((err as { code?: string }).code === "LIMIT_FILE_SIZE") {
    return res.status(400).json({ error: "File must be 25 MB or smaller." });
  }
  console.error(err);
  return res.status(500).json({ error: "Internal chat request failed." });
}

function actor(req: AuthedRequest) {
  const user = req.user;
  if (!user) throw new InternalChatError(401, "Authentication required");
  return {
    orgId: user.organizationId,
    userId: user.id,
    role: user.role,
    name: user.name,
  };
}

function streamFile(
  res: Response,
  abs: string,
  contentType: string,
  opts?: { inline?: boolean; fileName?: string }
) {
  if (!fs.existsSync(abs)) {
    res.status(404).json({ error: "File not found." });
    return;
  }
  const fileName = String(opts?.fileName || path.basename(abs)).replace(/"/g, "");
  const inline = opts?.inline !== false;
  res.setHeader("Content-Type", contentType || "application/octet-stream");
  res.setHeader(
    "Content-Disposition",
    `${inline ? "inline" : "attachment"}; filename="${fileName}"`
  );
  fs.createReadStream(abs).pipe(res);
}

export function registerInternalChatRoutes(
  app: Express,
  requireAuth: RequestHandler,
  requireModule: (module: string) => RequestHandler
): void {
  const gate = [requireAuth, requireModule("internal-chat")];

  app.get("/api/internal-chat/bootstrap", ...gate, async (req: AuthedRequest, res) => {
    try {
      const { orgId, userId, role, name } = actor(req);
      res.json(await bootstrapInternalChat(orgId, userId, role, name));
    } catch (err) {
      fail(res, err);
    }
  });

  app.get("/api/internal-chat/unread-count", ...gate, async (req: AuthedRequest, res) => {
    try {
      const { orgId, userId, role } = actor(req);
      res.json({ unread: await unreadTotal(orgId, userId, role) });
    } catch (err) {
      fail(res, err);
    }
  });

  app.get("/api/internal-chat/rooms", ...gate, async (req: AuthedRequest, res) => {
    try {
      const { orgId, userId, role } = actor(req);
      res.json(await listRooms(orgId, userId, role));
    } catch (err) {
      fail(res, err);
    }
  });

  app.get("/api/internal-chat/members", ...gate, async (req: AuthedRequest, res) => {
    try {
      const { orgId, userId } = actor(req);
      const forGroup = String(req.query.for || "") === "group";
      res.json(await listDirectory(orgId, userId, forGroup));
    } catch (err) {
      fail(res, err);
    }
  });

  app.post("/api/internal-chat/dm", ...gate, async (req: AuthedRequest, res) => {
    try {
      const { orgId, userId } = actor(req);
      const target = String(req.body?.targetUserId || "").trim();
      res.json(await openDm(orgId, userId, target));
    } catch (err) {
      fail(res, err);
    }
  });

  app.post("/api/internal-chat/rooms", ...gate, async (req: AuthedRequest, res) => {
    try {
      const { orgId, userId, role } = actor(req);
      const room = await createGroup(orgId, userId, role, {
        name: req.body?.name,
        description: req.body?.description,
        category: req.body?.category,
        memberIds: Array.isArray(req.body?.memberIds) ? req.body.memberIds : [],
        avatarStorageKey: req.body?.avatarStorageKey,
      });
      res.status(201).json(room);
    } catch (err) {
      fail(res, err);
    }
  });

  app.patch("/api/internal-chat/rooms/:roomId", ...gate, async (req: AuthedRequest, res) => {
    try {
      const { orgId, userId, role } = actor(req);
      res.json(
        await patchGroup(
          orgId,
          userId,
          String(req.params.roomId),
          {
            name: req.body?.name,
            description: req.body?.description,
            category: req.body?.category,
            avatarStorageKey: req.body?.avatarStorageKey,
          },
          role
        )
      );
    } catch (err) {
      fail(res, err);
    }
  });

  app.put("/api/internal-chat/rooms/:roomId/members", ...gate, async (req: AuthedRequest, res) => {
    try {
      const { orgId, userId, role } = actor(req);
      res.json(
        await replaceMembers(
          orgId,
          userId,
          String(req.params.roomId),
          Array.isArray(req.body?.memberIds) ? req.body.memberIds : [],
          role
        )
      );
    } catch (err) {
      fail(res, err);
    }
  });

  app.get("/api/internal-chat/rooms/:roomId/messages", ...gate, async (req: AuthedRequest, res) => {
    try {
      const { orgId, userId, role } = actor(req);
      res.json(
        await listMessages(orgId, userId, String(req.params.roomId), {
          before: req.query.before ? String(req.query.before) : undefined,
          limit: req.query.limit ? Number(req.query.limit) : undefined,
          actorRole: role,
        })
      );
    } catch (err) {
      fail(res, err);
    }
  });

  app.post("/api/internal-chat/rooms/:roomId/messages", ...gate, async (req: AuthedRequest, res) => {
    try {
      const { orgId, userId, role } = actor(req);
      const message = await postMessage(
        orgId,
        userId,
        String(req.params.roomId),
        {
          body: req.body?.body,
          type: req.body?.type,
          voiceKey: req.body?.voiceKey,
          voiceDurationMs: req.body?.voiceDurationMs,
          attachments: Array.isArray(req.body?.attachments) ? req.body.attachments : [],
          replyToId: req.body?.replyToId ?? req.body?.reply_to_id ?? null,
        },
        role
      );
      res.status(201).json(message);
    } catch (err) {
      fail(res, err);
    }
  });

  app.patch("/api/internal-chat/messages/:messageId", ...gate, async (req: AuthedRequest, res) => {
    try {
      const { orgId, userId, role } = actor(req);
      res.json(
        await editMessage(orgId, userId, String(req.params.messageId), req.body?.body, role)
      );
    } catch (err) {
      fail(res, err);
    }
  });

  app.post("/api/internal-chat/messages/:messageId/pin", ...gate, async (req: AuthedRequest, res) => {
    try {
      const { orgId, userId, role } = actor(req);
      res.json(await togglePinnedMessage(orgId, userId, String(req.params.messageId), role));
    } catch (err) {
      fail(res, err);
    }
  });

  app.delete("/api/internal-chat/messages/:messageId", ...gate, async (req: AuthedRequest, res) => {
    try {
      const { orgId, userId, role } = actor(req);
      res.json(await deleteMessage(orgId, userId, String(req.params.messageId), role));
    } catch (err) {
      fail(res, err);
    }
  });

  app.post("/api/internal-chat/rooms/:roomId/read", ...gate, async (req: AuthedRequest, res) => {
    try {
      const { orgId, userId, role } = actor(req);
      await markRead(orgId, userId, String(req.params.roomId), role);
      res.json({ ok: true });
    } catch (err) {
      fail(res, err);
    }
  });

  app.post("/api/internal-chat/rooms/:roomId/typing", ...gate, async (req: AuthedRequest, res) => {
    try {
      const { orgId, userId, role } = actor(req);
      await setTyping(
        orgId,
        userId,
        String(req.params.roomId),
        req.body?.typing !== false,
        role
      );
      res.json({ ok: true });
    } catch (err) {
      fail(res, err);
    }
  });

  app.post("/api/internal-chat/rooms/:roomId/favourite", ...gate, async (req: AuthedRequest, res) => {
    try {
      const { orgId, userId, role } = actor(req);
      res.json(await toggleFavourite(orgId, userId, String(req.params.roomId), role));
    } catch (err) {
      fail(res, err);
    }
  });

  const saveUpload = async (req: AuthedRequest, res: Response, roomId: string) => {
    const { orgId, userId, role } = actor(req);
    if (roomId && !roomId.startsWith("pending/")) {
      const room = await getRoom(orgId, userId, roomId, role);
      if (!room) throw new InternalChatError(403, "Not a member of this conversation.");
    }
    const file = req.file;
    if (!file) throw new InternalChatError(400, "file is required");
    const key = buildStorageKey(orgId, roomId || `pending/${userId}`, file.originalname);
    const dest = resolveUploadPath(key);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.renameSync(file.path, dest);
    return {
      storageKey: key,
      fileName: file.originalname,
      contentType: inferAttachmentContentType(
        file.originalname,
        file.mimetype
      ),
      byteSize: file.size,
    };
  };

  app.post(
    "/api/internal-chat/rooms/:roomId/uploads",
    ...gate,
    upload.single("file"),
    async (req: AuthedRequest, res) => {
      try {
        const saved = await saveUpload(req, res, String(req.params.roomId));
        res.status(201).json(saved);
      } catch (err) {
        fail(res, err);
      }
    }
  );

  app.post(
    "/api/internal-chat/avatar-upload",
    ...gate,
    upload.single("file"),
    async (req: AuthedRequest, res) => {
      try {
        const { userId } = actor(req);
        const saved = await saveUpload(req, res, `pending/${userId}`);
        res.status(201).json({ storageKey: saved.storageKey });
      } catch (err) {
        fail(res, err);
      }
    }
  );

  app.post("/api/internal-chat/presence", ...gate, async (req: AuthedRequest, res) => {
    try {
      const { orgId, userId } = actor(req);
      await heartbeatPresence(orgId, userId);
      res.json({ ok: true });
    } catch (err) {
      fail(res, err);
    }
  });

  app.get("/api/internal-chat/stream", ...gate, async (req: AuthedRequest, res) => {
    try {
      const { orgId } = actor(req);
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders?.();
      res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);
      const remove = addInternalChatSseClient(orgId, res);
      const ping = setInterval(() => {
        try {
          res.write(`event: ping\ndata: ${JSON.stringify({ t: Date.now() })}\n\n`);
        } catch {
          /* closed */
        }
      }, 25_000);
      req.on("close", () => {
        clearInterval(ping);
        remove();
      });
    } catch (err) {
      fail(res, err);
    }
  });

  app.get("/api/internal-chat/files/:attachmentId", ...gate, async (req: AuthedRequest, res) => {
    try {
      const { orgId, userId, role } = actor(req);
      const file = await getAttachmentForMember(
        orgId,
        userId,
        String(req.params.attachmentId),
        role
      );
      const download =
        String(req.query.download || "") === "1" ||
        String(req.query.download || "") === "true";
      streamFile(
        res,
        resolveUploadPath(file.storageKey),
        inferAttachmentContentType(file.fileName, file.contentType),
        {
          inline: !download,
          fileName: file.fileName,
        }
      );
    } catch (err) {
      fail(res, err);
    }
  });

  app.get("/api/internal-chat/messages/:messageId/voice", ...gate, async (req: AuthedRequest, res) => {
    try {
      const { orgId, userId, role } = actor(req);
      const file = await getVoiceForMember(orgId, userId, String(req.params.messageId), role);
      streamFile(res, resolveUploadPath(file.storageKey), "audio/webm", {
        inline: true,
        fileName: "voice.webm",
      });
    } catch (err) {
      fail(res, err);
    }
  });

  app.get("/api/internal-chat/room-avatars/:roomId", ...gate, async (req: AuthedRequest, res) => {
    try {
      const { orgId, userId, role } = actor(req);
      const file = await getRoomAvatarForMember(orgId, userId, String(req.params.roomId), role);
      streamFile(res, resolveUploadPath(file.storageKey), "image/jpeg", {
        inline: true,
        fileName: "avatar.jpg",
      });
    } catch (err) {
      fail(res, err);
    }
  });

}

export function internalChatMulterError(
  err: unknown,
  _req: Request,
  res: Response,
  next: NextFunction
) {
  if (err) return fail(res, err);
  next();
}
