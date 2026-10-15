/** @typedef {{ name: string; properties?: Record<string, unknown>; eventId?: string; timestamp?: number }} TrackEvent */

const hooks = {
  beforeTrack: [],
  afterTrack: [],
  beforeSend: [],
  afterSend: [],
};

/** @param {'beforeTrack'|'afterTrack'|'beforeSend'|'afterSend'} hook @param {Function} fn */
export function on(hook, fn) {
  if (hooks[hook]) hooks[hook].push(fn);
}

/** @param {'beforeTrack'|'afterTrack'|'beforeSend'|'afterSend'} hook @param {unknown} payload */
export async function emit(hook, payload) {
  let result = payload;
  for (const fn of hooks[hook] || []) {
    const next = await fn(result);
    if (next === false) return false;
    if (next !== undefined) result = next;
  }
  return result;
}

export function clearHooks() {
  for (const key of Object.keys(hooks)) {
    hooks[key] = [];
  }
}
