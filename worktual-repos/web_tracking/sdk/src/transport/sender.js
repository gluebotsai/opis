import { uuidV4 } from '../utils/id.js';
import { config } from '../core/state.js';
import { log, warn } from '../core/logger.js';
import { buildPayload } from '../core/context.js';
import { markProfilesSent } from '../profiles/index.js';
import { compressJson, payloadByteLength } from '../core/compress.js';
import { emit } from '../core/event-bus.js';
import {
  PAYLOAD_TYPE_V3,
  BEACON_MAX_BYTES,
  HTTP_STATUS_DUPLICATE,
  OFFLINE_DRAIN_BATCH,
} from '../core/constants.js';
import * as offlineQueue from './offline-queue.js';

/** @type {Array<Record<string, unknown>>} */
let pendingEvents = [];
let flushTimer = null;
let batchIntervalTimer = null;
/** @type {((success: boolean) => void)[] | null} */
let flushWaiters = null;

function getEndpoint() {
  return config?.endpoint || '/v1/tracking/nfs-ingestions';
}

function batchLimit() {
  return config?.batchSize || 20;
}

function isCrossOriginEndpoint(url) {
  try {
    return new URL(url, window.location.href).origin !== window.location.origin;
  } catch {
    return true;
  }
}

async function encodeBody(payload) {
  const json = JSON.stringify(payload);
  if (!config?.compressPayloads) return { body: json, encoding: null, json };
  const compressed = await compressJson(json);
  if (compressed.encoding === 'gzip' && compressed.body instanceof ArrayBuffer) {
    return compressed;
  }
  return { body: json, encoding: null, json };
}

/** @param {Record<string, unknown>[]} events @param {{ preferBeacon?: boolean, forceCompress?: boolean }} [options] */
async function sendPayload(events, options = {}) {
  const body = {
    ...buildPayload(events),
    payloadId: uuidV4(),
    type: PAYLOAD_TYPE_V3,
  };
  const payload = await emit('beforeSend', body);
  if (payload === false) return true;

  let encoded = await encodeBody(payload);
  const jsonLen = typeof encoded.json === 'string' ? encoded.json.length : 0;
  if (
    (options.forceCompress || jsonLen > 50_000)
    && !encoded.encoding
    && typeof encoded.json === 'string'
  ) {
    encoded = await compressJson(encoded.json);
    if (encoded.encoding === 'gzip') {
      encoded.json = payload;
    }
  }

  const url = getEndpoint();
  const crossOrigin = isCrossOriginEndpoint(url);
  const headers = { 'Content-Type': 'application/json' };
  if (encoded.encoding === 'gzip') {
    headers['Content-Encoding'] = 'gzip';
    headers['Content-Type'] = 'application/json';
  }

  const bodySize = payloadByteLength(encoded.body, encoded.encoding);
  const canBeacon =
    !encoded.encoding
    && typeof encoded.body === 'string'
    && bodySize < BEACON_MAX_BYTES
    && (!crossOrigin || options.preferBeacon)
    && navigator.sendBeacon;

  if (canBeacon) {
    const blob = new Blob([encoded.body], { type: 'application/json' });
    if (navigator.sendBeacon(url, blob)) {
      markProfilesSent(payload.profiles);
      await emit('afterSend', { success: true, payload });
      return true;
    }
  }

  if (typeof fetch !== 'undefined') {
    try {
      if (config?.debug) {
        const keys = payload.profiles ? Object.keys(payload.profiles).join(', ') : 'none';
        log('sending', events.length, 'event(s)', '| profiles:', keys);
      }
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: encoded.body,
        keepalive: true,
        credentials: 'omit',
        mode: 'cors',
      });
      if (res.ok || res.status === HTTP_STATUS_DUPLICATE) {
        markProfilesSent(payload.profiles);
        if (config?.debug) log('sent ok', res.status);
        await emit('afterSend', { success: true, payload, bytes: payloadByteLength(encoded.body, encoded.encoding) });
        return true;
      }
      if (config?.debug) warn('send failed', res.status, res.statusText);
    } catch (e) {
      warn('fetch failed', e);
    }
  }

  return new Promise((resolve) => {
    try {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url, true);
      xhr.withCredentials = false;
      Object.entries(headers).forEach(([key, value]) => xhr.setRequestHeader(key, value));
      xhr.onload = async () => {
        const ok = xhr.status >= 200 && xhr.status < 300 || xhr.status === HTTP_STATUS_DUPLICATE;
        if (ok) {
          markProfilesSent(payload.profiles);
          await emit('afterSend', { success: true, payload });
        }
        resolve(ok);
      };
      xhr.onerror = () => resolve(false);
      xhr.send(encoded.body);
    } catch {
      resolve(false);
    }
  });
}

async function flushOffline() {
  const batch = await offlineQueue.drain(OFFLINE_DRAIN_BATCH);
  for (const item of batch) {
    const events = item.payload?.events || [];
    if (!events.length) continue;
    const ok = await sendPayload(events);
    if (!ok) {
      await offlineQueue.requeue(item.id, item.payload, (item.retries || 0) + 1);
    }
  }
}

const IMMEDIATE_FLUSH_EVENTS = new Set([
  'page_view',
  'product_view',
  'add_to_cart',
  'remove_from_cart',
  'add_to_wishlist',
  'remove_from_wishlist',
  'begin_checkout',
  'purchase',
  'refund',
  'payment_failure',
  'product_rating',
]);

function shouldFlushImmediately(eventName) {
  if (!IMMEDIATE_FLUSH_EVENTS.has(eventName)) return false;
  if (eventName === 'page_view') return config?.flushOnFirstPageView !== false;
  if (eventName === 'product_rating') return true;
  return config?.flushOnEcommerce !== false;
}

/** @param {Record<string, unknown>} event */
export function queueEvent(event) {
  pendingEvents.push(event);
  if (shouldFlushImmediately(event?.name)) {
    void flushQueue();
    return;
  }
  if (config?.batching && pendingEvents.length < batchLimit()) {
    scheduleFlush();
    return;
  }
  flushQueue();
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flushQueue();
  }, config?.batchInterval || 10_000);
}

export async function flushQueue() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  await flushOffline();

  if (!pendingEvents.length) {
    flushWaiters?.forEach((waiter) => waiter(true));
    flushWaiters = null;
    return true;
  }

  const events = pendingEvents.splice(0, batchLimit());
  const ok = await sendPayload(events);
  if (!ok && config?.offlineQueue) {
    await offlineQueue.enqueue({
      id: uuidV4(),
      payload: { events },
      retries: 0,
    });
  }
  flushWaiters?.forEach((waiter) => waiter(ok));
  flushWaiters = null;
  return ok;
}

export function startBatchTimer() {
  if (config?.batching && !batchIntervalTimer) {
    batchIntervalTimer = setInterval(() => {
      void flushQueue();
    }, config?.batchInterval || 10_000);
  }
  if (config?.flushOnUnload) {
    const onHide = () => flushQueue();
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') onHide();
    });
    window.addEventListener('pagehide', onHide);
    window.addEventListener('beforeunload', onHide);
  }
}

export function destroyTransport() {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  if (batchIntervalTimer) clearInterval(batchIntervalTimer);
  batchIntervalTimer = null;
  pendingEvents = [];
}

/** Send immediately — bypasses batch queue (session replay chunks). */
export function sendEventsImmediate(events, options = {}) {
  return sendPayload(events, options);
}

export { sendPayload };
