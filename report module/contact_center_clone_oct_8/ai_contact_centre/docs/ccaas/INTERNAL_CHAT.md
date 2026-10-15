# Internal Chat

Internal Chat is team messaging for Contact Center **admins** and **agents**. It is isolated from customer conversations (workspace inbox, WhatsApp, webchat, and other customer channels). People in the same organization message each other in **direct messages (DMs)** and **groups**.

| Surface | Path |
|---------|------|
| Admin portal | `/admin/team-chat` |
| Agent portal | `/agent/team-chat` |

Both routes render the same page (`TeamChatPage`). Layout, APIs, and sockets are shared. Role only changes **what you can create and edit**.

---

## Who can use it

- Signed-in Contact Center users (organization entitlement `contact-center`).
- Admins cannot open `/agent/*`; agents cannot open `/admin/*`. Each role uses its own Internal Chat URL.
- You only see rooms you currently belong to (`left_at` is null). You cannot read another room’s messages, files, or avatars.

---

## Admin vs agent

| Capability | Admin | Agent |
|------------|-------|-------|
| Open Internal Chat from the sidebar | Yes | Yes |
| Search, filter, and open rooms | Yes | Yes |
| Start a **New chat** (DM) with any teammate | Yes | Yes |
| Send text, emoji, files, and voice notes | Yes | Yes |
| View group members (read-only) | Yes | Yes |
| Create a **New group** | Yes | No (button hidden; API returns 403) |
| Edit group name, description, category, avatar, members | Yes (pencil on group header) | No |
| Deep-link from Live Monitoring → DM an agent | Yes (`/admin/team-chat?dm=<userId>`) | N/A (monitoring is admin-only) |

### Two different “admin” meanings

1. **Product role** (`admin` / `agent`) — login role. Gates the New group button and the edit-group pencil.
2. **Room membership role** (`admin` / `member`) — stored per room. The user who **creates** a group is the room admin. Rename, update, and member changes require this room role on the server.

A product admin who is only a **member** of someone else’s group will see Edit in the UI but get **403** from the API.

---

## What each role can do day to day

### Admin

1. Open **Internal Chat** in the admin sidebar.
2. **New chat** — pick any active teammate (agent or another admin) and open or reuse a 1:1 DM.
3. **New group** — name, description (min 10 characters), category, optional photo, and one or more **agents**. The creating admin is always a member and the room admin. Other product admins cannot be added from this dialog.
4. Group categories: Supervision, Shift handover, Escalations, Training, General.
5. Edit an existing group (pencil): same fields plus add/remove agents. Soft-remove sets `left_at`; re-adding clears it.
6. From **Live Monitoring** → agent detail → message icon: jump to Internal Chat with `?dm=<agentUserId>` and open (or create) that DM.

### Agent

1. Open **Internal Chat** in the agent sidebar.
2. See only rooms they belong to (groups an admin added them to, plus their DMs).
3. **New chat** with any teammate, including admins.
4. Chat, attach files, send voice notes, view group member lists.
5. Cannot create or edit groups. Empty state if they have no rooms: “You are not in any chats yet.”

---

## Screen layout (both roles)

Two panes (stacked on small screens, side-by-side from `xl`):

**Left — room list**

- Current user avatar, name, team title, presence dot.
- **New chat** (both roles). **New group** (admin only).
- Search by room name or last-message preview.
- Tabs: All, Unread, Groups, Favourite.
- Each row: avatar, display name, last preview, relative time, unread badge.
- DMs show the other person’s presence. Groups show the group photo or initials.

**Right — thread**

- Header: name, presence (DM) or member count + info (group), edit pencil (admin + group).
- Bubbles: incoming vs outgoing. Groups show sender name on incoming messages.
- Composer: text, emoji, file attach, voice record (pause / resume / send / discard).

Selecting a room marks it read (`POST .../read`).

---

## Room types

### Direct message (`dm`)

- Exactly two users. Canonical pair `(user_low_id, user_high_id)` so the same pair always reuses one room.
- Either side can start it. You cannot DM yourself.
- Both members get room role `member`.
- Display name is the other person’s name, not the stored room name.

