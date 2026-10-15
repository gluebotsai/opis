import { config } from '../core/state.js';
import { log, warn } from '../core/logger.js';

const STORAGE_KEY = 'wa_client_ip';
const FETCH_TIMEOUT_MS = 8000;

/** @type {string | null | undefined} */
let memoryCache;

function normalizeIp(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let ip = raw.trim();
  if (!ip) return null;
  if (ip.startsWith('::ffff:')) {
    ip = ip.slice('::ffff:'.length);
  }
  return ip || null;
}

function readStorage() {
  try {
    return sessionStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStorage(ip) {
  try {
    sessionStorage.setItem(STORAGE_KEY, ip);
  } catch {
    /* ignore quota / private mode */
  }
}

/** Cached client IP from getip (memory or sessionStorage). */
export function getCachedClientIp() {
  if (memoryCache) return memoryCache;
  const stored = readStorage();
  if (stored) {
    memoryCache = stored;
    return stored;
  }
  return null;
}

async function fetchClientIpFromService() {
  const url = config?.clientIpUrl || 'https://getip.worktual.co.uk/';
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller
    ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
    : null;

  try {
    const res = await fetch(url, {
      method: 'GET',
      credentials: 'omit',
      mode: 'cors',
      signal: controller?.signal,
    });
    if (!res.ok) {
      if (config?.debug) warn('clientIp fetch failed', res.status);
      return null;
    }
    const data = await res.json();
    const ip = normalizeIp(data?.clientIPv6 || data?.clientIPv4 || data?.clientIp);
    if (config?.debug && ip) log('clientIp resolved', ip);
    return ip;
  } catch (err) {
    if (config?.debug) warn('clientIp fetch error', err);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Start non-blocking client IP lookup (once per browser session). */
export function initClientIp() {
  if (config?.fetchClientIp === false) return;
  if (getCachedClientIp()) return;

  void fetchClientIpFromService().then((ip) => {
    if (!ip) return;
    memoryCache = ip;
    writeStorage(ip);
  });
}
