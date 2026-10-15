import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('page_view deduplication', () => {
  beforeEach(() => {
    vi.resetModules();
    document.cookie = '';
    localStorage.clear();
    sessionStorage.clear();
    history.replaceState({}, '', '/');
  });

  it('emits only one page_view per URL path', async () => {
    const queued = [];
    vi.doMock('../src/transport/sender.js', () => ({
      queueEvent: (event) => queued.push(event),
      flushQueue: vi.fn(),
      startBatchTimer: vi.fn(),
      destroyTransport: vi.fn(),
    }));

    const { setConfig } = await import('../src/core/state.js');
    const { trackPageView, setupSpaNavigation } = await import('../src/tracking/auto.js');

    setConfig({ trackJourney: false, autoTrack: true });
    setupSpaNavigation();

    trackPageView('Booxoo');
    trackPageView('Booxoo');
    trackPageView();

    expect(queued.filter((e) => e.name === 'page_view')).toHaveLength(1);
  });

  it('ignores history.replaceState when path is unchanged', async () => {
    const queued = [];
    vi.doMock('../src/transport/sender.js', () => ({
      queueEvent: (event) => queued.push(event),
      flushQueue: vi.fn(),
      startBatchTimer: vi.fn(),
      destroyTransport: vi.fn(),
    }));

    const { setConfig } = await import('../src/core/state.js');
    const { trackPageView, setupSpaNavigation } = await import('../src/tracking/auto.js');

    setConfig({ trackJourney: false, autoTrack: true });
    trackPageView();
    setupSpaNavigation();

    history.replaceState({}, '', '/');
    history.replaceState({}, '', '/');
    history.replaceState({}, '', '/');

    expect(queued.filter((e) => e.name === 'page_view')).toHaveLength(1);
  });

  it('tracks page_view again after SPA path change', async () => {
    const queued = [];
    vi.doMock('../src/transport/sender.js', () => ({
      queueEvent: (event) => queued.push(event),
      flushQueue: vi.fn(),
      startBatchTimer: vi.fn(),
      destroyTransport: vi.fn(),
    }));

    const { setConfig } = await import('../src/core/state.js');
    const { trackPageView, setupSpaNavigation } = await import('../src/tracking/auto.js');

    setConfig({ trackJourney: false, autoTrack: true });
    trackPageView();
    setupSpaNavigation();

    history.pushState({}, '', '/login?returnTo=/');

    expect(queued.filter((e) => e.name === 'page_view')).toHaveLength(2);
  });
});