### Group (`group`)

- Created only by a product admin.
- Members: creating admin + selected agents (`role === member` in the org directory).
- Creator is room `admin`; others are room `member`.
- Optional avatar stored on disk; served only to current members.

---

## Messaging

A message must have at least one of: text body, attachments, or a voice note.

| Type | When | Preview in the list |
|------|------|---------------------|
| `text` | Body only | Message text |
| `attachment_bundle` | One or more files | Comma-separated file names |
| `voice` | Voice note (`voiceDurationMs` + storage key) | `🎤 Voice message` |

Limits:

- Text up to 20,000 characters.
- Upload part size **25 MB**.
- Images preview in-thread; other files download via authenticated blob URLs.

Sending a message also updates the sender’s `last_read_at` and the room’s `updated_at`. Failed sends stay in the thread as a failed bubble.

---

## Presence

Directory presence comes from `ccass.agent_presence`:

| Agent presence | Chat value | UI |
|----------------|------------|-----|
| `ready` | `ready` | Online (green) |
| anything else except offline | `not_ready` | Online (green) |
| `offline` / missing | `offline` | Offline (grey) |

The UI only distinguishes **Online** vs **Offline**.

Org directory = active setup users with Contact Center product access. Chat `role` is `admin` if the setup role name contains `"admin"`, otherwise `member` (agent).

---

## How the stack fits together

```
Admin / Agent browser
  TeamChatPage
    useInternalChat  →  REST  /v1/internal-chat/*
    Socket.IO         →  internal_chat.message.created
                          internal_chat.room.updated
        │
        ▼
cc-core (Fastify)
  requireContactCenter + tenant RLS
  services/internal-chat.ts
  uploads under uploads/internal-chat/ (or INTERNAL_CHAT_NFS_PATH)
        │
        ▼
PostgreSQL (ccass)
  internal_chat_rooms
  internal_chat_room_members
  internal_chat_dm_pairs
  internal_chat_messages
  internal_chat_message_attachments
```

Frontend: `apps/web/src/pages/internal-chat/TeamChatPage.tsx`  
API: `apps/cc-core/src/routes/internal-chat.ts`  
Domain: `apps/cc-core/src/services/internal-chat.ts`

Optional mock (no backend): `VITE_INTERNAL_CHAT_MOCK=1`.

---

## Access and tenancy

- HTTP: `requireContactCenter` plus `requireTenantId` (org + user).
- Queries run in organization RLS context.
- Room operations call `assertRoomAccess` (active membership) except group metadata/members, which also call `assertRoomAdmin`.
- Files, voice, and avatars are re-checked for membership before bytes are returned. There are no public media URLs.
- Socket connect uses the JWT. Clients join `org:{orgId}` and, when a thread is open, `internal_chat:{orgId}:{roomId}`.

---

## REST API

Base: `/v1/internal-chat` (behind the cc-core API prefix).

| Method | Path | Who | Purpose |
|--------|------|-----|---------|
| GET | `/bootstrap` | Member of org | Directory, my rooms, recent messages (up to 50 each for first 20 rooms) |
| GET | `/rooms` | Member of org | Rooms I belong to |
| POST | `/rooms` | **Product admin** | Create group |
| POST | `/dm` | Admin or agent | Get or create DM |
| PATCH | `/rooms/:roomId` | **Room admin** | Rename / update group fields |
| PUT | `/rooms/:roomId/members` | **Room admin** | Replace membership |
| GET | `/rooms/:roomId/messages` | Room member | History (`before`, `limit` ≤ 100) |
| POST | `/rooms/:roomId/messages` | Room member | Send |
| POST | `/rooms/:roomId/read` | Room member | Mark read |
| POST | `/rooms/:roomId/favourite` | Room member | Toggle favourite (API exists; UI does not call it yet) |
| GET | `/members` | Member of org | Assignable **agents** only (not self, not admins) |
| POST | `/avatar-upload` | Signed-in user | Group photo → pending storage key |
| POST | `/rooms/:roomId/uploads` | Room member | File/voice upload |
| GET | `/files/:attachmentId` | Room member | Attachment bytes |
| GET | `/messages/:messageId/voice` | Room member | Voice bytes (`audio/webm`) |
| GET | `/room-avatars/:roomId` | Room member | Group avatar |

