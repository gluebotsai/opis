export type InternalChatMemberRole = "admin" | "member";

export type InternalChatPresence = "ready" | "not_ready" | "offline";

export type InternalChatRoomType = "group" | "dm";

export type InternalChatRoomTab = "all" | "unread" | "groups" | "favourite";

export type InternalChatGroupCategory =
  | "supervision"
  | "shift_handover"
  | "escalations"
  | "training"
  | "general";

export type InternalChatCreateGroupPayload = {
  name: string;
  description: string;
  category: InternalChatGroupCategory;
  memberIds: string[];
  avatarStorageKey?: string;
  /** Local file selected in the create-group dialog before upload. */
  avatarFile?: File;
};

export type InternalChatUpdateGroupPayload = {
  name: string;
  description: string;
  category: InternalChatGroupCategory;
  memberIds: string[];
  avatarStorageKey?: string | null;
  avatarFile?: File;
  removeAvatar?: boolean;
};

export type InternalChatMember = {
  userId: string;
  name: string;
  role: InternalChatMemberRole;
  title?: string;
  presence: InternalChatPresence;
};

export type InternalChatAttachment = {
  name: string;
  sizeBytes: number;
  mimeType?: string;
  /** Mock-only blob URL for image previews until backend storage exists. */
  previewUrl?: string;
};

export type InternalChatMessage = {
  id: string;
  roomId: string;
  senderUserId: string;
  body: string;
  createdAt: string;
  attachments?: InternalChatAttachment[];
  voiceDurationMs?: number;
  /** Mock-only blob URL for voice playback until backend storage exists. */
  voiceAudioUrl?: string;
};

export type InternalChatPendingMessage = {
  id: string;
  roomId: string;
  senderUserId: string;
  body: string;
  createdAt: string;
  attachments?: InternalChatAttachment[];
  status: "uploading" | "failed";
  error?: string;
};

export type InternalChatRoom = {
  id: string;
  type: InternalChatRoomType;
  name: string;
  description?: string;
  category?: InternalChatGroupCategory;
  /** Mock-only blob URL for custom group photo until backend storage exists. */
  avatarUrl?: string;
  memberIds: string[];
  createdByUserId: string;
  createdAt: string;
  lastMessageAt?: string;
  lastMessagePreview?: string;
  /** Per-viewer read cursor (mock only). */
  lastReadAt?: string;
  /** Mock favourite flag for sidebar filtering. */
  favourite?: boolean;
};

export type InternalChatState = {
  members: InternalChatMember[];
  rooms: InternalChatRoom[];
  messages: InternalChatMessage[];
  currentUserId: string;
};
