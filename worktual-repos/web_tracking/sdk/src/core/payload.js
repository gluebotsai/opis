/** Build compact events_v3 wire payloads with profile references. */

import { config } from './state.js';
import { PAYLOAD_TYPE_V3 } from './constants.js';
import * as identity from '../identity/index.js';
import { collectProfilesForBatch } from '../profiles/index.js';
import { getCachedClientIp } from '../utils/client-ip.js';

/** @param {Array<Record<string, unknown>>} events */
export function buildPayloadV3(events) {
  const ids = identity.getIds();
  const pageIds = [...new Set(events.map((event) => event.pid).filter(Boolean))];
  const profiles = collectProfilesForBatch(pageIds);

  const payload = {
    type: PAYLOAD_TYPE_V3,
    websiteId: config?.websiteId,
    websiteUrl: config?.websiteUrl || window.location.hostname,
    visitorId: ids.visitorId,
    sessionId: ids.sessionId,
    sdkVersion: config?.sdkVersion,
    sentAt: Date.now(),
    events: events.map(normalizeEvent),
  };

  if (config?.organizationId != null) {
    payload.organizationId = config.organizationId;
  }

  if (ids.userId) payload.userId = ids.userId;
  if (ids.anonymousId) payload.anonymousId = ids.anonymousId;
  if (profiles) payload.profiles = profiles;

  const clientIp = getCachedClientIp();
  if (clientIp) payload.clientIp = clientIp;

  return payload;
}

function normalizeEvent(event) {
  const normalized = {
    eventId: event.eventId,
    name: event.name,
    ts: event.ts || event.timestamp || Date.now(),
  };

  const props = event.props || event.properties;
  if (props && Object.keys(props).length) normalized.props = props;
  if (event.pid) normalized.pid = event.pid;
  if (event.cid) normalized.cid = event.cid;

  return normalized;
}
