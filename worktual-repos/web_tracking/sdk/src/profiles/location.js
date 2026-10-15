import { config } from '../core/state.js';
import { readJson, writeJson, isProfileSent, markProfileSent } from './store.js';
import { isTrackingAllowed } from '../privacy/consent.js';
import { log } from '../core/logger.js';

const LOCATION_KEY = 'location';
/** @type {Promise<Record<string, unknown>>|null} */
let pendingRequest = null;

function hasGeolocationApi() {
  return typeof navigator !== 'undefined' && typeof navigator.geolocation?.getCurrentPosition === 'function';
}

export function getLocationProfile() {
  return readJson(LOCATION_KEY);
}

export function locationProfilePending() {
  const profile = getLocationProfile();
  if (!profile || profile.permission !== 'granted') return false;
  return !isProfileSent('location');
}

export function markLocationProfileSent() {
  markProfileSent('location');
}

/** @param {GeolocationPosition} position */
function buildProfile(position) {
  return {
    source: 'gps',
    permission: 'granted',
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracy: position.coords.accuracy,
    altitude: position.coords.altitude ?? null,
    altitudeAccuracy: position.coords.altitudeAccuracy ?? null,
    heading: position.coords.heading ?? null,
    speed: position.coords.speed ?? null,
    capturedAt: Date.now(),
  };
}

/**
 * Ask the browser for GPS coordinates. Resolves when the user allows or denies.
 * @param {{ enableHighAccuracy?: boolean; timeout?: number; maximumAge?: number }} [options]
 */
export function requestLocation(options = {}) {
  if (!hasGeolocationApi()) {
    return Promise.resolve({ source: 'gps', permission: 'unsupported', capturedAt: Date.now() });
  }
  if (!isTrackingAllowed()) {
    return Promise.resolve({ source: 'gps', permission: 'denied', reason: 'consent', capturedAt: Date.now() });
  }

  const opts = {
    enableHighAccuracy: options.enableHighAccuracy ?? config?.geolocationHighAccuracy ?? true,
    timeout: options.timeout ?? config?.geolocationTimeout ?? 15000,
    maximumAge: options.maximumAge ?? config?.geolocationMaxAge ?? 60000,
  };

  if (pendingRequest) return pendingRequest;

  pendingRequest = new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const profile = buildProfile(position);
        writeJson(LOCATION_KEY, profile);
        pendingRequest = null;
        if (config?.debug) log('geolocation granted', profile.latitude, profile.longitude);
        resolve(profile);
      },
      (error) => {
        const permission = error.code === 1 ? 'denied' : 'unavailable';
        const profile = {
          source: 'gps',
          permission,
          capturedAt: Date.now(),
          error: error.message,
        };
        writeJson(LOCATION_KEY, profile);
        pendingRequest = null;
        if (config?.debug) log('geolocation', permission, error.message);
        resolve(profile);
      },
      opts,
    );
  });

  return pendingRequest;
}

/** Start GPS capture when geolocation is enabled in SDK config. */
export function initLocation() {
  if (!config?.geolocation) return;
  if (!hasGeolocationApi()) return;

  const existing = getLocationProfile();
  if (existing?.permission === 'granted') {
    if (config?.geolocationRefresh !== false) {
      requestLocation().catch(() => {});
    }
    return;
  }

  if (config?.geolocationPrompt !== false) {
    requestLocation().catch(() => {});
  }
}

export function getLocationPermissionState() {
  const profile = getLocationProfile();
  return profile?.permission ?? 'unknown';
}
