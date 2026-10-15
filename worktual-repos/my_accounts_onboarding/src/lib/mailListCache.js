const STORAGE_PREFIX = "mail-list-cache:";

function storageKey(mailbox, folder) {
  return `${STORAGE_PREFIX}${mailbox}:${folder}`;
}

export function readMailListCache(mailbox, folder) {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(storageKey(mailbox, folder));
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.messages)) {
      return null;
    }

    return parsed.messages;
  } catch {
    return null;
  }
}

export function writeMailListCache(mailbox, folder, messages) {
  if (typeof window === "undefined" || !Array.isArray(messages)) {
    return;
  }

  try {
    window.localStorage.setItem(
      storageKey(mailbox, folder),
      JSON.stringify({
        messages,
        savedAt: Date.now(),
      }),
    );
  } catch {
    // Storage may be full or unavailable.
  }
}

const detailPrefix = "mail-detail-cache:";

function detailKey(mailbox, folder, uid) {
  return `${detailPrefix}${mailbox}:${folder}:${uid}`;
}

export function readMailDetailCache(mailbox, folder, uid) {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(detailKey(mailbox, folder, uid));
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw);
    return parsed?.message || null;
  } catch {
    return null;
  }
}

export function writeMailDetailCache(mailbox, folder, uid, message) {
  if (typeof window === "undefined" || !message) {
    return;
  }

  try {
    window.localStorage.setItem(
      detailKey(mailbox, folder, uid),
      JSON.stringify({ message, savedAt: Date.now() }),
    );
  } catch {
    // Storage may be full or unavailable.
  }
}
