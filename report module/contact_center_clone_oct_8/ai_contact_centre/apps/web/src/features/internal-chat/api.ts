import { apiV1 } from "@/config/api-paths";
import { env } from "@/config/env";
import { ccCoreHttp } from "@/services/http";

import type {
  InternalChatCreateGroupPayload,
  InternalChatMember,
  InternalChatMessage,
  InternalChatRoom,
  InternalChatState,
  InternalChatUpdateGroupPayload,
} from "./types";

export type InternalChatSendPayload = {
  body?: string;
  attachments?: Array<{
    storageKey: string;
    fileName: string;
    contentType: string;
    byteSize: number;
    checksumSha256?: string;
  }>;
  voiceDurationMs?: number;
  voiceStorageKey?: string;
};

export type InternalChatUploadResult = {
  storageKey: string;
  fileName: string;
  contentType: string;
  byteSize: number;
  checksumSha256: string;
};

function mediaPath(pathOrUrl: string): string {
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
    return normalizeInternalChatMediaPath(new URL(pathOrUrl).pathname);
  }
  return normalizeInternalChatMediaPath(
    pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`,
  );
}

/** Strip gateway prefix so ccCoreHttp base URL is not duplicated. */
export function normalizeInternalChatMediaPath(path: string): string {
  const stripped = path.replace(/^\/cc-core-api/, "").replace(/\/{2,}/g, "/");
  return stripped.startsWith("/") ? stripped : `/${stripped}`;
}

export async function fetchInternalChatBlobUrl(pathOrUrl: string): Promise<string> {
  const { data } = await ccCoreHttp.get<Blob>(mediaPath(pathOrUrl), {
    responseType: "blob",
  });
  return URL.createObjectURL(data);
}

export async function downloadInternalChatAttachment(
  attachment: { name: string; previewUrl?: string },
): Promise<void> {
  if (!attachment.previewUrl) return;

  let objectUrl = attachment.previewUrl;
  let shouldRevoke = false;

  if (!objectUrl.startsWith("blob:")) {
    objectUrl = await fetchInternalChatBlobUrl(objectUrl);
    shouldRevoke = true;
  }

  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = attachment.name;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  if (shouldRevoke) {
    URL.revokeObjectURL(objectUrl);
  }
}

export function resolveInternalChatMediaUrl(pathOrUrl: string): string {
  if (pathOrUrl.startsWith("blob:")) return pathOrUrl;
  if (pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")) {
    return pathOrUrl;
  }
  const path = normalizeInternalChatMediaPath(
    pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`,
  );
  return `${env.ccCoreUrl.replace(/\/$/, "")}${path}`;
}

export const internalChatApi = {
  async listRooms(): Promise<InternalChatRoom[]> {
    const { data } = await ccCoreHttp.get<{ rooms: InternalChatRoom[] }>(
      apiV1("/internal-chat/rooms"),
    );
    return data.rooms;
  },

  async bootstrap(): Promise<InternalChatState> {
    const { data } = await ccCoreHttp.get<InternalChatState>(apiV1("/internal-chat/bootstrap"));
    return data;
  },

  async listMembers(): Promise<InternalChatMember[]> {
    const { data } = await ccCoreHttp.get<{ members: InternalChatMember[] }>(
      apiV1("/internal-chat/members"),
    );
    return data.members;
  },

  async markRoomRead(roomId: string): Promise<string> {
    const { data } = await ccCoreHttp.post<{ lastReadAt: string }>(
      apiV1(`/internal-chat/rooms/${roomId}/read`),
    );
    return data.lastReadAt;
  },

  async sendMessage(roomId: string, payload: InternalChatSendPayload): Promise<InternalChatMessage> {
    const { data } = await ccCoreHttp.post<{ message: InternalChatMessage }>(
      apiV1(`/internal-chat/rooms/${roomId}/messages`),
      payload,
    );
    return data.message;
  },

  async createGroup(
    payload: InternalChatCreateGroupPayload & { avatarStorageKey?: string },
  ): Promise<InternalChatRoom> {
    const { data } = await ccCoreHttp.post<{ room: InternalChatRoom }>(
      apiV1("/internal-chat/rooms"),
      {
        name: payload.name,
        description: payload.description,
        category: payload.category,
        memberIds: payload.memberIds,
        avatarStorageKey: payload.avatarStorageKey,
      },
    );
    return data.room;
  },

  async createDm(targetUserId: string): Promise<InternalChatRoom> {
    const { data } = await ccCoreHttp.post<{ room: InternalChatRoom }>(
      apiV1("/internal-chat/dm"),
      { targetUserId },
    );
    return data.room;
  },

  async renameRoom(roomId: string, name: string): Promise<InternalChatRoom> {
    const { data } = await ccCoreHttp.patch<{ room: InternalChatRoom }>(
      apiV1(`/internal-chat/rooms/${roomId}`),
      { name },
    );
    return data.room;
  },

  async updateGroup(
    roomId: string,
    payload: Pick<
      InternalChatUpdateGroupPayload,
      "name" | "description" | "category" | "avatarStorageKey"
    >,
  ): Promise<InternalChatRoom> {
    const { data } = await ccCoreHttp.patch<{ room: InternalChatRoom }>(
      apiV1(`/internal-chat/rooms/${roomId}`),
      {
        name: payload.name,
        description: payload.description,
        category: payload.category,
        ...(payload.avatarStorageKey !== undefined
          ? { avatarStorageKey: payload.avatarStorageKey }
          : {}),
      },
    );
    return data.room;
  },

  async updateGroupMembers(roomId: string, memberIds: string[]): Promise<void> {
    await ccCoreHttp.put(apiV1(`/internal-chat/rooms/${roomId}/members`), { memberIds });
  },

  async uploadAvatar(file: File): Promise<InternalChatUploadResult> {
    const form = new FormData();
    form.append("file", file);
    const { data } = await ccCoreHttp.post<InternalChatUploadResult>(
      apiV1("/internal-chat/avatar-upload"),
      form,
      { headers: { "Content-Type": "multipart/form-data" } },
    );
    return data;
  },

  async uploadRoomFile(roomId: string, file: File): Promise<InternalChatUploadResult> {
    const form = new FormData();
    form.append("file", file);
    const { data } = await ccCoreHttp.post<InternalChatUploadResult>(
      apiV1(`/internal-chat/rooms/${roomId}/uploads`),
      form,
      { headers: { "Content-Type": "multipart/form-data" } },
    );
    return data;
  },
};
