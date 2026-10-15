import { getProfileInitials } from "./brandColors.js";

/** Sidebar folders + Signature/Templates (pseudo). */
export const MAIL_FOLDER_OPTIONS = [
  { id: "inbox", label: "Inbox" },
  { id: "sent", label: "Sent Items" },
  { id: "drafts", label: "Drafts" },
  { id: "archive", label: "Archive" },
  { id: "spam", label: "Junk Email" },
  { id: "signature", label: "Signature" },
  { id: "templates", label: "Templates" },
];

/** Move-to destinations (Deleted is not a sidebar folder). */
export const MAIL_MOVE_FOLDER_OPTIONS = [
  { id: "inbox", label: "Inbox" },
  { id: "archive", label: "Archive" },
  { id: "spam", label: "Junk Email" },
  { id: "deleted", label: "Deleted Items" },
];

const MAIL_FOLDER_LABELS = {
  ...Object.fromEntries(MAIL_FOLDER_OPTIONS.map((folder) => [folder.id, folder.label])),
  deleted: "Deleted Items",
};

export const MAIL_TAGS = [
  { id: "important", label: "Important", color: "#c73e32" },
  { id: "projects", label: "Projects", color: "#866300" },
  { id: "clients", label: "Clients", color: "#0e8f50" },
  { id: "followup", label: "Follow up", color: "#1869d3" },
];

const TAGS_STORAGE_KEY = "worktual-mail-message-tags";

function startOfDay(date) {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

export function parseDisplayName(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "Unknown";
  }

  const quoted = raw.match(/^"([^"]+)"/);
  if (quoted) {
    return quoted[1];
  }

  const named = raw.match(/^(.+?)\s*<[^>]+>$/);
  if (named) {
    return named[1].trim();
  }

  if (raw.includes("@")) {
    return raw.split("@")[0];
  }

  return raw;
}

export function getInitials(value) {
  return getProfileInitials(parseDisplayName(value));
}

