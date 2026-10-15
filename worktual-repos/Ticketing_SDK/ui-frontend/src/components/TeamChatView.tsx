import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  Check,
  CheckCheck,
  Download,
  Hash,
  MessageSquarePlus,
  Mic,
  MicOff,
  Paperclip,
  Pencil,
  Pin,
  Reply,
  Search,
  ArrowUp,
  Smile,
  Star,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import PageShell from './layout/PageShell';
import MenuSelect from './ui/menu-select';
import SegmentTabs from './ui/segment-tabs';
import { useSetPageTitle } from './layout/PageTitleContext';
import { useInternalChat } from '../features/internal-chat/useInternalChat';
import {
  GROUP_CATEGORIES,
  TICKET_TOKEN_RE,
  type InternalChatDirectoryUser,
  type InternalChatMessage,
  type InternalChatRoom,
  type InternalChatRoomMember,
} from '../features/internal-chat/types';
import { ticketOpenModuleForRole, type AppRole } from '../rbac';

const EMOJIS = `
😀 😃 😄 😁 😆 😅 🤣 😂 🙂 😊 😇 🥰 😍 🤩 😘 😗 ☺️ 😚 😙 🥲
😋 😛 😜 🤪 😝 🤑 🤗 🤭 🫢 🫣 🤫 🤔 🫡 🤐 🤨 😐 😑 😶 🫥 😏
😒 🙄 😬 🤥 😌 😔 😪 🤤 😴 😷 🤒 🤕 🤢 🤮 🤧 🥵 🥶 🥴 😵 🤯
🤠 🥳 🥸 😎 🤓 🧐 😕 🫤 😟 🙁 ☹️ 😮 😯 😲 😳 🥺 🥹 😦 😧 😨
😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 😈 👿 💀 ☠️
💩 🤡 👹 👺 👻 👽 👾 🤖 😺 😸 😹 😻 😼 😽 🙀 😿 😾
👋 🤚 🖐️ ✋ 🖖 🫱 🫲 🫳 🫴 👌 🤌 🤏 ✌️ 🤞 🫰 🤟 🤘 🤙 👈 👉
👆 🖕 👇 ☝️ 🫵 👍 👎 ✊ 👊 🤛 🤜 👏 🙌 🫶 👐 🤲 🤝 🙏 ✍️ 💅
🤳 💪 🦾 🦿 🦵 🦶 👂 🦻 👃 🧠 🫀 🫁 🦷 🦴 👀 👁️ 👅 👄 🫦 👶
👧 🧒 👦 👩 🧑 👨 👱 🧔 👵 🧓 👴 👲 👳 🧕 👮 👷 💂 🕵️ 🧑‍⚕️ 🧑‍🎓
👨‍🏫 👩‍⚖️ 👨‍🌾 👨‍🍳 👨‍🔧 🧑‍🏭 👨‍💼 👨‍🔬 👨‍💻 👨‍🎤 👩‍🎨 👨‍✈️ 👩‍🚀 👨‍🚒 🦸 🦹 🧙 🧚 🧛 🧜
🧝 🧞 🧟 💆 💇 🚶 🧍 🧎 🏃 💃 🕺 🕴️ 👯 🧖 🧗 🤺 🏇 ⛷️ 🏂 🏌️
🏄 🚣 🏊 ⛹️ 🏋️ 🚴 🚵 🤸 🤼 🤽 🤾 🤹 🧘 🛀 🛌 👭 👫 👬 💏 💑
👪 🗣️ 👤 👥 🫂
🐶 🐱 🐭 🐹 🐰 🦊 🐻 🐼 🐻‍❄️ 🐨 🐯 🦁 🐮 🐷 🐽 🐸 🐵 🙈 🙉 🙊
🐒 🐔 🐧 🐦 🐤 🐣 🐥 🦆 🦅 🦉 🦇 🐺 🐗 🐴 🦄 🐝 🪱 🐛 🦋 🐌
🐞 🐜 🪰 🪲 🪳 🦟 🦗 🕷️ 🦂 🐢 🐍 🦎 🦖 🦕 🐙 🦑 🦐 🦞 🦀 🐡
🐠 🐟 🐬 🐳 🐋 🦈 🐊 🐅 🐆 🦓 🦍 🦧 🦣 🐘 🦛 🦏 🐪 🐫 🦒 🦘
🦬 🐃 🐂 🐄 🐎 🐖 🐏 🐑 🦙 🐐 🦌 🐕 🐩 🦮 🐈 🪶 🐓 🦃 🦤 🦚
🦜 🦢 🦩 🕊️ 🐇 🦝 🦨 🦡 🦫 🦦 🦥 🐁 🐀 🐿️ 🦔
🌵 🎄 🌲 🌳 🌴 🪵 🌱 🌿 ☘️ 🍀 🎍 🪴 🎋 🍃 🍂 🍁 🍄 🐚 🪨 🌾
💐 🌷 🌹 🥀 🌺 🌸 🌼 🌻
🍎 🍐 🍊 🍋 🍌 🍉 🍇 🍓 🫐 🍈 🍒 🍑 🥭 🍍 🥥 🥝 🍅 🍆 🥑 🥦
🥬 🥒 🌶️ 🫑 🌽 🥕 🫒 🧄 🧅 🥔 🍠 🫘 🥐 🥯 🍞 🥖 🥨 🧀 🥚 🍳
🧈 🥞 🧇 🥓 🥩 🍗 🍖 🌭 🍔 🍟 🍕 🫓 🥪 🥙 🧆 🌮 🌯 🫔 🥗 🥘
🫕 🥫 🍝 🍜 🍲 🍛 🍣 🍱 🥟 🦪 🍤 🍙 🍚 🍘 🍥 🥠 🥮 🍢 🍡 🍧
🍨 🍦 🥧 🧁 🍰 🎂 🍮 🍭 🍬 🍫 🍿 🍩 🍪 🌰 🥜 🍯 🥛 🍼 🫖 ☕
🍵 🧃 🥤 🧋 🍶 🍺 🍻 🥂 🍷 🥃 🍸 🍹 🧉 🍾 🧊 🥄 🍴 🍽️ 🥣 🥡
🌍 🌎 🌏 🌐 🗺️ 🧭 🏔️ ⛰️ 🌋 🗻 🏕️ 🏖️ 🏜️ 🏝️ 🏞️ 🏟️ 🏛️ 🏗️ 🧱 🏘️
🏠 🏡 🏢 🏣 🏤 🏥 🏦 🏨 🏩 🏪 🏫 🏬 🏭 🏯 🏰 💒 🗼 🗽 ⛪ 🕌
🛕 🕍 ⛩️ 🕋 ⛲ ⛺ 🌁 🌃 🏙️ 🌄 🌅 🌆 🌇 🌉 ♨️ 🎠 🛝 🎡 🎢 💈
🎪 🚂 🚃 🚄 🚅 🚆 🚇 🚈 🚉 🚊 🚝 🚞 🚋 🚌 🚍 🚎 🚐 🚑 🚒 🚓
🚔 🚕 🚖 🚗 🚘 🚙 🛻 🚚 🚛 🚜 🏎️ 🏍️ 🛵 🦽 🦼 🛺 🚲 🛴 🛹 🛼
🚏 🛣️ 🛤️ 🛢️ ⛽ 🚨 🚥 🚦 🛑 🚧 ⚓ 🛟 ⛵ 🛶 🚤 🛳️ ⛴️ 🛥️ 🚢 ✈️
🛩️ 🛫 🛬 🪂 💺 🚁 🚟 🚠 🚡 🛰️ 🚀 🛸 🛎️ 🧳 ⌛ ⏳ ⌚ ⏰ ⏱️ ⏲️
🕐 🕑 🕒 🕓 🕔 🕕 🕖 🕗 🕘 🕙 🕚 🕛
🌑 🌒 🌓 🌔 🌕 🌖 🌗 🌘 🌙 🌚 🌛 🌜 🌡️ ☀️ 🌝 🌞 🪐 ⭐ 🌟 ✨
⚡ ☄️ 💥 🔥 🌪️ 🌈 ☀️ 🌤️ ⛅ 🌥️ ☁️ 🌦️ 🌧️ ⛈️ 🌩️ 🌨️ ❄️ ☃️ ⛄ 🌬️
💨 💧 💦 ☔ ☂️ 🌊 🌫️
🎃 🎄 🎆 🎇 🧨 ✨ 🎈 🎉 🎊 🎋 🎍 🎎 🎏 🎐 🎀 🎁 🎗️ 🎟️ 🎫 🎖️
🏆 🏅 🥇 🥈 🥉 ⚽ ⚾ 🥎 🏀 🏐 🏈 🏉 🎾 🥏 🎳 🏏 🏑 🏒 🥍 🏓
🏸 🥊 🥋 🥅 ⛳ ⛸️ 🎣 🤿 🎽 🎿 🛷 🥌 🎯 🪀 🪁 🎱 🔮 🪄 🧿 🎮
🕹️ 🎰 🎲 🧩 🧸 🪅 🪆 ♠️ ♥️ ♦️ ♣️ ♟️ 🃏 🀄 🎴
🔇 🔈 🔉 🔊 📢 📣 📯 🔔 🔕 🎼 🎵 🎶 🎙️ 🎚️ 🎛️ 🎤 🎧 📻 🎷 🪗
🎸 🎹 🎺 🎻 🪕 🥁 🪘
📱 📲 ☎️ 📞 📟 📠 🔋 🔌 💻 🖥️ 🖨️ ⌨️ 🖱️ 🖲️ 💽 💾 💿 📀 🧮 🎥
🎞️ 📽️ 🎬 📺 📷 📸 📹 📼 🔍 🔎 🕯️ 💡 🔦 🏮 🪔 📔 📕 📖 📗 📘
📙 📚 📓 📒 📃 📜 📄 📰 🗞️ 📑 🔖 🏷️ 💰 🪙 💴 💵 💶 💷 💸 💳
🧾 💹 ✉️ 📧 📨 📩 📤 📥 📦 📫 📪 📬 📭 📮 🗳️ ✏️ ✒️ 🖋️ 🖊️ 🖌️
🖍️ 📝 💼 📁 📂 🗂️ 📅 📆 🗒️ 🗓️ 📇 📈 📉 📊 📋 📌 📍 📎 🖇️ 📏
📐 ✂️ 🗃️ 🗄️ 🗑️ 🔒 🔓 🔏 🔐 🔑 🗝️ 🔨 🪓 ⛏️ ⚒️ 🛠️ 🗡️ ⚔️ 🔫 🪃
🏹 🛡️ 🪚 🔧 🪛 🔩 ⚙️ 🗜️ ⚖️ 🦯 🔗 ⛓️ 🪝 🧰 🧲 🪜 ⚗️ 🧪 🧫 🧬
🔬 🔭 📡 💉 🩸 💊 🩹 🩺 🚪 🛗 🪞 🪟 🛏️ 🛋️ 🪑 🚽 🪠 🚿 🛁 🪤
🪒 🧴 🧷 🧹 🧺 🧻 🪣 🧼 🫧 🪥 🧽 🧯 🛒 🚬 ⚰️ 🪦 ⚱️ 🗿 🪧
🏧 🚮 🚰 ♿ 🚹 🚺 🚻 🚼 🚾 🛂 🛃 🛄 🛅 ⚠️ 🚸 ⛔ 🚫 🚳 🚭 🚯
🚱 🚷 📵 🔞 ☢️ ☣️ ⬆️ ↗️ ➡️ ↘️ ⬇️ ↙️ ⬅️ ↖️ ↕️ ↔️ ↩️ ↪️ ⤴️ ⤵️
🔃 🔄 🔙 🔚 🔛 🔜 🔝 🛐 ⚛️ 🕉️ ✡️ ☸️ ☯️ ✝️ ☦️ ☪️ ☮️ 🕎 🔯 ♈
♉ ♊ ♋ ♌ ♍ ♎ ♏ ♐ ♑ ♒ ♓ ⛎ 🔀 🔁 🔂 ▶️ ⏩ ⏭️ ⏯️ ◀️ ⏪ ⏮️ 🔼
⏫ 🔽 ⏬ ⏸️ ⏹️ ⏺️ ⏏️ 🎦 🔅 🔆 📶 📳 📴 ♀️ ♂️ ✖️ ➕ ➖ ➗ ♾️ ‼️
⁉️ ❓ ❔ ❕ ❗ 〰️ 💱 💲 ⚕️ ♻️ ⚜️ 🔱 📛 🔰 ⭕ ✅ ☑️ ✔️ ❌ ❎ ➰
➿ 〽️ ✳️ ✴️ ❇️ ©️ ®️ ™️ #️⃣ *️⃣ 0️⃣ 1️⃣ 2️⃣ 3️⃣ 4️⃣ 5️⃣ 6️⃣ 7️⃣ 8️⃣ 9️⃣ 🔟
🔠 🔡 🔢 🔣 🔤 🅰️ 🆎 🅱️ 🆑 🆒 🆓 ℹ️ 🆔 Ⓜ️ 🆕 🆖 🅾️ 🆗 🅿️ 🆘
🆙 🆚 🈁 🈂️ 🈷️ 🈶 🈯 🉐 🈹 🈚 🈲 🉑 🈸 🈴 🈳 ㊗️ ㊙️ 🈺 🈵 🔴
🟠 🟡 🟢 🔵 🟣 🟤 ⚫ ⚪ 🟥 🟧 🟨 🟩 🟦 🟪 🟫 ⬛ ⬜ ◼️ ◻️ ◾ ◽
▪️ ▫️ 🔶 🔷 🔸 🔹 🔺 🔻 💠 🔘 🔳 🔲
🏁 🚩 🎌 🏴 🏳️ 🏳️‍🌈 🏳️‍⚧️ 🏴‍☠️
`.trim().split(/\s+/);
const AVATAR_TONES = [
  'bg-teal-100 text-teal-600',
  'bg-rose-100 text-rose-600',
  'bg-violet-100 text-violet-600',
  'bg-cyan-100 text-cyan-600',
  'bg-amber-100 text-amber-600',
  'bg-blue-100 text-blue-600',
];

