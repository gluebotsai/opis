/** @returns {string} */
export function generateId(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 11)}${Date.now().toString(36)}`;
}

/** @returns {string} */
export function uuidV4() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
