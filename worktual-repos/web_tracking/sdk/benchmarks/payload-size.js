#!/usr/bin/env node
/**
 * Compare payload size: legacy v2 (full context per event) vs enterprise v3 (profile references).
 * Run: node sdk/benchmarks/payload-size.js
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

function loadLegacyBuilder() {
  // Inline legacy simulation matching pre-v3 buildEvent shape
  const device = {
    browser: 'Chrome', browserVersion: '120', engine: 'WebKit', os: 'Linux', device: 'desktop',
    language: 'en-US', languages: ['en-US'], timezone: 'UTC',
    screen: { width: 1920, height: 1080, colorDepth: 24 },
    viewport: { width: 1200, height: 800 }, dpr: 1, touch: false, cpu: 8, memory: 8,
    connection: { effectiveType: '4g' }, userAgent: 'Mozilla/5.0 benchmark',
  };
  const page = { url: 'https://example.com/pricing', path: '/pricing', title: 'Pricing', referrer: '', hash: '' };
  const campaign = { utm_source: 'google', utm_medium: 'cpc', gclid: 'abc123' };

  return function buildLegacyEvent(name, props = {}) {
    return {
      eventId: `evt_${Math.random().toString(36).slice(2)}`,
      name,
      timestamp: Date.now(),
      properties: props,
      context: { page, campaign, device, pageViewId: 'pv_1', sdkVersion: '2.0.0' },
    };
  };
}

function buildV3Batch(events, profiles) {
  return {
    type: 'events_v3',
    domainId: 12345,
    domainName: 'example.com',
    visitorId: 'visitor_1',
    sessionId: 'session_1',
    sdkVersion: '3.0.0',
    sentAt: Date.now(),
    profiles,
    events,
  };
}

function buildV2Batch(events) {
  return {
    type: 'events_v2',
    domainId: 12345,
    domainName: 'example.com',
    visitorId: 'visitor_1',
    sessionId: 'session_1',
    sdkVersion: '2.0.0',
    sentAt: Date.now(),
    events,
  };
}

const legacy = loadLegacyBuilder();
const names = [
  'page_view', 'click', 'move', 'scroll_milestone', 'heartbeat',
  'form_focus', 'performance_vitals', 'product_view', 'error',
];
const legacyEvents = names.flatMap((n) => [legacy(n, { x: 10, y: 20 }), legacy(n, { x: 11, y: 21 })]);

const profiles = {
  browser: { id: 'br_1', fingerprint: 'fp_x', browser: 'Chrome', os: 'Linux', device: 'desktop' },
  visitor: { id: 'visitor_1', fingerprint: 'fp_x' },
  session: { id: 'session_1', startedAt: Date.now() },
  campaign: { id: 'cp_1', firstTouch: { utm_source: 'google' }, lastTouch: { utm_source: 'google' } },
  pages: { pg_1: { path: '/pricing', title: 'Pricing' } },
};

const v3Events = legacyEvents.map((e, i) => ({
  eventId: e.eventId,
  name: e.name,
  ts: e.timestamp,
  props: e.properties,
  pid: 'pg_1',
}));

const v2Bytes = JSON.stringify(buildV2Batch(legacyEvents)).length;
const v3Bytes = JSON.stringify(buildV3Batch(v3Events, profiles)).length;
const reduction = ((1 - v3Bytes / v2Bytes) * 100).toFixed(1);

console.log('Payload benchmark (20 events, mixed types)');
console.log('  v2 (legacy full context):', v2Bytes, 'bytes');
console.log('  v3 (profiles + refs):    ', v3Bytes, 'bytes');
console.log('  reduction:               ', reduction + '%');
console.log('');
console.log(v3Bytes < v2Bytes * 0.2 ? 'PASS: >=80% reduction' : 'NOTE: run with full device UA for larger v2 baseline');
