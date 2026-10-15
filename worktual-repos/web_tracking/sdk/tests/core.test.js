import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('WorktualAnalytics', () => {
  beforeEach(() => {
    vi.resetModules();
    document.cookie = '';
    localStorage.clear();
    sessionStorage.clear();
  });

  it('generates unique IDs', async () => {
    const { generateId, uuidV4 } = await import('../src/utils/id.js');
    expect(generateId('test')).toMatch(/^test_/);
    expect(uuidV4()).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('sanitizes sensitive properties', async () => {
    const { sanitizeProperties } = await import('../src/privacy/consent.js');
    const result = sanitizeProperties({ password: 'secret', name: 'John' });
    expect(result.password).toBe('[REDACTED]');
    expect(result.name).toBe('John');
  });

  it('requires websiteId on init', async () => {
    const api = (await import('../src/index.js')).default;
    expect(() => api.init({})).toThrow('websiteId');
  });

  it('accepts website_id and website_url snake_case aliases', async () => {
    const { mergeConfig } = await import('../src/core/config.js');
    const cfg = mergeConfig({
      website_id: 12345,
      website_url: 'https://beta.worktual.co.uk',
      organizationId: 1,
    });
    expect(cfg.websiteId).toBe(12345);
    expect(cfg.websiteUrl).toBe('https://beta.worktual.co.uk');
    expect(cfg.organizationId).toBe(1);
    expect(cfg.website_id).toBeUndefined();
  });

  it('sends organizationId on wire when set in init', async () => {
    const { setConfig } = await import('../src/core/state.js');
    const { buildPayloadV3 } = await import('../src/core/payload.js');
    setConfig({
      websiteId: 22233,
      websiteUrl: 'https://ave.com',
      organizationId: 7778,
      sdkVersion: 'test',
    });
    const payload = buildPayloadV3([
      { eventId: 'e1', name: 'page_view', ts: Date.now(), pid: 'p1' },
    ]);
    expect(payload.websiteId).toBe(22233);
    expect(payload.websiteUrl).toBe('https://ave.com');
    expect(payload.organizationId).toBe(7778);
    expect(payload.organization_id).toBeUndefined();
  });

  it('initializes with websiteId', async () => {
    const api = (await import('../src/index.js')).default;
    api.init({
      websiteId: 11111,
      websiteUrl: 'https://example.com',
      organizationId: 1,
      endpoint: 'http://localhost:8001/v1/tracking/collect',
      consent: { analytics: true },
      autoTrack: false,
      trackForms: false,
      trackPerformance: false,
      trackHeatmap: false,
      trackErrors: false,
    });
    expect(api.getVisitorId()).toBeTruthy();
    expect(api.getSessionId()).toBeTruthy();
    api.destroy();
  });

  it('tracks events through pipeline', async () => {
    const api = (await import('../src/index.js')).default;
    api.init({
      websiteId: 11111,
      consent: { analytics: true },
      autoTrack: false,
      batching: false,
      trackForms: false,
      trackPerformance: false,
      trackHeatmap: false,
      trackErrors: false,
    });
    api.track('test_event', { foo: 'bar' });
    expect(api.getVisitorId()).toBeTruthy();
    api.destroy();
  });

  it('blocks tracking when analytics consent is explicitly denied', async () => {
    const api = (await import('../src/index.js')).default;
    api.init({
      websiteId: 11111,
      consent: { analytics: false },
      autoTrack: false,
      trackForms: false,
      trackPerformance: false,
      trackHeatmap: false,
      trackErrors: false,
    });
    const { isTrackingAllowed } = await import('../src/privacy/consent.js');
    expect(isTrackingAllowed()).toBe(false);
    expect(api.getVisitorId()).toBeFalsy();
    expect(localStorage.getItem('wt_visitor_id')).toBeNull();

    api.setConsent({ analytics: true });
    expect(isTrackingAllowed()).toBe(true);
    expect(api.getVisitorId()).toBeTruthy();
    expect(localStorage.getItem('wt_visitor_id')).toBeTruthy();
    api.destroy();
  });

  it('restarts tracking when consent is granted again', async () => {
    const api = (await import('../src/index.js')).default;
    api.init({
      websiteId: 11111,
      consent: { analytics: true },
      autoTrack: false,
      trackForms: false,
      trackPerformance: false,
      trackHeatmap: false,
      trackErrors: false,
    });
    api.setConsent({ analytics: false });
    const { isTrackingAllowed } = await import('../src/privacy/consent.js');
    expect(isTrackingAllowed()).toBe(false);

    api.setConsent({ analytics: true });
    expect(isTrackingAllowed()).toBe(true);
    expect(api.getVisitorId()).toBeTruthy();
    api.destroy();
  });

  it('masks password fields', async () => {
    const { shouldMaskField } = await import('../src/privacy/consent.js');
    const input = document.createElement('input');
    input.type = 'password';
    expect(shouldMaskField(input)).toBe(true);
  });
});
