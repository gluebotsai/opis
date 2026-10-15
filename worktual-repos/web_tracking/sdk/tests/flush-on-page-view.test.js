import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('flushOnFirstPageView', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, status: 200, statusText: 'OK' }),
    );
  });

  it('defaults flushOnFirstPageView to true in mergeConfig', async () => {
    const { mergeConfig } = await import('../src/core/config.js');
    const cfg = mergeConfig({ websiteId: 1 });
    expect(cfg.flushOnFirstPageView).toBe(true);
  });

  it('POSTs immediately when page_view is queued (click stays batched)', async () => {
    const { setConfig } = await import('../src/core/state.js');
    const { queueEvent, destroyTransport } = await import('../src/transport/sender.js');

    setConfig({
      websiteId: 1011,
      websiteUrl: 'example.com',
      sdkVersion: 'test',
      batching: true,
      batchInterval: 10_000,
      batchSize: 50,
      flushOnFirstPageView: true,
      endpoint: 'https://example.com/v1/tracking/nfs-ingestions',
      compressPayloads: false,
    });
    destroyTransport();

    queueEvent({ eventId: 'e0', name: 'click', ts: Date.now(), pid: 'p1' });
    expect(fetch).not.toHaveBeenCalled();

    queueEvent({ eventId: 'e1', name: 'page_view', ts: Date.now(), pid: 'p1' });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const [, init] = fetch.mock.calls[0];
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body.events.some((e) => e.name === 'page_view')).toBe(true);
    expect(body.events.some((e) => e.name === 'click')).toBe(true);

    destroyTransport();
  });

  it('POSTs immediately when add_to_cart is queued', async () => {
    const { setConfig } = await import('../src/core/state.js');
    const { queueEvent, destroyTransport } = await import('../src/transport/sender.js');

    setConfig({
      websiteId: 1011,
      websiteUrl: 'example.com',
      sdkVersion: 'test',
      batching: true,
      batchInterval: 10_000,
      batchSize: 50,
      flushOnFirstPageView: true,
      flushOnEcommerce: true,
      endpoint: 'https://example.com/v1/tracking/nfs-ingestions',
      compressPayloads: false,
    });
    destroyTransport();

    queueEvent({
      eventId: 'e2',
      name: 'add_to_cart',
      ts: Date.now(),
      pid: 'p1',
      props: { productId: 'sku-1' },
    });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    destroyTransport();
  });
});
