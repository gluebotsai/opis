import { uuidV4 } from '../utils/id.js';
import { config } from '../core/state.js';
import { log, warn } from '../core/logger.js';
import * as identity from '../identity/index.js';
import { getCachedClientIp } from '../utils/client-ip.js';
import { registerCurrentPage } from '../profiles/page.js';
import { gzipB64Encode } from './encode.js';

let chunkIndex = 0;
let snapshotAccepted = false;
/** @type {unknown[] | null} */
let pendingSnapshotBatch = null;
/** @type {Promise<boolean>} */
let sendChain = Promise.resolve(true);

function getEndpoint() {
  if (config?.replayEndpoint) return config.replayEndpoint;
  const base = config?.endpoint || '/v1/tracking/nfs-ingestions';
  if (base.includes('/nfs-ingestions')) return base;
  if (base.includes('/collect')) return base.replace(/\/collect\/?$/, '/nfs-ingestions');
  if (base.includes('/events')) return base.replace(/\/events\/?$/, '/nfs-ingestions');
  return base.replace(/\/?$/, '/nfs-ingestions');
}

function batchHasSnapshot(events) {
  return events.some((event) => event?.type === 2);
}

async function postOneBatch(rrwebEvents, index) {
  const eventsJson = JSON.stringify(rrwebEvents);
  let eventsData;
  try {
    eventsData = await gzipB64Encode(eventsJson);
  } catch (e) {
    warn('replay encode failed', e);
    return false;
  }

  const ids = identity.getIds();
  const body = {
    type: 'replay_chunk_v1',
    websiteId: config.websiteId,
    websiteUrl: config.websiteUrl || window.location.hostname,
    visitorId: ids.visitorId,
    sessionId: ids.sessionId,
    pageViewId: registerCurrentPage(),
    chunkIndex: index,
    chunkId: uuidV4(),
    encoding: 'gzip_b64',
    eventsData,
    eventCount: rrwebEvents.length,
    source: 'rrweb',
    payloadId: uuidV4(),
  };

  if (config.organizationId != null) body.organizationId = config.organizationId;

  const clientIp = getCachedClientIp();
  if (clientIp) body.clientIp = clientIp;

  const url = getEndpoint();
  const bodyStr = JSON.stringify(body);
  // keepalive requests are capped ~64KB in browsers — full DOM snapshots exceed that
  const useKeepalive = bodyStr.length <= 60_000;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: bodyStr,
      keepalive: useKeepalive,
      credentials: 'omit',
      mode: 'cors',
    });
    if (!res.ok && res.status !== 409) {
      const text = await res.text().catch(() => '');
      warn('replay ingest HTTP', res.status, url, text.slice(0, 120));
      return false;
    }
    chunkIndex = index + 1;
    if (batchHasSnapshot(rrwebEvents)) {
      snapshotAccepted = true;
      pendingSnapshotBatch = null;
    }
    if (config?.debug) log('replay chunk accepted', index, rrwebEvents.length, 'events');
    return true;
  } catch (e) {
    warn('replay send failed', url, e);
    if (batchHasSnapshot(rrwebEvents)) pendingSnapshotBatch = rrwebEvents;
    return false;
  }
}

function runSend(fn) {
  const run = sendChain.then(fn);
  sendChain = run.catch(() => false);
  return run;
}

/** @param {unknown[]} rrwebEvents */
export async function sendReplayChunk(rrwebEvents) {
  if (!rrwebEvents?.length || !config?.websiteId) return false;

  return runSend(async () => {
    if (batchHasSnapshot(rrwebEvents)) {
      pendingSnapshotBatch = rrwebEvents;
    } else if (!snapshotAccepted && pendingSnapshotBatch) {
      const snapshotOk = await postOneBatch(pendingSnapshotBatch, chunkIndex);
      if (!snapshotAccepted) return snapshotOk;
    }
    return postOneBatch(rrwebEvents, chunkIndex);
  });
}

export function flushReplayChunks() {
  return sendChain;
}

export function resetReplayChunkIndex() {
  chunkIndex = 0;
  snapshotAccepted = false;
  pendingSnapshotBatch = null;
  sendChain = Promise.resolve(true);
}

export function getReplayChunkState() {
  return {
    chunkIndex,
    snapshotAccepted,
    hasPendingSnapshot: Boolean(pendingSnapshotBatch),
  };
}
