import { apiFetchInit } from '../../config/embedAuth';
import type {
  InternalChatBootstrap,
  InternalChatDirectoryUser,
  InternalChatMessage,
  InternalChatRoom,
} from './types';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, apiFetchInit(init));
  if (!res.ok) {
    let message = `Request failed (${res.status})`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

function jsonInit(method: string, body?: unknown): RequestInit {
  return {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
}

export const internalChatApi = {
  bootstrap: () => request<InternalChatBootstrap>('/api/internal-chat/bootstrap'),
  unreadCount: () => request<{ unread: number }>('/api/internal-chat/unread-count'),
  rooms: () => request<InternalChatRoom[]>('/api/internal-chat/rooms'),
  members: (forGroup = false) =>
    request<InternalChatDirectoryUser[]>(
      `/api/internal-chat/members${forGroup ? '?for=group' : ''}`
    ),
  openDm: (targetUserId: string) =>
    request<{ roomId: string; room: InternalChatRoom }>(
      '/api/internal-chat/dm',
      jsonInit('POST', { targetUserId })
    ),
  createGroup: (payload: {
    name: string;
    description: string;
    category: string;
    memberIds: string[];
    avatarStorageKey?: string;
  }) => request<InternalChatRoom>('/api/internal-chat/rooms', jsonInit('POST', payload)),
  patchGroup: (
    roomId: string,
    payload: {
      name?: string;
      description?: string;
      category?: string;
      avatarStorageKey?: string;
      memberIds?: string[];
    }
  ) =>
    request<InternalChatRoom>(
      `/api/internal-chat/rooms/${encodeURIComponent(roomId)}`,
      jsonInit('PATCH', payload)
    ),
  replaceMembers: (roomId: string, memberIds: string[]) =>
    request<InternalChatRoom>(
      `/api/internal-chat/rooms/${encodeURIComponent(roomId)}/members`,
      jsonInit('PUT', { memberIds })
    ),
  messages: (roomId: string, opts?: { before?: string; limit?: number }) => {
    const q = new URLSearchParams();
    if (opts?.before) q.set('before', opts.before);
    if (opts?.limit) q.set('limit', String(opts.limit));
    const suffix = q.toString() ? `?${q}` : '';
    return request<InternalChatMessage[]>(
      `/api/internal-chat/rooms/${encodeURIComponent(roomId)}/messages${suffix}`
    );
  },
  sendMessage: (
    roomId: string,
    payload: {
      body?: string;
      type?: string;
      voiceKey?: string;
      voiceDurationMs?: number;
      attachments?: Array<{
        storageKey: string;
        fileName: string;
        contentType: string;
        byteSize: number;
      }>;
      replyToId?: string;
    }
  ) =>
    request<InternalChatMessage>(
      `/api/internal-chat/rooms/${encodeURIComponent(roomId)}/messages`,
      jsonInit('POST', payload)
    ),
  editMessage: (messageId: string, body: string) =>
    request<InternalChatMessage>(
      `/api/internal-chat/messages/${encodeURIComponent(messageId)}`,
      jsonInit('PATCH', { body })
    ),
  pinMessage: (messageId: string) =>
    request<InternalChatMessage>(
      `/api/internal-chat/messages/${encodeURIComponent(messageId)}/pin`,
      jsonInit('POST', {})
    ),
  deleteMessage: (messageId: string) =>
    request<{ roomId: string; messageId: string }>(
      `/api/internal-chat/messages/${encodeURIComponent(messageId)}`,
      jsonInit('DELETE')
    ),
  markRead: (roomId: string) =>
    request<{ ok: boolean }>(
      `/api/internal-chat/rooms/${encodeURIComponent(roomId)}/read`,
      jsonInit('POST', {})
    ),
  setTyping: (roomId: string, typing: boolean) =>
    request<{ ok: boolean }>(
      `/api/internal-chat/rooms/${encodeURIComponent(roomId)}/typing`,
      jsonInit('POST', { typing })
    ),
  toggleFavourite: (roomId: string) =>
    request<{ favourite: boolean }>(
      `/api/internal-chat/rooms/${encodeURIComponent(roomId)}/favourite`,
      jsonInit('POST', {})
    ),
  presence: () => request<{ ok: boolean }>('/api/internal-chat/presence', jsonInit('POST', {})),
  uploadFile: async (roomId: string, file: File) => {
    const body = new FormData();
    body.append('file', file);
    return request<{
      storageKey: string;
      fileName: string;
      contentType: string;
      byteSize: number;
    }>(`/api/internal-chat/rooms/${encodeURIComponent(roomId)}/uploads`, {
      method: 'POST',
      body,
    });
  },
  uploadAvatar: async (file: File) => {
    const body = new FormData();
    body.append('file', file);
    return request<{ storageKey: string }>('/api/internal-chat/avatar-upload', {
      method: 'POST',
      body,
    });
  },
};
