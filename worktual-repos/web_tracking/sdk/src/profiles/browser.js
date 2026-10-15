/** Static browser/device profile — generated once per visitor. */

import { generateId } from '../utils/id.js';
import { getDeviceContext } from '../utils/device.js';
import { isProfileSent, markProfileSent, readJson, writeJson } from './store.js';

const BROWSER_PROFILE_KEY = 'browser';

function fingerprint(device) {
  const parts = [
    device.browser,
    device.browserVersion,
    device.os,
    device.device,
    device.language,
    device.timezone,
    device.screen?.width,
    device.screen?.height,
    device.dpr,
    device.cpu,
    device.touch ? 1 : 0,
  ].join('|');
  let h = 0;
  for (let i = 0; i < parts.length; i++) h = ((h << 5) - h + parts.charCodeAt(i)) | 0;
  return `fp_${Math.abs(h).toString(36)}`;
}

function isValidBrowserProfile(cached) {
  return cached && typeof cached === 'object' && typeof cached.browser === 'string';
}

export function getBrowserProfile(force = false) {
  const cached = readJson(BROWSER_PROFILE_KEY);
  if (isValidBrowserProfile(cached) && !force) return cached;

  const device = getDeviceContext();
  const profile = {
    id: isValidBrowserProfile(cached) ? cached.id : generateId('br'),
    fingerprint: fingerprint(device),
    userAgent: device.userAgent,
    browser: device.browser,
    browserVersion: device.browserVersion,
    engine: device.engine,
    os: device.os,
    device: device.device,
    language: device.language,
    languages: device.languages,
    timezone: device.timezone,
    screen: device.screen,
    viewport: device.viewport,
    dpr: device.dpr,
    touch: device.touch,
    cpu: device.cpu,
    memory: device.memory,
    connection: device.connection,
  };
  writeJson(BROWSER_PROFILE_KEY, profile);
  return profile;
}

export function browserProfilePending() {
  return !isProfileSent(BROWSER_PROFILE_KEY);
}

export function markBrowserProfileSent() {
  markProfileSent(BROWSER_PROFILE_KEY);
}
