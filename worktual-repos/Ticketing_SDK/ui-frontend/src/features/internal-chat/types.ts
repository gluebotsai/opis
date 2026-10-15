export type InternalChatMe = {
  id: string;
  name: string;
  role: string;
  teamName: string;
  online: boolean;
};

export type InternalChatDirectoryUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  teamName: string;
  online: boolean;
};

export type InternalChatRoomMember = {
  id: string;
  name: string;
  email: string;
  role: string;
  roomRole: 'admin' | 'member';
  lastReadAt: string | null;
  favourite: boolean;
  online?: boolean;
  typingAt?: string | null;
};

export type InternalChatRoom = {
  id: string;
  type: 'dm' | 'group';
  name: string;
  description: string;
  category: string | null;
  avatarKey: string | null;
  avatarUrl: string | null;
  createdById: string | null;
  updatedAt: string;
  roomRole: 'admin' | 'member';
  favourite: boolean;
  lastPreview: string;
  lastMessageAt: string | null;
  unread: number;
  members: InternalChatRoomMember[];
  peerId?: string;
  peerOnline?: boolean;
};

export type InternalChatTicket = {
  id: string;
  number: string;
  subject: string;
};

export type InternalChatAttachment = {
  id: string;
  name: string;
  contentType: string;
  size: number;
  url: string;
};

export type InternalChatReplyTo = {
  id: string;
  senderName: string;
  body: string;
};

export type InternalChatMessage = {
  id: string;
  roomId: string;
  senderId: string;
  senderName: string;
  body: string;
  type: 'text' | 'attachment_bundle' | 'voice';
  createdAt: string;
  editedAt: string | null;
  voiceDurationMs: number | null;
  voiceUrl: string | null;
  ticket: InternalChatTicket | null;
  attachments: InternalChatAttachment[];
  replyToId?: string | null;
  replyTo?: InternalChatReplyTo | null;
  pinnedAt?: string | null;
  localStatus?: 'pending' | 'failed';
  clientId?: string;
};

export type InternalChatBootstrap = {
  me: InternalChatMe;
  directory: InternalChatDirectoryUser[];
  rooms: InternalChatRoom[];
  recent: Record<string, InternalChatMessage[]>;
  unreadTotal: number;
};

export const GROUP_CATEGORIES = [
  'Supervision',
  'Shift handover',
  'Escalations',
  'Training',
  'General',
] as const;

export const TICKET_TOKEN_RE = /#(\d+)\b|\bWT-?(\d+)\b/gi;
