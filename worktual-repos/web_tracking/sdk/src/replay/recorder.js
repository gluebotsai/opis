/**
 * Session replay — rrweb DOM recording.
 * Loads rrweb UMD → window.rrweb.record → gzip chunks via replay_chunk_v1.
 */

import { config, state } from '../core/state.js';
import { log, warn } from '../core/logger.js';
import { sendReplayChunk, flushReplayChunks, resetReplayChunkIndex } from './chunk-sender.js';

const CDN_RRWEB_URL =
  'https://nlp-storage.worktual.co.uk/wsnlp/Web_Tracking/JavaScript_sdk/vendor/rrweb/rrweb.min.js';
const LOCAL_RRWEB_URL = '/vendor/rrweb/rrweb.min.js';

const EventType = { FullSnapshot: 2, Meta: 4 };

/** @type {(() => void) | null} */
let stopRecord = null;
/** @type {unknown[]} */
let buffer = [];
let replayFlushTimer = null;
let flushRetryTimer = null;
let flushing = false;
let flushBackoffUntil = 0;
let paused = false;
let snapshotFlushed = false;
/** @type {Promise<{ record: Function }> | null} */
let rrwebLoadPromise = null;
const FLUSH_RETRY_MS = 5000;

function rrwebScriptUrl() {
  if (typeof window !== 'undefined') {
    const host = window.location.hostname;
    if (host === 'localhost' || host === '127.0.0.1') return LOCAL_RRWEB_URL;
  }
  if (config?.replayScriptUrl) return config.replayScriptUrl;
  return CDN_RRWEB_URL;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[data-wt-rrweb="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.wtRrweb = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`failed to load rrweb: ${src}`));
    document.head.appendChild(script);
  });
}

function loadRrweb() {
  if (!rrwebLoadPromise) {
    rrwebLoadPromise = (async () => {
      const win = /** @type {Window & { rrweb?: { record: Function } }} */ (window);
      if (win.rrweb?.record) return win.rrweb;
      await loadScript(rrwebScriptUrl());
      if (!win.rrweb?.record) throw new Error('rrweb.record not available after script load');
      return win.rrweb;
    })();
  }
  return rrwebLoadPromise;
}

function shouldSample() {
  const rate = config?.replaySampleRate ?? 1;
  if (rate >= 1) return true;
  if (rate <= 0) return false;
  if (state.replaySampled == null) state.replaySampled = Math.random() < rate;
  return state.replaySampled;
}

function maxEventsPerChunk() {
  return config?.replayMaxEventsPerChunk ?? 25;
}

function chunkIntervalMs() {
  return config?.replayChunkIntervalMs ?? 2000;
}

function mousemoveSampling() {
  const value = config?.replaySampleMousemove;
  if (value === false) return false;
  if (value === true) return 100;
  return value ?? 100;
}

function isSnapshotEvent(event) {
  return event?.type === EventType.FullSnapshot || event?.type === EventType.Meta;
}

function trimBuffer() {
  const max = config?.replayMaxBufferEvents ?? 80;
  if (buffer.length <= max) return;
  buffer = buffer.filter((event) => !snapshotFlushed || !isSnapshotEvent(event)).slice(-max);
}

function takeNextBatch() {
  const limit = maxEventsPerChunk();
  const batch = buffer.splice(0, limit);
  if (snapshotFlushed) return batch.filter((event) => !isSnapshotEvent(event));
  return batch;
}

function scheduleFlushRetry() {
  if (flushRetryTimer) return;
  flushBackoffUntil = Date.now() + FLUSH_RETRY_MS;
  flushRetryTimer = setTimeout(() => {
    flushRetryTimer = null;
    flushBackoffUntil = 0;
    void flushRrwebBuffer();
  }, FLUSH_RETRY_MS);
}

