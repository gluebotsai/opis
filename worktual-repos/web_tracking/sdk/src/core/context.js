import { generateId } from '../utils/id.js';
import { registerCurrentPage } from '../profiles/page.js';
import { getCampaignProfile } from '../profiles/campaign.js';
import { buildPayloadV3 } from './payload.js';
import { isCustomEventName } from './event-names.js';

/** @param {string} name @param {Record<string, unknown>} [properties] */
export function buildEvent(name, properties = {}) {
  const pageId = registerCurrentPage();
  const campaign = getCampaignProfile();
  const path = typeof window !== 'undefined'
    ? window.location.pathname + window.location.search
    : '';

  const event = {
    eventId: generateId('evt'),
    name,
    ts: Date.now(),
    pid: pageId,
  };

  if (isCustomEventName(name)) {
    event.event_mode = 'custom';
  }

  const props = {
    ...(path ? { path } : {}),
    ...properties,
  };
  if (Object.keys(props).length) event.props = props;
  if (campaign?.id) event.cid = campaign.id;

  return event;
}

/** @param {Array<Record<string, unknown>>} events */
export function buildPayload(events) {
  return buildPayloadV3(events);
}
