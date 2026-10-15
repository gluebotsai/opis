import {
  initSessionMeta,
  getSessionProfile,
  sessionProfilePending,
  markSessionProfileSent,
} from './session.js';
import {
  getBrowserProfile,
  browserProfilePending,
  markBrowserProfileSent,
} from './browser.js';
import {
  getVisitorProfile,
  visitorProfilePending,
  markVisitorProfileSent,
} from './visitor.js';
import {
  getCampaignProfile,
  primeCampaignProfile,
} from './campaign.js';
import {
  getLocationProfile,
  initLocation,
  locationProfilePending,
  markLocationProfileSent,
  requestLocation,
  getLocationPermissionState,
} from './location.js';
import { collectNewPageProfiles, registerCurrentPage, markPageProfilesSent } from './page.js';
import { config } from '../core/state.js';
import * as identity from '../identity/index.js';

export function initProfiles() {
  initSessionMeta();
  getBrowserProfile();
  registerCurrentPage();
  initLocation();
  primeCampaignProfile();
}

export function collectProfilesForBatch(pageIds = []) {
  const ids = identity.getIds();
  const batchProfiles = {};
  const resend = config?.resendProfiles === true;

  if (resend || browserProfilePending()) {
    batchProfiles.browser = getBrowserProfile();
  }
  if (resend || visitorProfilePending()) {
    batchProfiles.visitor = getVisitorProfile();
  }
  if (resend || sessionProfilePending(ids.sessionId)) {
    batchProfiles.session = getSessionProfile();
  }
  const campaignProfile = getCampaignProfile();
  if (campaignProfile) {
    batchProfiles.campaign = campaignProfile;
  }

  if (config?.geolocation) {
    const locationProfile = getLocationProfile();
    if (locationProfile?.permission === 'granted') {
      batchProfiles.location = locationProfile;
    } else if (resend || locationProfilePending()) {
      const cached = getLocationProfile();
      if (cached?.permission === 'granted') {
        batchProfiles.location = cached;
      }
    }
  }

  const pages = collectNewPageProfiles(pageIds, resend);
  if (pages) batchProfiles.pages = pages;

  return Object.keys(batchProfiles).length ? batchProfiles : undefined;
}

/** Mark profile sync flags only after a successful send. */
export function markProfilesSent(profiles) {
  if (!profiles || config?.resendProfiles) return;
  const sessionId = identity.getIds().sessionId;
  if (profiles.browser) markBrowserProfileSent();
  if (profiles.visitor) markVisitorProfileSent();
  if (profiles.session && sessionId) markSessionProfileSent(sessionId);
  if (profiles.location) markLocationProfileSent();
  if (profiles.pages) markPageProfilesSent(profiles.pages);
}

export { requestLocation, getLocationPermissionState, getLocationProfile };
