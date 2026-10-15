import { generateId } from '../utils/id.js';
import { buildEvent } from '../core/context.js';
import { config, state } from '../core/state.js';
import { touchSession } from '../identity/index.js';
import { registerCurrentPage } from '../profiles/page.js';
import { onPageTransition } from '../profiles/journey.js';
import { sanitizeProperties } from '../privacy/consent.js';
import { queueEvent } from '../transport/sender.js';
import { isOutboundLink, isDownloadLink } from '../utils/url.js';
import {
  USER_IDLE_MS,
  SEARCH_QUERY_MAX_LEN,
  ELEMENT_TEXT_MAX_LEN,
} from '../core/constants.js';
import { createTracker } from './tracker.js';

const { bindTrack, track: autoTrackFn } = createTracker();
export { bindTrack };

function currentPath() {
  return window.location.pathname + window.location.search;
}

function currentPathname() {
  return window.location.pathname || '/';
}

export function trackPageView(name, props = {}) {
  const path = currentPath();
  if (state.trackedPagePath === path) return;
  state.trackedPagePath = path;
  state.pageViewId = generateId('pv');
  registerCurrentPage();
  if (config?.trackJourney !== false) onPageTransition(autoTrackFn);
  touchSession();
  const event = buildEvent('page_view', sanitizeProperties({
    pageName: name || document.title,
    path,
    title: document.title,
    ...props,
  }));
  queueEvent(event);
}

function dispatchNavigationIfPathChanged() {
  const pathname = currentPathname();
  if (pathname === state.lastNavigationPath) return;
  state.lastNavigationPath = pathname;
  window.dispatchEvent(new Event('wa:navigation'));
}

export function setupSpaNavigation() {
  if (state.modules.spa) return;
  state.modules.spa = true;
  state.lastNavigationPath = currentPathname();

  const origPush = history.pushState;
  const origReplace = history.replaceState;

  history.pushState = function (...args) {
    origPush.apply(this, args);
    dispatchNavigationIfPathChanged();
  };
  history.replaceState = function (...args) {
    origReplace.apply(this, args);
    dispatchNavigationIfPathChanged();
  };

  window.addEventListener('popstate', dispatchNavigationIfPathChanged);
  window.addEventListener('wa:navigation', () => trackPageView());
}

export function setupAutoTracking() {
  if (!config?.autoTrack) return;

  trackPageView();
  setupSpaNavigation();
  setupEngagement();
  const heatmapHandlesClicks = config?.trackHeatmap !== false && config?.trackHeatmapClicks !== false;
  if (!heatmapHandlesClicks) setupClicks();
  if (config?.trackScroll !== false) setupScrollMilestones();
  setupVisibility();
  setupOutbound();
  setupDownloads();
  setupSearch();
}

function addListener(target, event, handler, options) {
  target.addEventListener(event, handler, options);
  state.listeners.push(() => target.removeEventListener(event, handler, options));
}

function setupEngagement() {
  let idle = false;
  let idleTimer = null;

  const onActivity = () => {
    state.isActive = true;
    touchSession();
    if (idle) {
      idle = false;
      autoTrackFn('user_active', {});
    }
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      idle = true;
      state.isActive = false;
      autoTrackFn('user_idle', { idleMs: USER_IDLE_MS });
    }, USER_IDLE_MS);
  };

  ['mousedown', 'keydown', 'scroll', 'touchstart'].forEach((ev) => {
    addListener(document, ev, onActivity, { passive: true });
  });
}

function setupClicks() {
  addListener(document, 'click', function onAutoClick(e) {
    const el = /** @type {HTMLElement} */ (e.target)?.closest?.('a,button,[role=button]');
    if (!el) return;
    autoTrackFn('click', {
      element: el.tagName?.toLowerCase(),
      text: (el.textContent || '').slice(0, ELEMENT_TEXT_MAX_LEN),
      href: el.getAttribute('href') || undefined,
      x: e.clientX,
      y: e.clientY,
    });
  }, true);
}

function setupScrollMilestones() {
  const milestones = config?.scrollMilestones || [25, 50, 75, 90, 100];
  const reached = new Set();
  let ticking = false;

  addListener(window, 'scroll', function onScroll() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      const doc = document.documentElement;
      const depth = Math.round(((window.scrollY + window.innerHeight) / doc.scrollHeight) * 100);
      for (const milestone of milestones) {
        if (depth >= milestone && !reached.has(milestone)) {
          reached.add(milestone);
          autoTrackFn('scroll_milestone', { milestone, maxDepth: depth });
        }
      }
      ticking = false;
    });
  }, { passive: true });
}

function setupVisibility() {
  addListener(document, 'visibilitychange', function onVisibility() {
    autoTrackFn(document.visibilityState === 'visible' ? 'page_visible' : 'page_hidden', {});
  });
}

function setupOutbound() {
  addListener(document, 'click', function onOutbound(e) {
    const anchor = /** @type {HTMLElement} */ (e.target)?.closest?.('a[href]');
    if (!anchor) return;
    const href = anchor.getAttribute('href');
    if (!href || !isOutboundLink(href)) return;
    autoTrackFn('outbound_link', {
      href,
      text: (anchor.textContent || '').slice(0, ELEMENT_TEXT_MAX_LEN),
    });
  }, true);
}

function setupDownloads() {
  addListener(document, 'click', function onDownload(e) {
    const anchor = /** @type {HTMLElement} */ (e.target)?.closest?.('a[href]');
    if (!anchor) return;
    const href = anchor.getAttribute('href') || '';
    if (!isDownloadLink(href)) return;
    autoTrackFn('file_download', { href, fileName: href.split('/').pop() });
  }, true);
}

function setupSearch() {
  addListener(document, 'submit', function onSearch(e) {
    const form = /** @type {HTMLFormElement} */ (e.target);
    if (!form || form.hasAttribute('data-wa-skip')) return;
    const input = form.querySelector('input[type=search], input[name=q], input[name=query], input[name=search]');
    if (input) {
      autoTrackFn('site_search', { query: maskSearch(input.value), formId: form.id || form.name });
    }
  }, true);
}

function maskSearch(value) {
  if (!value) return '';
  return value.length > SEARCH_QUERY_MAX_LEN
    ? value.slice(0, SEARCH_QUERY_MAX_LEN) + '…'
    : value;
}

export function teardownAutoTracking() {
  state.listeners.forEach((removeListener) => removeListener());
  state.listeners = [];
  state.modules = {};
}