async function flushRrwebBuffer() {
  if (flushing) return flushReplayChunks();
  if (Date.now() < flushBackoffUntil) return flushReplayChunks();

  const batch = takeNextBatch();
  if (!batch.length) return flushReplayChunks();

  flushing = true;
  try {
    const ok = await sendReplayChunk(batch);
    if (!ok) {
      buffer.unshift(...batch);
      trimBuffer();
      scheduleFlushRetry();
      if (config?.debug) warn('rrweb flush failed — retry in', FLUSH_RETRY_MS, 'ms');
    } else {
      if (batch.some(isSnapshotEvent)) snapshotFlushed = true;
      if (buffer.length > 0) scheduleRrwebFlush();
    }
  } finally {
    flushing = false;
  }
  return flushReplayChunks();
}

function scheduleRrwebFlush() {
  if (replayFlushTimer) return;
  replayFlushTimer = setTimeout(() => {
    replayFlushTimer = null;
    void flushRrwebBuffer();
  }, chunkIntervalMs());
}

function onRrwebEmit(event) {
  if (paused) return;
  if (snapshotFlushed && isSnapshotEvent(event)) return;

  buffer.push(event);
  trimBuffer();

  if (!snapshotFlushed && event?.type === EventType.FullSnapshot) {
    void flushRrwebBuffer();
    return;
  }

  if (buffer.length >= maxEventsPerChunk()) {
    void flushRrwebBuffer();
    return;
  }
  scheduleRrwebFlush();
}

function onRrwebPageExit() {
  paused = false;
  void flushRrwebBuffer().then(() => flushReplayChunks());
}

export function setupSessionReplay() {
  if (state.modules.replay || config?.trackReplay === false) return;
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (!shouldSample()) return;

  state.modules.replay = true;
  snapshotFlushed = false;
  buffer = [];
  resetReplayChunkIndex();

  loadRrweb()
    .then((rrweb) => {
      if (!state.modules.replay) return;
      stopRecord = rrweb.record({
        emit: onRrwebEmit,
        checkoutEveryNms: config?.replayCheckoutEveryNms ?? 30_000,
        blockClass: config?.replayBlockClass ?? 'wt-no-replay',
        maskTextClass: config?.replayMaskTextClass ?? 'wt-mask',
        maskAllInputs: config?.replayMaskAllInputs ?? false,
        maskInputOptions: { password: true, ...(config?.replayMaskInputOptions || {}) },
        slimDOMOptions: config?.replaySlimDOM ?? 'all',
        inlineStylesheet: config?.replayInlineStylesheet !== false,
        recordCanvas: config?.replayRecordCanvas === true,
        sampling: {
          mousemove: mousemoveSampling(),
          mouseInteraction: config?.replaySampleMouseInteraction !== false,
          scroll: config?.replaySampleScroll ?? 150,
          media: config?.replaySampleMedia ?? 800,
          input: config?.replaySampleInput ?? 'last',
        },
      });
      if (config?.debug) log('rrweb session replay started', rrwebScriptUrl());
    })
    .catch((e) => {
      warn('rrweb session replay unavailable', e);
      state.modules.replay = false;
    });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') onRrwebPageExit();
    else paused = document.visibilityState !== 'visible';
  });
  window.addEventListener('pagehide', onRrwebPageExit);
  window.addEventListener('beforeunload', onRrwebPageExit);
}

export function teardownSessionReplay() {
  if (replayFlushTimer) {
    clearTimeout(replayFlushTimer);
    replayFlushTimer = null;
  }
  if (flushRetryTimer) {
    clearTimeout(flushRetryTimer);
    flushRetryTimer = null;
  }
  flushBackoffUntil = 0;
  if (stopRecord) {
    stopRecord();
    stopRecord = null;
  }
  onRrwebPageExit();
  buffer = [];
  flushing = false;
  snapshotFlushed = false;
  resetReplayChunkIndex();
  state.modules.replay = false;
}

export function flushReplayBuffer() {
  return flushRrwebBuffer();
}