Create-group body: `name`, `description` (≥ 10 chars), `category`, `memberIds` (≥ 1), optional `avatarStorageKey`.

---

## Realtime

After a successful send or group change, cc-core emits:

- `internal_chat.message.created` — `{ roomId, message }`
- `internal_chat.room.updated` — `{ roomId` or `roomIds, patch }`

Emitted to the room socket room **and** the org room, so the sidebar can update even if that thread is not open.

The client appends the new message (deduped by id), updates last preview/time, and patches room fields (name, members, avatar, etc.). Opening a thread emits `internal_chat.join` / `leave`.

---

## File storage

Default root: `uploads/internal-chat/`  
Override: `INTERNAL_CHAT_NFS_PATH` or `INTERNAL_CHAT_UPLOAD_ROOT`.

Keys look like `{organizationId}/{roomId}/{uuid}/{safeFileName}`. Avatars before a room exists use `pending/{userId}`. Writes are temp-file then rename.

---

## Data model (`ccass`)

| Table | Role |
|-------|------|
| `internal_chat_rooms` | `group` or `dm`; name, description, category, avatar key, creator |
| `internal_chat_room_members` | User, room role, favourite, `last_read_at`, `joined_at` / `left_at` |
| `internal_chat_dm_pairs` | Unique DM pair per org |
| `internal_chat_messages` | Body, type, voice fields, `deleted_at` |
| `internal_chat_message_attachments` | Storage key, name, type, size, checksum |

Unread: messages from others with `createdAt` after the viewer’s `last_read_at`. If there are no loaded messages but `lastMessageAt` is newer than last read, the list still shows 1 unread.

---

## Admin vs agent flows

### Start a DM

```
User clicks New chat → picks teammate
  → POST /internal-chat/dm { targetUserId }
  → existing pair reused, or new dm room + two members + dm_pairs row
  → room selected and marked read
```

Monitoring shortcut: navigate to `/admin/team-chat?dm=<userId>`. The page starts or selects that DM and strips the query param.

### Create a group (admin)

```
Admin fills dialog (agents only as members)
  optional POST /avatar-upload
  → POST /internal-chat/rooms   (403 if caller is agent)
  → creator = room admin; others = member
  → socket room.updated
```

### Send a message (both)

```
Composer
  files/voice → POST /rooms/:id/uploads
  → POST /rooms/:id/messages
  → persist + mark sender read
  → socket message.created + room.updated (preview)
```

---

## Current gaps

- **Favourite tab** is in the UI and bootstrap returns `favourite`, but the live client never calls `POST .../favourite`, so the tab stays empty unless mock data is on.
- Edit group is shown for every **product** admin in a group; the API still requires **room** admin.
- Groups cannot include other product admins as members (directory filter).
- No message edit/delete in the UI (`edited_at` / `deleted_at` exist on the table).
- Copilot / NLP coworker is not on Internal Chat.

---

## Key files

| Area | Path |
|------|------|
| Page | `apps/web/src/pages/internal-chat/TeamChatPage.tsx` |
| Panels | `apps/web/src/components/internal-chat/` |
| Client state | `apps/web/src/features/internal-chat/use-internal-chat.ts` |
| HTTP | `apps/web/src/features/internal-chat/api.ts` |
| Sockets | `apps/web/src/features/internal-chat/use-internal-chat-socket.ts` |
| Nav / DM deep link | `apps/web/src/config/navigation.tsx` |
| Routes | `apps/cc-core/src/routes/internal-chat.ts` |
| Domain | `apps/cc-core/src/services/internal-chat.ts` |
| Disk | `apps/cc-core/src/services/internal-chat-storage.ts` |
| Schema | `packages/db-cc/prisma/migrations/internal_chat_v1.sql` |