function hashTone(name: string): string {
  let sum = 0;
  for (let i = 0; i < name.length; i += 1) sum += name.charCodeAt(i) * (i + 1);
  return AVATAR_TONES[sum % 97 % 6];
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}

function presenceLabel(online?: boolean): 'Available' | 'Offline' {
  return online ? 'Available' : 'Offline';
}

function staffRoleLabel(
  role?: string | null,
  roomRole?: InternalChatRoom['roomRole'] | InternalChatRoomMember['roomRole']
): 'Admin' | 'Resolver' | 'Team Lead' | 'Agent' {
  const key = String(role || '').trim().toLowerCase().replace(/[_-]+/g, ' ');
  if (key === 'admin') return 'Admin';
  if (key === 'resolver') return 'Resolver';
  if (key === 'team lead' || key === 'lead' || key === 'supervisor') return 'Team Lead';
  if (roomRole === 'admin') return 'Team Lead';
  return 'Agent';
}

function formatClock(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function replyPreviewFromMessage(message: InternalChatMessage): NonNullable<InternalChatMessage['replyTo']> {
  const text = message.body.trim();
  const body =
    message.type === 'voice'
      ? text || 'Voice note'
      : message.type === 'attachment_bundle' && !text
        ? 'Attachment'
        : text.slice(0, 180);
  return {
    id: message.id,
    senderName: message.senderName,
    body,
  };
}

function resolveReplyTo(
  message: InternalChatMessage,
  messages: InternalChatMessage[]
): InternalChatMessage['replyTo'] {
  const id = message.replyTo?.id || message.replyToId || null;
  if (!id) return message.replyTo || null;
  const parent = messages.find((row) => row.id === id);
  if (parent) return replyPreviewFromMessage(parent);
  return message.replyTo || { id, senderName: 'Staff', body: 'Original message' };
}

function ReplyQuote({
  reply,
  onClick,
}: {
  reply: NonNullable<InternalChatMessage['replyTo']>;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onClick?.();
      }}
      className="mb-2 block w-full rounded-lg border-[0.6px] border-[#bfbfbf] border-l-[3px] border-l-[#111111] bg-white px-2.5 py-1.5 text-left hover:bg-[#fafafa]"
    >
      <div className="truncate text-[11px] font-semibold text-[#171717]">{reply.senderName}</div>
      <div className="truncate text-[12px] leading-4 text-[#525252]">
        {reply.body || 'Message'}
      </div>
    </button>
  );
}

const COMPOSER_MIN_PX = 20;
const COMPOSER_MAX_PX = 192;

function syncComposerHeight(el: HTMLTextAreaElement | null): number {
  if (!el) return COMPOSER_MIN_PX;
  el.style.overflowY = 'hidden';
  el.style.height = '0px';
  const next = Math.min(Math.max(el.scrollHeight, COMPOSER_MIN_PX), COMPOSER_MAX_PX);
  el.style.height = `${next}px`;
  if (el.scrollHeight > COMPOSER_MAX_PX) el.style.overflowY = 'auto';
  return next;
}

function mentionQueryAt(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = before.match(/(^|[\s])@([^\s@]*)$/);
  if (!match) return null;
  const query = match[2] ?? '';
  return { start: before.length - query.length - 1, query };
}

function dayKey(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

function daySeparatorLabel(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startThat = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((startToday.getTime() - startThat.getTime()) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return date.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: startThat.getFullYear() === startToday.getFullYear() ? undefined : 'numeric',
  });
}

function seenByNames(
  message: InternalChatMessage,
  members: InternalChatRoom['members'] | undefined,
  selfId: string
): string[] {
  const created = new Date(message.createdAt).getTime();
  if (!Number.isFinite(created)) return [];
  return (members || [])
    .filter((member) => {
      if (String(member.id) === String(selfId) || String(member.id) === String(message.senderId)) {
        return false;
      }
      if (!member.lastReadAt) return false;
      const readAt = new Date(member.lastReadAt).getTime();
      return Number.isFinite(readAt) && readAt + 2000 >= created;
    })
    .map((member) => member.name);
}

