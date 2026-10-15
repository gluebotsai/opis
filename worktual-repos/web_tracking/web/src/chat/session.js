/** Browser tab chat session — cleared when the tab closes (sessionStorage). */

export const CHAT_SESSION_ID_KEY = 'chatSessionId';
export const CHAT_MESSAGES_KEY = 'chatMessages';

export function getChatSessionId() {
  return sessionStorage.getItem(CHAT_SESSION_ID_KEY) || '';
}

export function getOrCreateChatSessionId() {
  let id = getChatSessionId();
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(CHAT_SESSION_ID_KEY, id);
  }
  return id;
}

/** New server + client session (refresh button). */
export function rotateChatSessionId() {
  const id = crypto.randomUUID();
  sessionStorage.setItem(CHAT_SESSION_ID_KEY, id);
  sessionStorage.removeItem(CHAT_MESSAGES_KEY);
  return id;
}

export function clearStoredMessages() {
  sessionStorage.removeItem(CHAT_MESSAGES_KEY);
}

export function loadStoredMessages() {
  try {
    const raw = sessionStorage.getItem(CHAT_MESSAGES_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? parsed : null;
  } catch {
    return null;
  }
}

export function saveStoredMessages(messages) {
  const toSave = messages.filter((m) => m.role !== 'typing' && m.id !== 'welcome');
  if (!toSave.length) {
    clearStoredMessages();
    return;
  }
  sessionStorage.setItem(CHAT_MESSAGES_KEY, JSON.stringify(toSave));
}
