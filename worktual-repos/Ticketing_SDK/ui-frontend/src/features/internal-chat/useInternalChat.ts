import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { internalChatApi } from './api';
import type {
  InternalChatDirectoryUser,
  InternalChatMe,
  InternalChatMessage,
  InternalChatRoom,
} from './types';

function localId() {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function keepReply(
  incoming: InternalChatMessage,
  existing?: InternalChatMessage
): Pick<InternalChatMessage, 'replyTo' | 'replyToId'> {
  const replyTo = incoming.replyTo || existing?.replyTo || null;
  const replyToId = incoming.replyToId || incoming.replyTo?.id || existing?.replyToId || existing?.replyTo?.id || null;
  return { replyTo, replyToId };
}

function mergeMessage(list: InternalChatMessage[], incoming: InternalChatMessage) {
  const existingIdx = list.findIndex((m) => m.id === incoming.id);
  if (existingIdx >= 0) {
    const next = [...list];
    next[existingIdx] = {
      ...next[existingIdx],
      ...incoming,
      ...keepReply(incoming, next[existingIdx]),
      localStatus: undefined,
    };
    return next;
  }
  const pendingIdx = list.findIndex(
    (m) =>
      m.id.startsWith('local-') &&
      m.senderId === incoming.senderId &&
      m.body === incoming.body
  );
  const pending = pendingIdx >= 0 ? list[pendingIdx] : undefined;
  const merged = { ...incoming, ...keepReply(incoming, pending) };
  const without = pendingIdx >= 0 ? list.filter((_, i) => i !== pendingIdx) : list;
  return [...without, merged].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
}

function sameId(a: string | number | null | undefined, b: string | number | null | undefined) {
  return String(a ?? '') !== '' && String(a) === String(b);
}

function laterIso(a?: string | null, b?: string | null): string | null {
  const at = a ? Date.parse(a) : NaN;
  const bt = b ? Date.parse(b) : NaN;
  if (Number.isFinite(at) && Number.isFinite(bt)) return at >= bt ? a! : b!;
  if (Number.isFinite(at)) return a || null;
  if (Number.isFinite(bt)) return b || null;
  return null;
}

function mergeRoomLists(
  server: InternalChatRoom[],
  local: InternalChatRoom[]
): InternalChatRoom[] {
  const prev = new Map(local.map((room) => [room.id, room]));
  return server.map((room) => {
    const existing = prev.get(room.id);
    if (!existing) return room;
    return {
      ...room,
      members: room.members.map((member) => {
        const prior = existing.members.find((row) => sameId(row.id, member.id));
        return {
          ...member,
          lastReadAt: laterIso(member.lastReadAt, prior?.lastReadAt),
          typingAt: member.typingAt || null,
        };
      }),
    };
  });
}

function withReply(
  saved: InternalChatMessage,
  replyTo?: InternalChatMessage['replyTo'] | null
): InternalChatMessage {
  return {
    ...saved,
    replyTo: saved.replyTo || replyTo || null,
    replyToId: saved.replyToId || saved.replyTo?.id || replyTo?.id || null,
  };
}

function adoptServerMessages(
  server: InternalChatMessage[],
  local: InternalChatMessage[] | undefined,
  remembered: Record<string, NonNullable<InternalChatMessage['replyTo']>>
): InternalChatMessage[] {
  const localById = new Map((local || []).map((row) => [row.id, row]));
  const adopted = server.map((row) => {
    const merged = { ...row, ...keepReply(row, localById.get(row.id)) };
    const memory = remembered[merged.id];
    if (!merged.replyTo && memory) {
      return { ...merged, replyTo: memory, replyToId: memory.id };
    }
    if (merged.replyTo?.id) remembered[merged.id] = merged.replyTo;
    return merged;
  });
  const pending = (local || []).filter(
    (row) =>
      row.id.startsWith('local-') &&
      !adopted.some((m) => m.body === row.body && m.senderId === row.senderId)
  );
  return [...adopted, ...pending].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );
}

