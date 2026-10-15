import { generateId } from '../utils/id.js';
import { getPageContext } from '../utils/url.js';
import { state } from '../core/state.js';

/** @type {Map<string, object>} */
const registry = new Map();

export function registerCurrentPage() {
  const page = getPageContext();
  const path = page.path;
  if (state.pageId && registry.get(state.pageId)?.path === path) {
    return state.pageId;
  }
  const id = generateId('pg');
  registry.set(id, { path: page.path, title: page.title, url: page.url });
  state.pageId = id;
  return id;
}

export function collectNewPageProfiles(batchPageIds, resend = false) {
  const pages = {};
  for (const pid of batchPageIds) {
    const page = registry.get(pid);
    if (page && (resend || !page.sent)) {
      pages[pid] = { path: page.path, title: page.title };
    }
  }
  return Object.keys(pages).length ? pages : undefined;
}

export function markPageProfilesSent(pages) {
  if (!pages) return;
  for (const pid of Object.keys(pages)) {
    const page = registry.get(pid);
    if (page) page.sent = true;
  }
}