function formatListWhen(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startThat = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((startToday.getTime() - startThat.getTime()) / 86400000);
  if (days <= 0) return formatClock(iso);
  if (days <= 6) return date.toLocaleDateString(undefined, { weekday: 'short' });
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function Avatar({
  name,
  url,
  size,
  online,
  showPresence,
}: {
  name: string;
  url?: string | null;
  size: 36 | 40 | 48;
  online?: boolean;
  showPresence?: boolean;
}) {
  const box = size === 48 ? 'h-12 w-12 text-sm' : size === 40 ? 'h-10 w-10 text-xs' : 'h-9 w-9 text-xs';
  return (
    <span className="relative shrink-0">
      {url ? (
        <img src={url} alt="" className={`${box} rounded-full object-cover`} />
      ) : (
        <span
          className={`${box} inline-flex items-center justify-center rounded-full font-semibold ${hashTone(name)}`}
        >
          {initials(name)}
        </span>
      )}
      {showPresence && (
        <span
          className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-white ${
            online ? 'bg-emerald-500' : 'bg-neutral-300'
          }`}
        />
      )}
    </span>
  );
}

function mentionTokens(body: string): string[] {
  const hits: string[] = [];
  const seen = new Set<string>();
  const re = new RegExp(TICKET_TOKEN_RE.source, 'gi');
  let match: RegExpExecArray | null;
  while ((match = re.exec(body))) {
    const digits = match[1] || match[2];
    if (digits && !seen.has(digits)) {
      seen.add(digits);
      hits.push(digits);
    }
  }
  return hits;
}

function isChatImage(att: { name?: string; contentType?: string }): boolean {
  const type = String(att.contentType || '').toLowerCase();
  if (type.startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp|bmp|heic|heif)$/i.test(String(att.name || ''));
}

function renderBody(
  body: string,
  outgoing: boolean,
  onOpenTicket: (digits: string) => void
) {
  const parts: React.ReactNode[] = [];
  const re = new RegExp(TICKET_TOKEN_RE.source, 'gi');
  let last = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = re.exec(body))) {
    if (match.index > last) parts.push(body.slice(last, match.index));
    const digits = match[1] || match[2];
    const token = match[0];
    parts.push(
      <button
        key={`${token}-${i}`}
        type="button"
        className="underline underline-offset-2"
        onClick={() => onOpenTicket(digits)}
      >
        {token}
      </button>
    );
    last = match.index + token.length;
    i += 1;
  }
  if (last < body.length) parts.push(body.slice(last));
  return <span className={outgoing ? 'text-white' : 'text-neutral-800'}>{parts}</span>;
}

type TeamChatViewProps = {
  currentUser: { id: string; name: string; role: AppRole };
  dmUserId?: string | null;
  onDmConsumed?: () => void;
  onUnreadChange?: (unread: number) => void;
  onNavigate: (view: string, opts?: { ticketSearch?: string }) => void;
  moduleResetKey?: number;
};

export default function TeamChatView({
  currentUser,
  dmUserId,
  onDmConsumed,
  onUnreadChange,
  onNavigate,
  moduleResetKey = 0,
}: TeamChatViewProps) {
  useSetPageTitle('Internal Chat');
  const chat = useInternalChat({ dmUserId, onDmConsumed, onUnreadChange });
  const handledModuleResetKey = useRef(0);
  const [tab, setTab] = useState<'all' | 'unread' | 'groups' | 'favourite'>('all');
  const [query, setQuery] = useState('');
  const [composer, setComposer] = useState('');
  const [composerExpanded, setComposerExpanded] = useState(false);
  const [mentionFilter, setMentionFilter] = useState<string | null>(null);
  const [mentionStart, setMentionStart] = useState(0);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [groupOpen, setGroupOpen] = useState<'create' | 'edit' | null>(null);
  const [membersOpen, setMembersOpen] = useState(false);
  const [imagePreview, setImagePreview] = useState<{
    url: string;
    name: string;
  } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [replyTarget, setReplyTarget] = useState<InternalChatMessage['replyTo'] | null>(null);
  const replyTargetRef = useRef<InternalChatMessage['replyTo'] | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [selecting, setSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const holdScrollRef = useRef(false);
  useEffect(() => {
    if (moduleResetKey <= handledModuleResetKey.current) return;
    handledModuleResetKey.current = moduleResetKey;
    chat.clearRoomSelection();
    setTab('all');
    setQuery('');
    setComposer('');
    setReplyTarget(null);
    setNewChatOpen(false);
    setGroupOpen(null);
    setMembersOpen(false);
    setImagePreview(null);
  }, [moduleResetKey, chat.clearRoomSelection]);

  useEffect(() => {
    if (!imagePreview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setImagePreview(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [imagePreview]);

  useEffect(() => {
    replyTargetRef.current = null;
    setReplyTarget(null);
    if (!selecting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelecting(false);
        setSelectedIds(new Set());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selecting]);

  useEffect(() => {
    replyTargetRef.current = null;
    setReplyTarget(null);
    setHighlightId(null);
    setSelecting(false);
    setSelectedIds(new Set());
    holdScrollRef.current = false;
  }, [chat.selectedRoomId]);

  useEffect(() => {
    const roomId = chat.selectedRoomId;
    return () => {
      if (roomId) chat.notifyTyping(roomId, false);
    };
  }, [chat.selectedRoomId, chat.notifyTyping]);

  const threadRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);

  const isAdmin = currentUser.role === 'admin';
  const selfId = chat.me?.id || currentUser.id;

  const exitSelect = () => {
    setSelecting(false);
    setSelectedIds(new Set());
  };

  const toggleSelected = (messageId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return next;
    });
  };

  const deleteSelected = async () => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    const label = ids.length === 1 ? 'this message' : `${ids.length} messages`;
    if (!window.confirm(`Delete ${label}?`)) return;
    for (const id of ids) {
      try {
        await chat.removeMessage(id);
        setSelectedIds((prev) => {
          const next = new Set(prev);
          next.delete(id);
          return next;
        });
      } catch (err) {
        chat.setError((err as Error).message || 'Could not delete the selected messages.');
        return;
      }
    }
    exitSelect();
  };
  const mentionable = useMemo(
    () => (chat.selectedRoom?.members || []).filter((m) => m.id !== selfId),
    [chat.selectedRoom, selfId]
  );
  const mentionHits = useMemo(() => {
    if (mentionFilter == null) return [];
    const q = mentionFilter.toLowerCase();
    return mentionable.filter((m) => {
      const hay = `${m.name} ${m.email} ${m.role}`.toLowerCase();
      return !q || hay.includes(q);
    });
  }, [mentionFilter, mentionable]);

  const applyMention = (name: string) => {
    const el = composerRef.current;
    const caret = el?.selectionStart ?? composer.length;
    const found = mentionQueryAt(composer, caret);
    const start = found?.start ?? mentionStart;
    const next = `${composer.slice(0, start)}@${name} ${composer.slice(caret)}`;
    setComposer(next);
    setMentionFilter(null);
    requestAnimationFrame(() => {
      const node = composerRef.current;
      if (!node) return;
      const pos = start + name.length + 2;
      node.focus();
      node.setSelectionRange(pos, pos);
      setComposerExpanded(syncComposerHeight(node) > 40);
    });
  };

  const refreshMention = (value: string, caret: number) => {
    const found = mentionQueryAt(value, caret);
    if (!found) {
      setMentionFilter(null);
      return;
    }
    setMentionStart(found.start);
    setMentionFilter(found.query);
    setMentionIndex(0);
  };

  const filteredRooms = useMemo(() => {
    const q = query.trim().toLowerCase();
    return chat.rooms.filter((room) => {
      if (tab === 'unread' && !(room.unread > 0)) return false;
      if (tab === 'groups' && room.type !== 'group') return false;
      if (tab === 'favourite' && !room.favourite) return false;
      if (!q) return true;
      const memberHit = room.members.some((m) => m.name.toLowerCase().includes(q));
      return (
        room.name.toLowerCase().includes(q) ||
        (room.lastPreview || '').toLowerCase().includes(q) ||
        (room.category || '').toLowerCase().includes(q) ||
        memberHit
      );
    });
  }, [chat.rooms, query, tab]);

  const tabCounts = useMemo(
    () => ({
      all: chat.rooms.length,
      unread: chat.rooms.filter((r) => r.unread > 0).length,
      groups: chat.rooms.filter((r) => r.type === 'group').length,
      favourite: chat.rooms.filter((r) => r.favourite).length,
    }),
    [chat.rooms]
  );

  useEffect(() => {
    if (holdScrollRef.current) return;
    const el = threadRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.messages.length, chat.selectedRoomId]);

  const openTicket = (digits: string) => {
    onNavigate(ticketOpenModuleForRole(currentUser.role), {
      ticketSearch: `#${digits}`,
    });
  };

  const beginReply = (message: InternalChatMessage) => {
    const next = replyPreviewFromMessage(message);
    replyTargetRef.current = next;
    setReplyTarget(next);
    requestAnimationFrame(() => composerRef.current?.focus());
  };

  const jumpToMessage = (messageId: string) => {
    holdScrollRef.current = true;
    setHighlightId(messageId);
    requestAnimationFrame(() => {
      const node = threadRef.current?.querySelector(
        `[data-chat-message-id="${CSS.escape(messageId)}"]`
      );
      node?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
    window.setTimeout(() => {
      setHighlightId(null);
      holdScrollRef.current = false;
    }, 1600);
  };

  const sendComposer = async () => {
    const text = composer.trim();
    if (!text || !chat.selectedRoomId) return;
    const reply = replyTargetRef.current;
    setComposer('');
    replyTargetRef.current = null;
    setReplyTarget(null);
    setMentionFilter(null);
    setComposerExpanded(false);
    chat.notifyTyping(chat.selectedRoomId, false);
    try {
      await chat.sendText(chat.selectedRoomId, text, reply);
    } catch (err) {
      chat.setError((err as Error).message);
    }
  };

  const startVoice = async () => {
    if (!chat.selectedRoomId) return;
    if (recording) {
      recorderRef.current?.stop();
      setRecording(false);
      return;
    }
    const reply = replyTargetRef.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      startedAtRef.current = Date.now();
      rec.ondataavailable = (ev) => {
        if (ev.data.size) chunksRef.current.push(ev.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const file = new File([blob], `voice-${Date.now()}.webm`, { type: 'audio/webm' });
        try {
          chat.notifyTyping(chat.selectedRoomId!, false);
          await chat.sendVoice(
            chat.selectedRoomId!,
            file,
            Date.now() - startedAtRef.current,
            reply
          );
          replyTargetRef.current = null;
          setReplyTarget(null);
        } catch (err) {
          chat.setError((err as Error).message);
        }
      };
      recorderRef.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      chat.setError('Microphone permission is required for voice notes.');
    }
  };

  const onPickFiles = async (files: FileList | null) => {
    if (!files?.length || !chat.selectedRoomId) return;
    const caption = composer;
    const reply = replyTargetRef.current;
    setComposer('');
    replyTargetRef.current = null;
    setReplyTarget(null);
    chat.notifyTyping(chat.selectedRoomId, false);
    try {
      await chat.sendFiles(chat.selectedRoomId, Array.from(files), caption, reply);
    } catch (err) {
      chat.setError((err as Error).message);
    }
  };

  return (
    <PageShell fillHeight>
      <div className="flex h-full min-h-0 overflow-hidden rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white">
        <aside className="flex w-[400px] shrink-0 flex-col border-r-[0.6px] border-[#bfbfbf] bg-white">
          <div className="shrink-0 space-y-3 border-b-[0.6px] border-[#bfbfbf] px-3 py-3">
            <div className="flex items-center gap-2">
              <Avatar
                name={chat.me?.name || currentUser.name}
                size={36}
                online={chat.me?.online !== false}
                showPresence
              />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-[#171717]">
                  {chat.me?.name || currentUser.name}
                </div>
                <div className="truncate text-[11px] text-[#737373]">
                  {presenceLabel(chat.me?.online !== false)}
                  {chat.me?.teamName ? ` · ${chat.me.teamName}` : ''}
                </div>
              </div>
              <button
                type="button"
                title="New chat"
                onClick={() => setNewChatOpen(true)}
                className="inline-flex h-[38px] items-center gap-1.5 rounded-full bg-[#111111] px-3 text-sm font-medium text-white hover:bg-neutral-800"
              >
                <MessageSquarePlus className="size-[18px] stroke-[2.25]" />
                <span className="hidden sm:inline">New chat</span>
              </button>
              {isAdmin && (
                <button
                  type="button"
                  title="New group"
                  onClick={() => setGroupOpen('create')}
                  className="inline-flex size-[38px] items-center justify-center rounded-full border-[0.6px] border-[#bfbfbf] bg-white text-[#171717] hover:bg-[#f3f4f6]"
                >
                  <Users className="size-[18px] stroke-[2.25]" />
                  <span className="sr-only">New group</span>
                </button>
              )}
            </div>
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-[18px] -translate-y-1/2 text-[#a3a3a3] stroke-[2.25]" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search chats…"
                className="h-[38px] w-full rounded-full border-[0.6px] border-[#bfbfbf] bg-[#fafafa] pl-10 pr-3 text-sm text-[#171717] outline-none placeholder:text-[#a3a3a3] focus:border-neutral-400 focus:bg-white"
              />
            </label>
            <SegmentTabs
              ariaLabel="Chat filters"
              stretch
              className="w-full"
              value={tab}
              onChange={setTab}
              options={[
                { id: 'all', label: tabCounts.all ? `All ${tabCounts.all}` : 'All' },
                {
                  id: 'unread',
                  label: tabCounts.unread ? `Unread ${tabCounts.unread}` : 'Unread',
                },
                {
                  id: 'groups',
                  label: tabCounts.groups ? `Groups ${tabCounts.groups}` : 'Groups',
                },
                {
                  id: 'favourite',
                  label: tabCounts.favourite ? `Favourite ${tabCounts.favourite}` : 'Favourite',
                },
              ]}
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto [scrollbar-width:thin]">
            {chat.loading ? (
              <ul className="px-3 py-3 space-y-2" aria-label="Loading chats">
                {[0, 1, 2, 3, 4].map((i) => (
                  <li key={i} className="flex items-center gap-3 px-1 py-2">
                    <span className="size-10 shrink-0 animate-pulse rounded-full bg-[#f3f4f6]" />
                    <span className="min-w-0 flex-1 space-y-2">
                      <span className="block h-3 w-2/3 animate-pulse rounded bg-[#f3f4f6]" />
                      <span className="block h-3 w-1/2 animate-pulse rounded bg-[#f3f4f6]" />
                    </span>
                  </li>
                ))}
              </ul>
            ) : chat.error && chat.rooms.length === 0 ? (
              <div className="px-4 py-10 text-center">
                <p className="text-sm font-medium text-[#171717]">Could not load chats</p>
                <p className="mt-1 text-xs text-[#737373]">{chat.error}</p>
                <button
                  type="button"
                  onClick={() => void chat.reload()}
                  className="mt-3 inline-flex h-[38px] items-center rounded-xl bg-[#111111] px-3 text-sm font-semibold text-white"
                >
                  Try again
                </button>
              </div>
            ) : filteredRooms.length === 0 ? (
              <div className="px-5 py-10 text-center">
                <p className="text-sm font-medium text-[#171717]">
                  {query.trim()
                    ? 'No chats match that search'
                    : tab === 'unread'
                      ? 'No unread chats'
                      : tab === 'groups'
                        ? 'No groups yet'
                        : tab === 'favourite'
                          ? 'No favourite chats'
                          : 'No conversations yet'}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-[#737373]">
                  {query.trim()
                    ? 'Try another name or message.'
                    : tab === 'groups'
                      ? isAdmin
                        ? 'Create a group for a team or topic.'
                        : 'Ask an admin to add you to a group.'
                      : tab === 'favourite'
                        ? 'Star a chat to find it here.'
                        : tab === 'unread'
                          ? 'You are caught up.'
                          : 'Start a new chat with a teammate.'}
                </p>
                {!query.trim() && tab === 'groups' && isAdmin ? (
                  <button
                    type="button"
                    onClick={() => setGroupOpen('create')}
                    className="mt-3 inline-flex h-[38px] items-center gap-1.5 rounded-full bg-[#111111] px-3 text-sm font-medium text-white"
                  >
                    <Users className="size-[18px] stroke-[2.25]" />
                    New group
                  </button>
                ) : null}
                {!query.trim() && tab === 'all' ? (
                  <button
                    type="button"
                    onClick={() => setNewChatOpen(true)}
                    className="mt-3 inline-flex h-[38px] items-center gap-1.5 rounded-full bg-[#111111] px-3 text-sm font-medium text-white"
                  >
                    <MessageSquarePlus className="size-[18px] stroke-[2.25]" />
                    New chat
                  </button>
                ) : null}
              </div>
            ) : (
              filteredRooms.map((room) => (
                <button
                  key={room.id}
                  type="button"
                  onClick={() => void chat.selectRoom(room.id)}
                  className={`flex w-full items-center gap-3 border-b-[0.6px] border-[#e5e5e5] px-3 py-2.5 text-left ${
                    chat.selectedRoomId === room.id ? 'bg-[#f3f4f6]' : 'hover:bg-[#fafafa]'
                  }`}
                >
                  <Avatar
                    name={room.name}
                    url={room.avatarUrl}
                    size={40}
                    online={room.peerOnline}
                    showPresence={room.type === 'dm'}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1">
                        <span className="truncate text-sm font-semibold text-[#171717]">
                          {room.name}
                        </span>
                        {room.favourite ? (
                          <Star className="size-3 shrink-0 fill-amber-400 text-amber-400" />
                        ) : null}
                        {room.type === 'dm' ? (
                          <span
                            className={`shrink-0 text-[11px] font-medium ${
                              room.peerOnline ? 'text-emerald-700' : 'text-[#737373]'
                            }`}
                          >
                            {presenceLabel(room.peerOnline)}
                          </span>
                        ) : null}
                      </span>
                      <span className="shrink-0 text-[11px] tabular-nums text-[#a3a3a3]">
                        {formatListWhen(room.lastMessageAt || room.updatedAt)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm text-[#737373]">
                        {room.lastPreview ||
                          (room.type === 'group' ? 'Group · no messages yet' : 'No messages yet')}
                      </span>
                      {room.unread > 0 && chat.selectedRoomId !== room.id ? (
                        <span className="inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[#111111] px-1.5 text-[10px] font-semibold leading-none text-white">
                          {room.unread > 99 ? '99+' : room.unread}
                        </span>
                      ) : null}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </aside>

        <section className="flex min-w-0 flex-1 flex-col">
          {!chat.selectedRoom ? (
            <div className="flex flex-1 flex-col items-center justify-center bg-[#fafafa] px-8 text-center">
              <span className="grid size-14 place-items-center rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white text-[#171717]">
                <MessageSquarePlus className="size-[22px] stroke-[2.25]" />
              </span>
              <p className="mt-4 text-sm font-semibold text-[#171717]">Select a conversation</p>
              <p className="mt-1 max-w-sm text-xs leading-relaxed text-[#737373]">
                Pick a teammate or group on the left, or start a new chat.
              </p>
              <button
                type="button"
                onClick={() => setNewChatOpen(true)}
                className="mt-4 inline-flex h-[38px] items-center gap-1.5 rounded-full bg-[#111111] px-4 text-sm font-medium text-white hover:bg-neutral-800"
              >
                <MessageSquarePlus className="size-[18px] stroke-[2.25]" />
                New chat
              </button>
            </div>
          ) : (
            <>
              <header className="flex h-14 shrink-0 items-center justify-between gap-3 border-b-[0.6px] border-[#bfbfbf] px-4">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar
                    name={chat.selectedRoom.name}
                    url={chat.selectedRoom.avatarUrl}
                    size={40}
                    online={chat.selectedRoom.peerOnline}
                    showPresence={chat.selectedRoom.type === 'dm'}
                  />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-[#171717]">
                      {chat.selectedRoom.name}
                    </div>
                    <div className="truncate text-[11px] text-[#737373]">
                      {chat.selectedRoom.type === 'dm'
                        ? `${presenceLabel(chat.selectedRoom.peerOnline)} · Direct message`
                        : `${chat.selectedRoom.members.filter((m) => m.online).length} available · ${
                            chat.selectedRoom.members.length
                          } members${
                            chat.selectedRoom.category ? ` · ${chat.selectedRoom.category}` : ''
                          }`}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  {selecting ? (
                    <>
                      <span className="mr-1 text-sm font-medium text-[#171717]">
                        {selectedIds.size} selected
                      </span>
                      <button
                        type="button"
                        onClick={exitSelect}
                        className="inline-flex h-[38px] items-center rounded-lg px-3 text-sm font-medium text-[#171717] hover:bg-[#fafafa]"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={selectedIds.size === 0}
                        onClick={() => void deleteSelected()}
                        className="inline-flex h-[38px] items-center gap-1.5 rounded-lg bg-[#111111] px-3 text-sm font-medium text-white hover:bg-neutral-800 disabled:opacity-40"
                      >
                        <Trash2 className="size-[18px] stroke-[2.25]" />
                        Delete
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(null);
                        setSelecting(true);
                      }}
                      className="inline-flex h-[38px] items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-[#171717] hover:bg-[#fafafa]"
                    >
                      <Check className="size-[18px] stroke-[2.25]" />
                      Select
                    </button>
                  )}
                  {!selecting && (
                    <>
                  <IconBtn
                    label="Favourite"
                    onClick={() => void chat.toggleFavourite(chat.selectedRoom!.id)}
                  >
                    <Star
                      className={`size-[18px] stroke-[2.25] ${
                        chat.selectedRoom.favourite ? 'fill-current text-amber-600' : ''
                      }`}
                    />
                  </IconBtn>
                  {chat.selectedRoom.type === 'group' && (
                    <IconBtn label="Members" onClick={() => setMembersOpen(true)}>
                      <Users className="size-[18px] stroke-[2.25]" />
                    </IconBtn>
                  )}
                  {chat.selectedRoom.type === 'group' && chat.selectedRoom.roomRole === 'admin' && (
                    <IconBtn label="Edit group" onClick={() => setGroupOpen('edit')}>
                      <Pencil className="size-[18px] stroke-[2.25]" />
                    </IconBtn>
                  )}
                    </>
                  )}
                </div>
              </header>

              {selecting ? (
                <div className="shrink-0 border-b-[0.6px] border-[#bfbfbf] bg-[#fafafa] px-4 py-2 text-[12px] text-[#737373]">
                  Select your own messages, then delete them together.
                </div>
              ) : null}

              {chat.messages.some((m) => m.pinnedAt) ? (
                <div className="shrink-0 border-b-[0.6px] border-[#bfbfbf] bg-[#fafafa] px-4 py-2">
                  {chat.messages
                    .filter((m) => m.pinnedAt)
                    .sort(
                      (a, b) =>
                        new Date(b.pinnedAt || 0).getTime() - new Date(a.pinnedAt || 0).getTime()
                    )
                    .map((message) => (
                      <div key={message.id} className="flex items-center gap-2 py-0.5">
                        <Pin className="size-3.5 shrink-0 stroke-[2.25] text-[#171717]" />
                        <button
                          type="button"
                          onClick={() => jumpToMessage(message.id)}
                          className="min-w-0 flex-1 truncate text-left text-[12px] text-[#171717]"
                        >
                          {message.senderName}: {message.body || 'Attachment'}
                        </button>
                        <button
                          type="button"
                          aria-label="Unpin message"
                          onClick={() => void chat.togglePin(message.id)}
                          className="inline-flex size-7 items-center justify-center rounded-lg text-[#737373] hover:bg-white"
                        >
                          <X className="size-3.5 stroke-[2.25]" />
                        </button>
                      </div>
                    ))}
                </div>
              ) : null}

              {chat.error && (
                <div className="mx-4 mt-3 rounded-xl border-[0.6px] border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                  {chat.error}
                  <button
                    type="button"
                    className="ml-2 underline"
                    onClick={() => chat.setError(null)}
                  >
                    Dismiss
                  </button>
                </div>
              )}

              <div ref={threadRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-4 pt-12">
                {chat.messages.map((message, index) => {
                  const prev = chat.messages[index - 1];
                  const showDay = !prev || dayKey(prev.createdAt) !== dayKey(message.createdAt);
                  const mine = message.senderId === (chat.me?.id || currentUser.id);
                  const seenNames = mine
                    ? seenByNames(message, chat.selectedRoom?.members, selfId)
                    : [];
                  const sender = chat.selectedRoom?.members.find(
                    (row) => String(row.id) === String(message.senderId)
                  );
                  return (
                    <React.Fragment key={message.id}>
                      {showDay ? (
                        <div className="flex items-center gap-3 py-1">
                          <span className="h-px flex-1 bg-[#e5e5e5]" />
                          <span className="text-[11px] font-medium text-[#737373]">
                            {daySeparatorLabel(message.createdAt)}
                          </span>
                          <span className="h-px flex-1 bg-[#e5e5e5]" />
                        </div>
                      ) : null}
                      <MessageBubble
                        message={message}
                        mine={mine}
                        selecting={selecting}
                        selected={selectedIds.has(message.id)}
                        selectable={
                          mine &&
                          !message.id.startsWith('local-') &&
                          message.localStatus !== 'pending' &&
                          message.localStatus !== 'failed'
                        }
                        onToggleSelect={() => toggleSelected(message.id)}
                        editing={editingId === message.id}
                        editDraft={editDraft}
                        setEditDraft={setEditDraft}
                        onStartEdit={() => {
                          setEditingId(message.id);
                          setEditDraft(message.body);
                        }}
                        onCancelEdit={() => setEditingId(null)}
                        onSaveEdit={async () => {
                          await chat.editText(message.id, editDraft);
                          setEditingId(null);
                        }}
                        onDelete={async () => {
                          if (window.confirm('Delete this message?')) {
                            await chat.removeMessage(message.id);
                          }
                        }}
                        onRetry={() => void chat.retryFailed(message)}
                        onReply={() => beginReply(message)}
                        onPin={() =>
                          void chat.togglePin(message.id).catch((err) =>
                            chat.setError((err as Error).message)
                          )
                        }
                        replyTo={resolveReplyTo(message, chat.messages)}
                        highlighted={highlightId === message.id}
                        seenNames={seenNames}
                        senderRole={
                          chat.selectedRoom?.type === 'group' && sender
                            ? staffRoleLabel(sender.role, sender.roomRole)
                            : undefined
                        }
                        onJumpToReply={jumpToMessage}
                        onOpenTicket={openTicket}
                        onOpenImage={(image) => setImagePreview(image)}
                      />
                    </React.Fragment>
                  );
                })}
                {chat.typers.length > 0 ? (
                  <div className="text-[11px] text-[#737373]">
                    {chat.typers.length === 1
                      ? `${chat.typers[0].name} is typing…`
                      : `${chat.typers.map((row) => row.name).join(', ')} are typing…`}
                  </div>
                ) : null}
              </div>

              <div className="relative shrink-0 px-4 pb-4 pt-2">
                {emojiOpen && (
                  <div className="absolute bottom-14 left-4 z-20 grid max-h-64 w-[320px] grid-cols-8 gap-0.5 overflow-y-auto rounded-xl border-[0.6px] border-[#bfbfbf] bg-white p-2">
                    {EMOJIS.map((emoji, i) => (
                      <button
                        key={`${emoji}-${i}`}
                        type="button"
                        className="inline-flex size-[38px] items-center justify-center rounded-xl text-lg hover:bg-[#fafafa]"
                        onClick={() => {
                          setComposer((v) => v + emoji);
                          setEmojiOpen(false);
                          requestAnimationFrame(() =>
                            setComposerExpanded(syncComposerHeight(composerRef.current) > 40)
                          );
                        }}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}
                {mentionFilter != null && (
                  <div className="absolute inset-x-4 bottom-14 z-20 max-h-56 overflow-y-auto rounded-xl border-[0.6px] border-[#bfbfbf] bg-white py-1 shadow-xl">
                    {mentionHits.length === 0 ? (
                      <div className="px-3 py-2.5 text-sm text-[#737373]">No teammates to mention.</div>
                    ) : (
                      mentionHits.map((member, idx) => (
                        <button
                          key={member.id}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            applyMention(member.name);
                          }}
                          className={`flex w-full items-center gap-2.5 px-3 py-2 text-left ${
                            idx === mentionIndex ? 'bg-[#f5f5f5]' : 'hover:bg-[#fafafa]'
                          }`}
                        >
                          <Avatar
                            name={member.name}
                            size={36}
                            online={member.online}
                            showPresence
                          />
                          <div className="min-w-0">
                            <div className="truncate text-sm font-semibold text-[#171717]">
                              {member.name}
                            </div>
                            <div className="truncate text-[11px] text-[#737373]">
                              {staffRoleLabel(member.role, member.roomRole)}
                              {' · '}
                              {presenceLabel(member.online)}
                            </div>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                )}
                {replyTarget ? (
                  <div className="mb-2 flex items-start gap-2 rounded-xl border-[0.6px] border-[#bfbfbf] bg-[#fafafa] px-3 py-2">
                    <div className="min-w-0 flex-1 border-l-2 border-[#111111] pl-2">
                      <div className="truncate text-[11px] font-semibold text-[#171717]">
                        Replying to {replyTarget.senderName}
                      </div>
                      <div className="truncate text-sm text-[#737373]">{replyTarget.body}</div>
                    </div>
                    <button
                      type="button"
                      aria-label="Cancel reply"
                      onClick={() => {
                        replyTargetRef.current = null;
                        setReplyTarget(null);
                      }}
                      className="inline-flex size-[38px] shrink-0 items-center justify-center rounded-lg text-[#737373] hover:bg-white"
                    >
                      <X className="size-[18px] stroke-[2.25]" />
                    </button>
                  </div>
                ) : null}
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void sendComposer();
                  }}
                  className={`grid gap-1 border-[0.6px] border-[#bfbfbf] bg-neutral-50/80 focus-within:border-neutral-400 focus-within:bg-white ${
                    composerExpanded
                      ? 'max-h-[250px] grid-cols-[38px_38px_minmax(0,1fr)_38px_38px] items-end overflow-hidden rounded-2xl px-3 pb-1.5 pt-2.5'
                      : 'h-[46px] grid-cols-[38px_38px_minmax(0,1fr)_38px_38px] items-center rounded-full px-1.5'
                  }`}
                >
                  <button
                    type="button"
                    title="Emoji"
                    onClick={() => setEmojiOpen((v) => !v)}
                    className={`inline-flex size-[38px] items-center justify-center rounded-lg text-[#737373] hover:bg-[#fafafa] ${
                      composerExpanded ? 'col-start-1 row-start-2' : 'col-start-1 row-start-1'
                    }`}
                  >
                    <Smile className="size-[18px] stroke-[2.25]" />
                  </button>
                  <button
                    type="button"
                    title="Attach"
                    onClick={() => fileRef.current?.click()}
                    className={`inline-flex size-[38px] items-center justify-center rounded-lg text-[#737373] hover:bg-[#fafafa] ${
                      composerExpanded ? 'col-start-2 row-start-2' : 'col-start-2 row-start-1'
                    }`}
                  >
                    <Paperclip className="size-[18px] stroke-[2.25]" />
                  </button>
                  <textarea
                    ref={composerRef}
                    value={composer}
                    maxLength={20000}
                    rows={1}
                    placeholder="Write a message…"
                    onChange={(e) => {
                      const value = e.target.value;
                      setComposer(value);
                      setComposerExpanded(syncComposerHeight(e.target) > 40);
                      refreshMention(value, e.target.selectionStart ?? value.length);
                      if (value.trim() && chat.selectedRoomId) {
                        chat.notifyTyping(chat.selectedRoomId, true);
                      }
                    }}
                    onClick={(e) =>
                      refreshMention(e.currentTarget.value, e.currentTarget.selectionStart ?? 0)
                    }
                    onKeyUp={(e) => {
                      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                        refreshMention(
                          e.currentTarget.value,
                          e.currentTarget.selectionStart ?? 0
                        );
                      }
                    }}
                    onKeyDown={(e) => {
                      if (mentionFilter != null && mentionHits.length) {
                        if (e.key === 'ArrowDown') {
                          e.preventDefault();
                          setMentionIndex((i) => (i + 1) % mentionHits.length);
                          return;
                        }
                        if (e.key === 'ArrowUp') {
                          e.preventDefault();
                          setMentionIndex((i) => (i - 1 + mentionHits.length) % mentionHits.length);
                          return;
                        }
                        if (e.key === 'Enter' || e.key === 'Tab') {
                          e.preventDefault();
                          applyMention(mentionHits[mentionIndex]?.name || mentionHits[0].name);
                          return;
                        }
                        if (e.key === 'Escape') {
                          e.preventDefault();
                          setMentionFilter(null);
                          return;
                        }
                      }
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        void sendComposer();
                      }
                    }}
                    className={`min-h-5 max-h-[192px] w-full resize-none overflow-hidden bg-transparent text-sm leading-5 text-[#171717] placeholder:text-neutral-400 outline-none border-0 shadow-none focus:!shadow-none focus:!border-transparent select-text ${
                      composerExpanded
                        ? 'col-span-5 col-start-1 row-start-1 py-1 leading-6'
                        : 'col-start-3 row-start-1 py-1.5'
                    }`}
                  />
                  <button
                    type="button"
                    title={recording ? 'Stop recording' : 'Voice note'}
                    onClick={() => void startVoice()}
                    className={`inline-flex size-[38px] items-center justify-center rounded-lg text-[#737373] hover:bg-[#fafafa] ${
                      recording ? 'bg-[#fafafa]' : ''
                    } ${composerExpanded ? 'col-start-4 row-start-2' : 'col-start-4 row-start-1'}`}
                  >
                    {recording ? (
                      <MicOff className="size-[18px] stroke-[2.25] text-rose-600" />
                    ) : (
                      <Mic className="size-[18px] stroke-[2.25]" />
                    )}
                  </button>
                  <button
                    type="submit"
                    disabled={!composer.trim()}
                    title="Send"
                    className={`inline-flex shrink-0 items-center justify-center rounded-full bg-[#171717] text-white shadow-[0_2px_8px_rgba(0,0,0,0.18)] hover:bg-neutral-800 disabled:opacity-50 disabled:shadow-none ${
                      composerExpanded
                        ? 'col-start-5 row-start-2 size-[38px]'
                        : 'col-start-5 row-start-1 size-[38px]'
                    }`}
                  >
                    <ArrowUp className="size-[18px] stroke-[2.25] text-white" />
                  </button>
                </form>
                <input
                  ref={fileRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    void onPickFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
              </div>
            </>
          )}
        </section>
      </div>

      {newChatOpen && (
        <NewChatModal
          directory={chat.directory}
          onClose={() => setNewChatOpen(false)}
          onPick={async (id) => {
            await chat.startDm(id);
            setNewChatOpen(false);
          }}
        />
      )}
      {groupOpen && (
        <GroupModal
          mode={groupOpen}
          room={groupOpen === 'edit' ? chat.selectedRoom : null}
          directory={chat.groupDirectory}
          selfId={chat.me?.id || currentUser.id}
          onClose={() => setGroupOpen(null)}
          onUploadAvatar={chat.uploadAvatar}
          onSubmit={async (payload) => {
            if (groupOpen === 'create') {
              await chat.createGroup(payload);
            } else if (chat.selectedRoom) {
              await chat.editGroup(chat.selectedRoom.id, payload);
            }
            setGroupOpen(null);
          }}
        />
      )}
      {membersOpen && chat.selectedRoom && (
        <MembersModal room={chat.selectedRoom} onClose={() => setMembersOpen(false)} />
      )}
      {imagePreview ? (
        <div
          className="fixed inset-0 z-[90] flex flex-col bg-black/80"
          role="dialog"
          aria-modal="true"
          aria-label={imagePreview.name}
          onClick={() => setImagePreview(null)}
        >
          <div className="flex shrink-0 items-center justify-end gap-2 px-4 py-3">
            <a
              href={
                imagePreview.url.startsWith('blob:') ||
                imagePreview.url.startsWith('data:')
                  ? imagePreview.url
                  : imagePreview.url.includes('?')
                    ? `${imagePreview.url}&download=1`
                    : `${imagePreview.url}?download=1`
              }
              download={imagePreview.name}
              aria-label={`Download ${imagePreview.name}`}
              onClick={(e) => e.stopPropagation()}
              className="inline-flex size-[38px] items-center justify-center rounded-xl bg-white text-[#171717] shadow-none hover:bg-neutral-100"
            >
              <Download className="size-[18px] stroke-[2.25]" />
            </a>
            <button
              type="button"
              aria-label="Close preview"
              onClick={() => setImagePreview(null)}
              className="inline-flex size-[38px] items-center justify-center rounded-xl bg-white text-[#171717] shadow-none hover:bg-neutral-100"
            >
              <X className="size-[18px] stroke-[2.25]" />
            </button>
          </div>
          <div
            className="flex min-h-0 flex-1 items-center justify-center p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <img
              src={imagePreview.url}
              alt={imagePreview.name}
              className="max-h-full max-w-full object-contain"
            />
          </div>
        </div>
      ) : null}
    </PageShell>
  );
}

function IconBtn({
  children,
  onClick,
  label,
  active,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={`inline-flex size-[38px] items-center justify-center rounded-lg text-[#737373] hover:bg-[#fafafa] ${
        active ? 'bg-[#fafafa]' : ''
      }`}
    >
      {children}
    </button>
  );
}

function MessageActionMenu({
  mine,
  pinned,
  canChange,
  onReply,
  onPin,
  onEdit,
  onDelete,
}: {
  mine: boolean;
  pinned: boolean;
  canChange: boolean;
  onReply: () => void;
  onPin: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={`absolute bottom-full z-20 hidden pb-1 group-hover:flex ${
        mine ? 'right-0' : 'left-0'
      }`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="relative flex items-stretch rounded-2xl border-[0.6px] border-[#e5e5e5] bg-white p-0.5 shadow-sm">
        <MenuAction label="Reply" onClick={onReply}>
          <Reply className="size-3.5 stroke-[2.25]" />
        </MenuAction>
        <span className="my-1.5 w-px shrink-0 bg-[#e5e5e5]" />
        <MenuAction label={pinned ? 'Unpin' : 'Pin'} onClick={onPin}>
          <Pin
            className={`size-3.5 stroke-[2.25] ${pinned ? 'fill-current' : ''}`}
          />
        </MenuAction>
        {canChange ? (
          <>
            <span className="my-1.5 w-px shrink-0 bg-[#e5e5e5]" />
            <MenuAction label="Edit" onClick={onEdit}>
              <Pencil className="size-3.5 stroke-[2.25]" />
            </MenuAction>
            <MenuAction label="Delete" danger onClick={onDelete}>
              <Trash2 className="size-3.5 stroke-[2.25]" />
            </MenuAction>
          </>
        ) : null}
        <span
          aria-hidden
          className={`absolute -bottom-1 size-2 rotate-45 border-b-[0.6px] border-r-[0.6px] border-[#e5e5e5] bg-white ${
            mine ? 'right-5' : 'left-5'
          }`}
        />
      </div>
    </div>
  );
}

function MenuAction({
  label,
  onClick,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex min-w-[44px] flex-col items-center justify-center gap-0.5 rounded-xl px-2 py-1 text-[10px] font-medium leading-none ${
        danger
          ? 'bg-rose-50 text-rose-600 hover:bg-rose-100'
          : 'text-[#171717] hover:bg-[#fafafa]'
      }`}
    >
      {children}
      <span className={danger ? 'text-rose-600' : 'text-[#525252]'}>{label}</span>
    </button>
  );
}

function MessageBubble({
  message,
  mine,
  selecting,
  selected,
  selectable,
  onToggleSelect,
  editing,
  editDraft,
  setEditDraft,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
  onRetry,
  onReply,
  onPin,
  replyTo,
  highlighted,
  seenNames,
  senderRole,
  onJumpToReply,
  onOpenTicket,
  onOpenImage,
}: {
  message: InternalChatMessage;
  mine: boolean;
  selecting: boolean;
  selected: boolean;
  selectable: boolean;
  onToggleSelect: () => void;
  editing: boolean;
  editDraft: string;
  setEditDraft: (v: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => Promise<void>;
  onDelete: () => Promise<void>;
  onRetry: () => void;
  onReply: () => void;
  onPin: () => void;
  replyTo: InternalChatMessage['replyTo'];
  highlighted: boolean;
  seenNames: string[];
  senderRole?: string;
  onJumpToReply: (messageId: string) => void;
  onOpenTicket: (digits: string) => void;
  onOpenImage: (image: { url: string; name: string }) => void;
}) {
  const failed = message.localStatus === 'failed';
  const pending = message.localStatus === 'pending';
  const persisted = !message.id.startsWith('local-');
  const mentions = mentionTokens(message.body);
  return (
    <div
      className={`group flex items-center gap-2 rounded-2xl transition-colors duration-500 ${
        mine ? 'justify-end' : 'justify-start'
      } ${highlighted ? 'bg-[#f5f5f5]' : ''} ${
        selecting && selectable ? 'cursor-pointer' : ''
      }`}
      data-chat-message-id={message.id}
      onClick={selecting && selectable ? onToggleSelect : undefined}
    >
      {selecting && selectable ? (
        <span
          aria-hidden
          className={`grid size-[18px] shrink-0 place-items-center rounded-full border-[0.6px] ${
            selected
              ? 'border-[#111111] bg-[#111111] text-white'
              : 'border-[#bfbfbf] bg-white'
          }`}
        >
          {selected ? <Check className="size-3 stroke-[2.25]" /> : null}
        </span>
      ) : null}
      <div
        className={`relative max-w-[90%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
          failed
            ? 'border-[0.6px] border-rose-200 bg-rose-50 text-rose-900'
            : mine
              ? 'rounded-tr-sm bg-[#111111] text-white'
              : 'rounded-tl-none bg-neutral-100 text-neutral-800'
        } ${highlighted ? 'ring-2 ring-[#171717] ring-offset-2' : ''} ${
          selecting && selectable ? 'pointer-events-none' : ''
        }`}
      >
        {persisted && !editing && !selecting && (
          <MessageActionMenu
            mine={mine}
            pinned={Boolean(message.pinnedAt)}
            canChange={mine && message.type === 'text'}
            onReply={onReply}
            onPin={() => void onPin()}
            onEdit={onStartEdit}
            onDelete={() => void onDelete()}
          />
        )}
        {message.pinnedAt ? (
          <div
            className={`mb-1 flex items-center gap-1 text-[11px] ${
              mine && !failed ? 'text-white/70' : 'text-[#737373]'
            }`}
          >
            <Pin className="size-3 stroke-[2.25]" />
            Pinned
          </div>
        ) : null}
        {!mine && (
          <div className="mb-1 text-[11px] font-semibold text-[#737373]">
            {message.senderName}
            {senderRole ? ` · ${senderRole}` : ''}
          </div>
        )}
        {replyTo && !editing ? (
          <ReplyQuote reply={replyTo} onClick={() => onJumpToReply(replyTo.id)} />
        ) : null}
        {editing ? (
          <div className="space-y-2">
            <textarea
              value={editDraft}
              maxLength={20000}
              onChange={(e) => setEditDraft(e.target.value)}
              className="min-h-[72px] w-full rounded-lg bg-white/10 p-2 text-sm outline-none"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void onSaveEdit()}
                className="h-[38px] rounded-lg bg-white px-3 text-sm text-[#171717]"
              >
                Save
              </button>
              <button type="button" onClick={onCancelEdit} className="h-[38px] px-3 text-sm">
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            {(() => {
              const images = message.attachments.filter(
                (att) => att.url && isChatImage(att)
              );
              const files = message.attachments.filter(
                (att) => att.url && !isChatImage(att)
              );
              const outgoing = mine && !failed;
              return (
                <>
                  {images.length > 0 ? (
                    <div
                      className={`${message.body ? 'mb-2' : '-mx-2 -mt-1'} ${
                        images.length > 1 ? 'grid grid-cols-2 gap-1' : ''
                      }`}
                    >
                      {images.map((att) => (
                        <button
                          key={att.id}
                          type="button"
                          onClick={() =>
                            onOpenImage({ url: att.url, name: att.name })
                          }
                          className="block overflow-hidden rounded-xl text-left"
                        >
                          <img
                            src={att.url}
                            alt={att.name}
                            className={`w-full bg-black/20 object-cover ${
                              images.length > 1
                                ? 'aspect-square max-h-40'
                                : 'max-h-72'
                            }`}
                          />
                        </button>
                      ))}
                    </div>
                  ) : null}
                  {message.body
                    ? renderBody(message.body, outgoing, onOpenTicket)
                    : null}
                  {files.map((att) => {
                    const href = att.url.includes('?')
                      ? `${att.url}&download=1`
                      : `${att.url}?download=1`;
                    return (
                      <a
                        key={att.id}
                        href={href}
                        download={att.name}
                        className={`mt-1 flex items-center gap-2 rounded-xl px-2.5 py-2 text-sm ${
                          outgoing ? 'bg-white/10' : 'bg-white'
                        }`}
                      >
                        <span className="min-w-0 truncate underline underline-offset-2">
                          {att.name}
                        </span>
                      </a>
                    );
                  })}
                </>
              );
            })()}
            {message.type === 'voice' && message.voiceUrl && (
              <audio className="mt-2 w-full" controls src={message.voiceUrl} />
            )}
            {message.ticket ? (
              <button
                type="button"
                onClick={() => onOpenTicket(message.ticket!.number.replace(/\D/g, ''))}
                className={`mt-2 w-full rounded-xl border-[0.6px] px-2.5 py-2 text-left ${
                  mine && !failed ? 'border-white/20 bg-white/10' : 'border-[#bfbfbf] bg-white'
                }`}
              >
                <div className="flex items-center gap-1 text-[11px]">
                  <Hash className="size-3.5" />
                  {message.ticket.number}
                </div>
                <div className="truncate text-sm">{message.ticket.subject}</div>
                <div className={`text-[11px] ${mine && !failed ? 'text-white/70' : 'text-[#737373]'}`}>
                  Open in Tickets
                </div>
              </button>
            ) : (
              mentions.map((digits) => (
                <button
                  key={digits}
                  type="button"
                  onClick={() => onOpenTicket(digits)}
                  className={`mt-2 w-full rounded-xl border-[0.6px] px-2.5 py-2 text-left ${
                    mine && !failed ? 'border-white/20 bg-white/10' : 'border-[#bfbfbf] bg-white'
                  }`}
                >
                  <div className="flex items-center gap-1 text-[11px]">
                    <Hash className="size-3.5" />#{digits}
                  </div>
                  <div className={`text-[11px] ${mine && !failed ? 'text-white/70' : 'text-[#737373]'}`}>
                    Open in Tickets
                  </div>
                </button>
              ))
            )}
          </>
        )}
        <div
          className={`mt-1 flex items-center gap-1 text-[11px] ${
            mine && !failed ? 'text-white/70' : 'text-[#a3a3a3]'
          }`}
        >
          <span>
            {formatClock(message.createdAt)}
            {message.editedAt ? ' · Edited' : ''}
            {pending ? ' · Sending' : ''}
            {failed ? ' · Failed' : ''}
          </span>
          {failed && (
            <button type="button" className="underline" onClick={onRetry}>
              Retry
            </button>
          )}
          {mine && persisted && !failed ? (
            <span
              className="inline-flex items-center gap-0.5"
              title={seenNames.length ? `Seen by ${seenNames.join(', ')}` : 'Sent'}
            >
              {seenNames.length ? (
                <CheckCheck className="size-3.5 stroke-[2.25]" />
              ) : (
                <Check className="size-3.5 stroke-[2.25]" />
              )}
              <span>{seenNames.length ? 'Seen' : 'Sent'}</span>
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function NewChatModal({
  directory,
  onClose,
  onPick,
}: {
  directory: InternalChatDirectoryUser[];
  onClose: () => void;
  onPick: (id: string) => Promise<void>;
}) {
  const [q, setQ] = useState('');
  const rows = directory.filter((u) => {
    const hay = `${u.name} ${u.email} ${u.teamName}`.toLowerCase();
    return hay.includes(q.trim().toLowerCase());
  });
  return (
    <ModalShell onClose={onClose} max="max-w-md">
      <div className="flex h-14 items-center gap-2 border-b-[0.6px] border-[#bfbfbf] px-4">
        <MessageSquarePlus className="size-[18px] stroke-[2.25]" />
        <div className="flex-1 text-base font-semibold">New chat</div>
        <IconBtn label="Close" onClick={onClose}>
          <X className="size-[18px] stroke-[2.25]" />
        </IconBtn>
      </div>
      <div className="p-4">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search teammates..."
          className="mb-3 h-[38px] w-full rounded-full border-[0.6px] border-[#bfbfbf] bg-[#fafafa] px-3 text-sm outline-none"
        />
        <div className="max-h-[360px] overflow-y-auto">
          {rows.length === 0 ? (
            <div className="py-6 text-sm text-[#737373]">No teammates found.</div>
          ) : (
            rows.map((user) => (
              <button
                key={user.id}
                type="button"
                onClick={() => void onPick(user.id)}
                className="flex w-full items-center gap-3 border-b-[0.6px] border-[#e5e5e5] px-1 py-2.5 text-left hover:bg-[#fafafa]"
              >
                <Avatar name={user.name} size={40} online={user.online} showPresence />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold">{user.name}</div>
                  <div className="text-[11px] text-[#737373]">
                    {user.teamName || user.role} · {presenceLabel(user.online)}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </ModalShell>
  );
}

function GroupModal({
  mode,
  room,
  directory,
  selfId,
  onClose,
  onUploadAvatar,
  onSubmit,
}: {
  mode: 'create' | 'edit';
  room: InternalChatRoom | null;
  directory: InternalChatDirectoryUser[];
  selfId: string;
  onClose: () => void;
  onUploadAvatar: (file: File) => Promise<{ storageKey: string }>;
  onSubmit: (payload: {
    name: string;
    description: string;
    category: string;
    memberIds: string[];
    avatarStorageKey?: string;
  }) => Promise<void>;
}) {
  const [name, setName] = useState(room?.name || '');
  const [category, setCategory] = useState(room?.category || 'General');
  const [description, setDescription] = useState(room?.description || '');
  const [q, setQ] = useState('');
  const [memberIds, setMemberIds] = useState<string[]>(
    (room?.members || []).map((m) => m.id).filter((id) => id !== selfId)
  );
  const [avatarKey, setAvatarKey] = useState<string | undefined>(room?.avatarKey || undefined);
  const [preview, setPreview] = useState<string | null>(room?.avatarUrl || null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const photoRef = useRef<HTMLInputElement>(null);

  const rows = directory.filter((u) => {
    const hay = `${u.name} ${u.email} ${u.teamName}`.toLowerCase();
    return hay.includes(q.trim().toLowerCase());
  });

  return (
    <ModalShell onClose={onClose} max="max-w-4xl">
      <div className="flex h-14 items-center justify-between border-b-[0.6px] border-[#bfbfbf] px-4">
        <div>
          <div className="text-base font-semibold">{mode === 'create' ? 'Create group' : 'Edit group'}</div>
          <div className="text-[11px] text-[#737373]">
            Set up a new internal group with purpose, members, and context for your team.
          </div>
        </div>
        <IconBtn label="Close" onClick={onClose}>
          <X className="size-[18px] stroke-[2.25]" />
        </IconBtn>
      </div>
      <div className="space-y-4 p-4">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-12 w-12 items-center justify-center overflow-hidden rounded-full bg-[#f5f5f5]">
            {preview ? (
              <img src={preview} alt="" className="h-full w-full object-cover" />
            ) : (
              <Users className="size-[18px] stroke-[2.25] text-[#737373]" />
            )}
          </span>
          <div className="text-[11px] text-[#737373]">Optional · JPG or PNG</div>
          <button
            type="button"
            onClick={() => photoRef.current?.click()}
            className="inline-flex h-[38px] items-center gap-1.5 rounded-lg border-[0.6px] border-[#bfbfbf] px-3 text-sm"
          >
            <Camera className="size-[18px] stroke-[2.25]" />
            Upload
          </button>
          <input
            ref={photoRef}
            type="file"
            accept="image/jpeg,image/png"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setPreview(URL.createObjectURL(file));
              const uploaded = await onUploadAvatar(file);
              setAvatarKey(uploaded.storageKey);
            }}
          />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-3">
            <label className="block text-sm font-medium">
              Group name *
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Floor Supervisors"
                className="mt-1 h-[38px] w-full rounded-lg border-[0.6px] border-[#bfbfbf] px-3 text-sm outline-none"
              />
            </label>
            <label className="block text-sm font-medium">
              Category *
              <span className="relative mt-1 block">
                <MenuSelect
                  label="Category"
                  value={category}
                  options={GROUP_CATEGORIES.map((c) => ({
                    value: c,
                    label: c,
                  }))}
                  onChange={setCategory}
                />
              </span>
            </label>
            <label className="block text-sm font-medium">
              Description *
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What is this group for? Include shift, queue, or escalation context."
                className="mt-1 min-h-[160px] w-full rounded-lg border-[0.6px] border-[#bfbfbf] px-3 py-2 text-sm outline-none"
              />
            </label>
          </div>
          <div>
            <div className="mb-2 text-sm font-medium">
              Add agents * <span className="text-[#737373]">{memberIds.length} selected</span>
            </div>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search agents..."
              className="mb-2 h-[38px] w-full rounded-full border-[0.6px] border-[#bfbfbf] bg-[#fafafa] px-3 text-sm outline-none"
            />
            <div className="max-h-[280px] overflow-y-auto">
              {rows.map((user) => {
                const on = memberIds.includes(user.id);
                return (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() =>
                      setMemberIds((ids) =>
                        on ? ids.filter((id) => id !== user.id) : [...ids, user.id]
                      )
                    }
                    className="flex w-full items-center gap-3 border-b-[0.6px] border-[#e5e5e5] px-1 py-2 text-left"
                  >
                    <span
                      className={`inline-flex size-[18px] items-center justify-center rounded-full border-[0.6px] ${
                        on ? 'border-[#171717] bg-[#171717] text-white' : 'border-[#bfbfbf]'
                      }`}
                    >
                      {on ? <Check className="size-3 stroke-[2.25]" /> : null}
                    </span>
                    <Avatar name={user.name} size={36} />
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{user.name}</div>
                      <div className="text-[11px] text-[#737373]">{user.teamName || user.role}</div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
        {err && <div className="text-sm text-rose-700">{err}</div>}
        <div className="flex items-center justify-between border-t-[0.6px] border-[#e5e5e5] pt-3">
          <span className="text-[11px] text-[#737373]">* Required fields</span>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="h-[38px] rounded-xl border-[0.6px] border-[#bfbfbf] px-4 text-sm"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                setErr(null);
                try {
                  await onSubmit({
                    name,
                    description,
                    category,
                    memberIds,
                    avatarStorageKey: avatarKey,
                  });
                } catch (error) {
                  setErr((error as Error).message);
                  setSaving(false);
                }
              }}
              className="h-[38px] rounded-xl bg-black px-4 text-sm text-white hover:bg-neutral-800"
            >
              {mode === 'create' ? 'Create group' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </ModalShell>
  );
}

function MembersModal({ room, onClose }: { room: InternalChatRoom; onClose: () => void }) {
  return (
    <ModalShell onClose={onClose} max="max-w-md">
      <div className="flex h-14 items-center justify-between border-b-[0.6px] border-[#bfbfbf] px-4">
        <div className="text-base font-semibold">Group members</div>
        <IconBtn label="Close" onClick={onClose}>
          <X className="size-[18px] stroke-[2.25]" />
        </IconBtn>
      </div>
      <div className="max-h-[420px] overflow-y-auto p-3">
        {room.members.map((member) => (
          <div
            key={member.id}
            className="flex items-center gap-3 border-b-[0.6px] border-[#e5e5e5] px-1 py-2.5"
          >
            <Avatar name={member.name} size={40} online={member.online} showPresence />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{member.name}</div>
              <div className="truncate text-[11px] text-[#737373]">
                {staffRoleLabel(member.role, member.roomRole)}
                {' · '}
                {presenceLabel(member.online)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </ModalShell>
  );
}

function ModalShell({
  children,
  onClose,
  max,
}: {
  children: React.ReactNode;
  onClose: () => void;
  max: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className={`${max} w-full overflow-hidden rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white shadow-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