type Args = {
  dmUserId?: string | null;
  onDmConsumed?: () => void;
  onUnreadChange?: (unread: number) => void;
};

export function useInternalChat({ dmUserId, onDmConsumed, onUnreadChange }: Args) {
  const [me, setMe] = useState<InternalChatMe | null>(null);
  const [rooms, setRooms] = useState<InternalChatRoom[]>([]);
  const [directory, setDirectory] = useState<InternalChatDirectoryUser[]>([]);
  const [groupDirectory, setGroupDirectory] = useState<InternalChatDirectoryUser[]>([]);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [messagesByRoom, setMessagesByRoom] = useState<Record<string, InternalChatMessage[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unreadTotal, setUnreadTotal] = useState(0);
  const [typingByRoom, setTypingByRoom] = useState<
    Record<string, Array<{ id: string; name: string }>>
  >({});
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selectedRoomId;
  const meRef = useRef('');
  meRef.current = me?.id || '';
  const typingPingAt = useRef(0);
  const typingTimers = useRef<Record<string, number>>({});
  const autoSelected = useRef(false);
  const rememberedReplies = useRef<Record<string, NonNullable<InternalChatMessage['replyTo']>>>({});
  const selectRoomRef = useRef<(roomId: string) => Promise<void>>(async () => undefined);
  const unreadCb = useRef(onUnreadChange);
  unreadCb.current = onUnreadChange;

  const selectedRoom = useMemo(
    () => rooms.find((r) => r.id === selectedRoomId) || null,
    [rooms, selectedRoomId]
  );
  const messages = selectedRoomId ? messagesByRoom[selectedRoomId] || [] : [];

  const refreshRooms = useCallback(async () => {
    const next = await internalChatApi.rooms();
    setRooms((prev) => mergeRoomLists(next, prev));
    const total = next.reduce((sum, room) => sum + (room.unread || 0), 0);
    setUnreadTotal(total);
    unreadCb.current?.(total);
    return next;
  }, []);

  const selectRoom = useCallback(
    async (roomId: string) => {
      setSelectedRoomId(roomId);
      setRooms((prev) =>
        prev.map((room) => (room.id === roomId ? { ...room, unread: 0 } : room))
      );
      try {
        await internalChatApi.markRead(roomId);
        const msgs = await internalChatApi.messages(roomId, { limit: 50 });
        setMessagesByRoom((prev) => ({
          ...prev,
          [roomId]: adoptServerMessages(msgs, prev[roomId], rememberedReplies.current),
        }));
        await refreshRooms();
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [refreshRooms]
  );
  selectRoomRef.current = selectRoom;

  const clearRoomSelection = useCallback(() => {
    setSelectedRoomId(null);
  }, []);

  const loadBootstrap = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const boot = await internalChatApi.bootstrap();
      setMe(boot.me);
      setDirectory(boot.directory);
      setRooms(boot.rooms);
      setMessagesByRoom((prev) => {
        const recent = boot.recent || {};
        const next: Record<string, InternalChatMessage[]> = {};
        const ids = new Set([...Object.keys(recent), ...Object.keys(prev)]);
        ids.forEach((id) => {
          next[id] = adoptServerMessages(recent[id] || [], prev[id], rememberedReplies.current);
        });
        return next;
      });
      setUnreadTotal(boot.unreadTotal || 0);
      unreadCb.current?.(boot.unreadTotal || 0);
      const group = await internalChatApi.members(true).catch(() => boot.directory);
      setGroupDirectory(group);
      if (!autoSelected.current && !dmUserId && boot.rooms[0]) {
        autoSelected.current = true;
        void selectRoomRef.current(boot.rooms[0].id);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [dmUserId]);

  useEffect(() => {
    void loadBootstrap();
  }, [loadBootstrap]);

  useEffect(() => {
    if (!dmUserId) return;
    let cancelled = false;
    void internalChatApi
      .openDm(dmUserId)
      .then(async ({ room }) => {
        if (cancelled) return;
        await refreshRooms();
        await selectRoom(room.id);
        onDmConsumed?.();
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [dmUserId, onDmConsumed, refreshRooms, selectRoom]);

  useEffect(() => {
    void internalChatApi.presence().catch(() => undefined);
    const beat = window.setInterval(() => {
      void internalChatApi.presence().catch(() => undefined);
    }, 30_000);
    return () => window.clearInterval(beat);
  }, []);

  useEffect(() => {
    const poll = window.setInterval(() => {
      void internalChatApi
        .unreadCount()
        .then((row) => {
          setUnreadTotal(row.unread);
          unreadCb.current?.(row.unread);
        })
        .catch(() => undefined);
    }, 30_000);
    return () => window.clearInterval(poll);
  }, []);

  useEffect(() => {
    const source = new EventSource('/api/internal-chat/stream', { withCredentials: true });
    const onCreated = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data) as { roomId: string; message: InternalChatMessage };
        setMessagesByRoom((prev) => ({
          ...prev,
          [data.roomId]: mergeMessage(prev[data.roomId] || [], data.message),
        }));
        if (selectedRef.current === data.roomId) {
          void internalChatApi.markRead(data.roomId).catch(() => undefined);
          setRooms((prev) =>
            prev.map((room) => (room.id === data.roomId ? { ...room, unread: 0 } : room))
          );
        } else if (data.message.senderId && !sameId(data.message.senderId, meRef.current)) {
          setRooms((prev) =>
            prev.map((room) =>
              room.id === data.roomId ? { ...room, unread: (room.unread || 0) + 1 } : room
            )
          );
        }
        void refreshRooms();
      } catch {
        /* ignore */
      }
    };
    const onUpdated = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data) as { roomId: string; message: InternalChatMessage };
        setMessagesByRoom((prev) => ({
          ...prev,
          [data.roomId]: mergeMessage(prev[data.roomId] || [], data.message),
        }));
        void refreshRooms();
      } catch {
        /* ignore */
      }
    };
    const onDeleted = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data) as { roomId: string; messageId: string };
        setMessagesByRoom((prev) => ({
          ...prev,
          [data.roomId]: (prev[data.roomId] || []).filter((m) => m.id !== data.messageId),
        }));
        void refreshRooms();
      } catch {
        /* ignore */
      }
    };
    const onRoom = () => {
      void refreshRooms();
    };
    const onRead = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data) as {
          roomId: string;
          userId: string;
          lastReadAt: string;
        };
        setRooms((prev) =>
          prev.map((room) =>
            room.id !== data.roomId
              ? room
              : {
                  ...room,
                  members: room.members.map((member) =>
                    sameId(member.id, data.userId)
                      ? { ...member, lastReadAt: data.lastReadAt, typingAt: null }
                      : member
                  ),
                }
          )
        );
        setTypingByRoom((prev) => ({
          ...prev,
          [data.roomId]: (prev[data.roomId] || []).filter((row) => row.id !== data.userId),
        }));
      } catch {
        /* ignore */
      }
    };
    const onTyping = (ev: MessageEvent) => {
      try {
        const data = JSON.parse(ev.data) as {
          roomId: string;
          userId: string;
          userName: string;
          typing: boolean;
        };
        if (sameId(data.userId, meRef.current)) return;
        const timerKey = `${data.roomId}:${data.userId}`;
        if (typingTimers.current[timerKey]) {
          window.clearTimeout(typingTimers.current[timerKey]);
          delete typingTimers.current[timerKey];
        }
        setTypingByRoom((prev) => {
          const current = prev[data.roomId] || [];
          const next = data.typing
            ? [
                ...current.filter((row) => row.id !== data.userId),
                { id: data.userId, name: data.userName || 'Staff' },
              ]
            : current.filter((row) => row.id !== data.userId);
          return { ...prev, [data.roomId]: next };
        });
        if (data.typing) {
          typingTimers.current[timerKey] = window.setTimeout(() => {
            setTypingByRoom((prev) => ({
              ...prev,
              [data.roomId]: (prev[data.roomId] || []).filter((row) => row.id !== data.userId),
            }));
            delete typingTimers.current[timerKey];
          }, 5000);
        }
      } catch {
        /* ignore */
      }
    };
    source.addEventListener('internal_chat.message.created', onCreated as EventListener);
    source.addEventListener('internal_chat.message.updated', onUpdated as EventListener);
    source.addEventListener('internal_chat.message.deleted', onDeleted as EventListener);
    source.addEventListener('internal_chat.room.updated', onRoom);
    source.addEventListener('internal_chat.read', onRead as EventListener);
    source.addEventListener('internal_chat.typing', onTyping as EventListener);
    source.onerror = () => {
      /* browser reconnects */
    };
    return () => source.close();
  }, [refreshRooms]);

  const startDm = useCallback(
    async (targetUserId: string) => {
      const { room } = await internalChatApi.openDm(targetUserId);
      await refreshRooms();
      await selectRoom(room.id);
      return room;
    },
    [refreshRooms, selectRoom]
  );

  const createGroup = useCallback(
    async (payload: {
      name: string;
      description: string;
      category: string;
      memberIds: string[];
      avatarStorageKey?: string;
    }) => {
      const room = await internalChatApi.createGroup(payload);
      await refreshRooms();
      await selectRoom(room.id);
      return room;
    },
    [refreshRooms, selectRoom]
  );

  const editGroup = useCallback(
    async (
      roomId: string,
      payload: {
        name?: string;
        description?: string;
        category?: string;
        avatarStorageKey?: string;
        memberIds?: string[];
      }
    ) => {
      const room = await internalChatApi.patchGroup(roomId, payload);
      if (payload.memberIds) {
        await internalChatApi.replaceMembers(roomId, payload.memberIds);
      }
      await refreshRooms();
      return room;
    },
    [refreshRooms]
  );

  const toggleFavourite = useCallback(
    async (roomId: string) => {
      await internalChatApi.toggleFavourite(roomId);
      await refreshRooms();
    },
    [refreshRooms]
  );

  const sendText = useCallback(
    async (roomId: string, body: string, replyTo?: InternalChatMessage['replyTo'] | null) => {
      const clientId = localId();
      const pending: InternalChatMessage = {
        id: clientId,
        clientId,
        roomId,
        senderId: me?.id || '',
        senderName: me?.name || '',
        body,
        type: 'text',
        createdAt: new Date().toISOString(),
        editedAt: null,
        voiceDurationMs: null,
        voiceUrl: null,
        ticket: null,
        attachments: [],
        replyTo: replyTo || null,
        replyToId: replyTo?.id || null,
        localStatus: 'pending',
      };
      setMessagesByRoom((prev) => ({
        ...prev,
        [roomId]: [...(prev[roomId] || []), pending],
      }));
      try {
        const saved = withReply(
          await internalChatApi.sendMessage(roomId, {
            body,
            replyToId: replyTo?.id,
          }),
          replyTo
        );
        if (saved.replyTo?.id) rememberedReplies.current[saved.id] = saved.replyTo;
        setMessagesByRoom((prev) => ({
          ...prev,
          [roomId]: mergeMessage(
            (prev[roomId] || []).filter((m) => m.id !== clientId),
            saved
          ),
        }));
        await refreshRooms();
      } catch (err) {
        setMessagesByRoom((prev) => ({
          ...prev,
          [roomId]: (prev[roomId] || []).map((m) =>
            m.id === clientId ? { ...m, localStatus: 'failed' } : m
          ),
        }));
        throw err;
      }
    },
    [me, refreshRooms]
  );

  const sendFiles = useCallback(
    async (
      roomId: string,
      files: File[],
      caption: string,
      replyTo?: InternalChatMessage['replyTo'] | null
    ) => {
      const clientId = localId();
      const pending: InternalChatMessage = {
        id: clientId,
        clientId,
        roomId,
        senderId: me?.id || '',
        senderName: me?.name || '',
        body: caption,
        type: caption.trim() ? 'text' : 'attachment_bundle',
        createdAt: new Date().toISOString(),
        editedAt: null,
        voiceDurationMs: null,
        voiceUrl: null,
        ticket: null,
        attachments: files.map((f, i) => ({
          id: `${clientId}-${i}`,
          name: f.name,
          contentType: f.type || (/\.(png|jpe?g|gif|webp|bmp)$/i.test(f.name) ? 'image/png' : ''),
          size: f.size,
          url: URL.createObjectURL(f),
        })),
        replyTo: replyTo || null,
        replyToId: replyTo?.id || null,
        localStatus: 'pending',
      };
      setMessagesByRoom((prev) => ({
        ...prev,
        [roomId]: [...(prev[roomId] || []), pending],
      }));
      try {
        const attachments = [];
        for (const file of files) {
          attachments.push(await internalChatApi.uploadFile(roomId, file));
        }
        const saved = withReply(
          await internalChatApi.sendMessage(roomId, {
            body: caption,
            attachments,
            replyToId: replyTo?.id,
          }),
          replyTo
        );
        if (saved.replyTo?.id) rememberedReplies.current[saved.id] = saved.replyTo;
        pending.attachments.forEach((att) => {
          if (att.url.startsWith('blob:')) URL.revokeObjectURL(att.url);
        });
        setMessagesByRoom((prev) => ({
          ...prev,
          [roomId]: mergeMessage(
            (prev[roomId] || []).filter((m) => m.id !== clientId),
            saved
          ),
        }));
        await refreshRooms();
      } catch (err) {
        setMessagesByRoom((prev) => ({
          ...prev,
          [roomId]: (prev[roomId] || []).map((m) =>
            m.id === clientId ? { ...m, localStatus: 'failed' } : m
          ),
        }));
        throw err;
      }
    },
    [me, refreshRooms]
  );

  const sendVoice = useCallback(
    async (
      roomId: string,
      file: File,
      durationMs: number,
      replyTo?: InternalChatMessage['replyTo'] | null
    ) => {
      const clientId = localId();
      const pending: InternalChatMessage = {
        id: clientId,
        clientId,
        roomId,
        senderId: me?.id || '',
        senderName: me?.name || '',
        body: '',
        type: 'voice',
        createdAt: new Date().toISOString(),
        editedAt: null,
        voiceDurationMs: durationMs,
        voiceUrl: null,
        ticket: null,
        attachments: [],
        replyTo: replyTo || null,
        replyToId: replyTo?.id || null,
        localStatus: 'pending',
      };
      setMessagesByRoom((prev) => ({
        ...prev,
        [roomId]: [...(prev[roomId] || []), pending],
      }));
      try {
        const uploaded = await internalChatApi.uploadFile(roomId, file);
        const saved = withReply(
          await internalChatApi.sendMessage(roomId, {
            type: 'voice',
            voiceKey: uploaded.storageKey,
            voiceDurationMs: durationMs,
            replyToId: replyTo?.id,
          }),
          replyTo
        );
        if (saved.replyTo?.id) rememberedReplies.current[saved.id] = saved.replyTo;
        setMessagesByRoom((prev) => ({
          ...prev,
          [roomId]: mergeMessage(
            (prev[roomId] || []).filter((m) => m.id !== clientId),
            saved
          ),
        }));
        await refreshRooms();
      } catch (err) {
        setMessagesByRoom((prev) => ({
          ...prev,
          [roomId]: (prev[roomId] || []).map((m) =>
            m.id === clientId ? { ...m, localStatus: 'failed' } : m
          ),
        }));
        throw err;
      }
    },
    [me, refreshRooms]
  );

  const retryFailed = useCallback(
    async (message: InternalChatMessage) => {
      if (message.type === 'voice') return;
      if (message.attachments.length) return;
      await sendText(message.roomId, message.body, message.replyTo);
      setMessagesByRoom((prev) => ({
        ...prev,
        [message.roomId]: (prev[message.roomId] || []).filter((m) => m.id !== message.id),
      }));
    },
    [sendText]
  );

  const editText = useCallback(async (messageId: string, body: string) => {
    const saved = await internalChatApi.editMessage(messageId, body);
    setMessagesByRoom((prev) => ({
      ...prev,
      [saved.roomId]: mergeMessage(prev[saved.roomId] || [], saved),
    }));
    await refreshRooms();
  }, [refreshRooms]);

  const togglePin = useCallback(async (messageId: string) => {
    const saved = await internalChatApi.pinMessage(messageId);
    setMessagesByRoom((prev) => ({
      ...prev,
      [saved.roomId]: mergeMessage(prev[saved.roomId] || [], saved),
    }));
  }, []);

  const removeMessage = useCallback(async (messageId: string) => {
    const result = await internalChatApi.deleteMessage(messageId);
    setMessagesByRoom((prev) => ({
      ...prev,
      [result.roomId]: (prev[result.roomId] || []).filter((m) => m.id !== messageId),
    }));
    await refreshRooms();
  }, [refreshRooms]);

  const uploadAvatar = useCallback((file: File) => internalChatApi.uploadAvatar(file), []);

  const typingBeat = useRef<number>(0);

  useEffect(() => {
    return () => {
      if (typingBeat.current) window.clearInterval(typingBeat.current);
    };
  }, []);

  const notifyTyping = useCallback((roomId: string, typing: boolean) => {
    if (!roomId) return;
    if (typing) {
      const now = Date.now();
      if (now - typingPingAt.current >= 500) {
        typingPingAt.current = now;
        void internalChatApi.setTyping(roomId, true).catch(() => undefined);
      }
      if (!typingBeat.current) {
        typingBeat.current = window.setInterval(() => {
          const open = selectedRef.current;
          if (!open) return;
          void internalChatApi.setTyping(open, true).catch(() => undefined);
        }, 2000);
      }
      return;
    }
    typingPingAt.current = 0;
    if (typingBeat.current) {
      window.clearInterval(typingBeat.current);
      typingBeat.current = 0;
    }
    void internalChatApi.setTyping(roomId, false).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!selectedRoomId) return;
    const tick = window.setInterval(() => {
      void refreshRooms();
    }, 2500);
    return () => window.clearInterval(tick);
  }, [selectedRoomId, refreshRooms]);

  const typers = useMemo(() => {
    const fromSse = selectedRoomId ? typingByRoom[selectedRoomId] || [] : [];
    const fromRoom = (selectedRoom?.members || [])
      .filter((member) => {
        if (sameId(member.id, meRef.current)) return false;
        if (!member.typingAt) return false;
        const at = Date.parse(member.typingAt);
        return Number.isFinite(at) && Date.now() - at < 5000;
      })
      .map((member) => ({ id: member.id, name: member.name }));
    const byId = new Map<string, { id: string; name: string }>();
    [...fromSse, ...fromRoom].forEach((row) => byId.set(String(row.id), row));
    return [...byId.values()];
  }, [selectedRoom, selectedRoomId, typingByRoom]);

  return {
    me,
    rooms,
    directory,
    groupDirectory,
    selectedRoom,
    selectedRoomId,
    messages,
    loading,
    error,
    setError,
    unreadTotal,
    selectRoom,
    clearRoomSelection,
    startDm,
    createGroup,
    editGroup,
    toggleFavourite,
    sendText,
    sendFiles,
    sendVoice,
    retryFailed,
    editText,
    removeMessage,
    togglePin,
    refreshRooms,
    reload: loadBootstrap,
    uploadAvatar,
    notifyTyping,
    typers,
  };
}
