import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyLiveTrackingEvent, mergeLivePayload } from './mergeLiveUsers.js';

describe('mergeLivePayload', () => {
  it('replaces current_page with each ClickHouse poll', () => {
    const prev = {
      sessions: [{
        session_id: 's1',
        visitor_id: 'v1',
        current_page: '/products/new',
        current_page_ts: 200,
        last_activity: '2026-10-05T11:20:00.000Z',
      }],
    };
    const next = {
      sessions: [{
        session_id: 's1',
        visitor_id: 'v1',
        current_page: '/products/powered-blue-maxi',
        current_page_ts: 100,
        last_activity: '2026-10-05T11:21:00.000Z',
      }],
    };
    const merged = mergeLivePayload(prev, next);
    assert.equal(merged.sessions[0].current_page, '/products/powered-blue-maxi');
    assert.equal(merged.sessions[0].last_activity, '2026-10-05T11:21:00.000Z');
  });

  it('advances current_page on poll when CH sends newer path', () => {
    const prev = {
      sessions: [{
        session_id: 's1',
        visitor_id: 'v1',
        current_page: '/book-demo/',
        current_page_ts: 100,
        last_activity: '2026-10-09T10:00:00.000Z',
      }],
    };
    const next = {
      sessions: [{
        session_id: 's1',
        visitor_id: 'v1',
        current_page: '/pricing/',
        current_page_ts: 200,
        last_activity: '2026-10-09T10:01:00.000Z',
      }],
    };
    const merged = mergeLivePayload(prev, next);
    assert.equal(merged.sessions[0].current_page, '/pricing/');
  });

  it('collapses two sessions for the same visitor', () => {
    const next = {
      sessions: [
        { session_id: 's2', visitor_id: 'v1', current_page: '/bag', last_activity: 'b' },
        { session_id: 's1', visitor_id: 'v1', current_page: '/', last_activity: 'a' },
      ],
    };
    const merged = mergeLivePayload(null, next);
    assert.equal(merged.sessions.length, 1);
    assert.equal(merged.sessions[0].session_id, 's2');
    assert.equal(merged.active_sessions, 1);
  });
});

describe('applyLiveTrackingEvent', () => {
  it('does not change current_page from SSE (CH poll owns path)', () => {
    const prev = {
      sessions: [{
        session_id: 's1',
        visitor_id: 'v1',
        current_page: '/products/a',
        current_page_ts: 100,
      }],
    };
    const heartbeat = applyLiveTrackingEvent(prev, {
      type: 'heartbeat',
      session: {
        session_id: 's1',
        visitor_id: 'v1',
        current_page: '/',
        last_activity_ms: 200,
      },
    });
    assert.equal(heartbeat.sessions[0].current_page, '/products/a');

    const page = applyLiveTrackingEvent(heartbeat, {
      type: 'page_view',
      session: {
        session_id: 's1',
        visitor_id: 'v1',
        current_page: '/products/b',
        current_page_ts: 300,
        last_activity_ms: 300,
      },
    });
    assert.equal(page.sessions[0].current_page, '/products/a');
  });

  it('keeps CH page when SSE sends stale redis path', () => {
    const prev = {
      sessions: [{
        session_id: 's1',
        visitor_id: 'v1',
        current_page: '/products/new',
        current_page_ts: 200,
      }],
    };
    const next = applyLiveTrackingEvent(prev, {
      type: 'page_view',
      session: {
        session_id: 's1',
        visitor_id: 'v1',
        current_page: '/products/powered-blue-maxi',
        current_page_ts: 150,
      },
    });
    assert.equal(next.sessions[0].current_page, '/products/new');
  });

  it('reuses the visitor row when session_id rotates', () => {
    const prev = {
      sessions: [{
        session_id: 's1',
        visitor_id: 'v1',
        current_page: '/products/a',
        current_page_ts: 100,
      }],
    };
    const next = applyLiveTrackingEvent(prev, {
      type: 'page_view',
      session: {
        session_id: 's2',
        visitor_id: 'v1',
        current_page: '/cart',
        current_page_ts: 200,
      },
    });
    assert.equal(next.sessions.length, 1);
    assert.equal(next.sessions[0].session_id, 's2');
    assert.equal(next.sessions[0].current_page, '/products/a');
  });
});
