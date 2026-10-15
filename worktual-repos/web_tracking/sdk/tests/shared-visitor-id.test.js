import { describe, it, expect, beforeEach } from 'vitest';
import {
  SHARED_VISITOR_STORAGE_KEY,
  createVisitorId,
  getOrCreateVisitorId,
} from '../src/identity/shared-visitor-id.js';

describe('shared visitor id', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('creates visitor_<uuid> format', () => {
    const id = createVisitorId();
    expect(id).toMatch(/^visitor_[0-9a-f-]{36}$/i);
  });

  it('stores and reuses wt_visitor_id from localStorage', () => {
    localStorage.setItem(SHARED_VISITOR_STORAGE_KEY, 'visitor_existing-uuid');

    const id = getOrCreateVisitorId();

    expect(id).toBe('visitor_existing-uuid');
    expect(localStorage.getItem(SHARED_VISITOR_STORAGE_KEY)).toBe('visitor_existing-uuid');
  });

  it('creates and persists when wt_visitor_id is missing', () => {
    const id = getOrCreateVisitorId();

    expect(id).toMatch(/^visitor_/);
    expect(localStorage.getItem(SHARED_VISITOR_STORAGE_KEY)).toBe(id);
  });

  it('returns same id on second call', () => {
    const first = getOrCreateVisitorId();
    const second = getOrCreateVisitorId();
    expect(second).toBe(first);
  });
});