export function formatMailDate(value) {
  if (!value) {
    return "";
  }

  const date = new Date(value);
  const now = new Date();
  const sameDay =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  if (sameDay) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function formatMailDateLong(value) {
  if (!value) {
    return "—";
  }

  return new Date(value).toLocaleString([], {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function getFolderLabel(folderId) {
  return MAIL_FOLDER_LABELS[folderId] || "Mail";
}

export function getListLabel(message, folder) {
  if (folder === "sent" || folder === "drafts") {
    return parseDisplayName(message.to || message.from);
  }

  return parseDisplayName(message.from);
}

export function groupMessagesByDate(messages = []) {
  const now = startOfDay(new Date());
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const groups = new Map();

  for (const message of messages) {
    const date = message.date ? new Date(message.date) : null;
    let label = "Older";

    if (date) {
      const day = startOfDay(date);
      if (day.getTime() === now.getTime()) {
        label = "Today";
      } else if (day.getTime() === yesterday.getTime()) {
        label = "Yesterday";
      } else if (day >= weekAgo) {
        label = "This week";
      }
    }

    if (!groups.has(label)) {
      groups.set(label, []);
    }
    groups.get(label).push(message);
  }

  const order = ["Today", "Yesterday", "This week", "Older"];
  return order
    .filter((label) => groups.has(label))
    .map((label) => ({ label, messages: groups.get(label) }));
}

export function filterMessagesBySearch(messages = [], query = "") {
  const normalized = String(query || "").trim().toLowerCase();
  if (!normalized) {
    return messages;
  }

  return messages.filter((message) => {
    const haystack = [
      message.from,
      message.fromEmail,
      message.to,
      message.cc,
      message.subject,
      message.preview,
      message.body,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    return haystack.includes(normalized);
  });
}

export const MAIL_LIST_FILTERS = [
  { id: "all", label: "All mail" },
  { id: "unread", label: "Unread" },
  { id: "read", label: "Read" },
  { id: "attachments", label: "Has attachments" },
  { id: "flagged", label: "Flagged" },
];

export function filterMessagesByListFilter(messages = [], filterId = "all") {
  switch (filterId) {
    case "unread":
      return messages.filter((message) => !message.isRead);
    case "read":
      return messages.filter((message) => message.isRead);
    case "attachments":
      return messages.filter((message) => message.hasAttachments);
    case "flagged":
      return messages.filter((message) => message.isFlagged);
    default:
      return messages;
  }
}

export const MAIL_LIST_SORT_OPTIONS = [
  { id: "date-desc", label: "Newest on top" },
  { id: "date-asc", label: "Oldest on top" },
  { id: "sender-asc", label: "Sender (A to Z)" },
  { id: "subject-asc", label: "Subject (A to Z)" },
];

export const MAIL_LIST_DENSITY_OPTIONS = [
  { id: "comfortable", label: "Comfortable" },
  { id: "compact", label: "Compact" },
];

export function sortMessages(messages = [], sortBy = "date-desc", activeFolder = "inbox") {
  const sorted = [...messages];

  sorted.sort((left, right) => {
    if (sortBy === "sender-asc") {
      return getListLabel(left, activeFolder).localeCompare(getListLabel(right, activeFolder));
    }

    if (sortBy === "subject-asc") {
      return String(left.subject || "").localeCompare(String(right.subject || ""));
    }

    const leftTime = left.date ? new Date(left.date).getTime() : 0;
    const rightTime = right.date ? new Date(right.date).getTime() : 0;

    if (sortBy === "date-asc") {
      return leftTime - rightTime;
    }

    return rightTime - leftTime;
  });

  return sorted;
}

export function applyMailListPipeline(
  messages = [],
  {
    searchQuery = "",
    tagId = "",
    tagMap = {},
    listFilter = "all",
    sortBy = "date-desc",
    activeFolder = "inbox",
  } = {},
) {
  let result = filterMessagesBySearch(messages, searchQuery);
  result = filterMessagesByTag(result, tagId, tagMap);
  result = filterMessagesByListFilter(result, listFilter);
  result = sortMessages(result, sortBy, activeFolder);
  return result;
}

export function filterMessagesByTag(messages = [], tagId = "", tagMap = {}) {
  if (!tagId) {
    return messages;
  }

  return messages.filter((message) => (tagMap[message.id] || []).includes(tagId));
}

export function paginateMessages(messages = [], page = 1, pageSize = 15) {
  const total = messages.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const start = (safePage - 1) * pageSize;

  return {
    page: safePage,
    totalPages,
    total,
    items: messages.slice(start, start + pageSize),
  };
}

function extractEmailAddress(value) {
  const raw = String(value || "").trim();
  const named = raw.match(/<([^>]+)>/);
  if (named) {
    return named[1].trim();
  }

  if (raw.includes("@")) {
    return raw;
  }

  return "";
}

function splitAddressList(value = "") {
  return String(value || "")
    .split(/[,;]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function buildReplyAllDraft(message, selfEmail = "") {
  const replyTo = message.fromEmail || extractEmailAddress(message.from);
  const toRecipients = new Set([replyTo].filter(Boolean));
  const ccRecipients = new Set(splitAddressList(message.to).map(extractEmailAddress).filter(Boolean));

  if (selfEmail) {
    toRecipients.delete(selfEmail);
    ccRecipients.delete(selfEmail);
  }

  ccRecipients.delete(replyTo);

  const subject = message.subject || "";
  const normalizedSubject = /^re:/i.test(subject.trim()) ? subject : `Re: ${subject}`;

  return {
    to: [...toRecipients].join(", "),
    cc: [...ccRecipients].join(", "),
    subject: normalizedSubject,
    body: `\n\n---\nOn ${message.date ? new Date(message.date).toLocaleString() : "earlier"}, ${message.from || "sender"} wrote:\n\n${message.body || message.preview || ""}`,
    htmlBody: `<p><br/></p><hr/><p>On ${message.date ? new Date(message.date).toLocaleString() : "earlier"}, ${message.from || "sender"} wrote:</p><blockquote>${message.htmlBody || `<p>${(message.body || message.preview || "").replace(/\n/g, "<br/>")}</p>`}</blockquote>`,
  };
}

export function buildForwardDraft(message) {
  const subject = message.subject || "";
  const normalizedSubject = /^fwd:/i.test(subject.trim()) ? subject : `Fwd: ${subject}`;

  return {
    to: "",
    cc: "",
    bcc: "",
    subject: normalizedSubject,
    body: `\n\n---------- Forwarded message ----------\nFrom: ${message.from || ""}\nDate: ${message.date ? new Date(message.date).toLocaleString() : ""}\nSubject: ${message.subject || ""}\n\n${message.body || message.preview || ""}`,
    htmlBody: `<p><br/></p><p>---------- Forwarded message ----------</p><p>From: ${message.from || ""}<br/>Date: ${message.date ? new Date(message.date).toLocaleString() : ""}<br/>Subject: ${message.subject || ""}</p>${message.htmlBody || `<p>${(message.body || message.preview || "").replace(/\n/g, "<br/>")}</p>`}`,
  };
}

export function readMailTags() {
  try {
    const raw = window.localStorage.getItem(TAGS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

export function writeMailTags(tagMap) {
  window.localStorage.setItem(TAGS_STORAGE_KEY, JSON.stringify(tagMap));
}

export function toggleMessageTag(messageId, tagId) {
  const current = readMailTags();
  const tags = new Set(current[messageId] || []);
  if (tags.has(tagId)) {
    tags.delete(tagId);
  } else {
    tags.add(tagId);
  }
  current[messageId] = [...tags];
  writeMailTags(current);
  return current;
}
