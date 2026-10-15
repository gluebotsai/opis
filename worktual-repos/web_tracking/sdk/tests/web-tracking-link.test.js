import { describe, it, expect } from 'vitest';
import {
  base62Decode,
  base62EncodePad6,
  base62EncodePad12,
  buildWebTrackingToken,
  decodeWebTrackingTokenSegments,
  extractWtToken,
  getWtQueryParam,
  parseWebTrackingToken,
  contactIdFromSegment,
  isValidWtToken,
  WT_TOKEN_LEN,
} from '../src/utils/web-tracking-link.js';
import { parseAttribution, hasAttribution, mergeAttribution } from '../src/utils/attribution.js';

const SECRET = 'test-secret-for-campaign-wt-token-decode';
const CAMPAIGN_QA_SECRET = 'change-me-web-tracking-hmac-secret-min-32-chars';

describe('web-tracking-link (30-char token)', () => {
  it('round-trips large CDP contact id', () => {
    const contactId = 1830917733048487n;
    const token = buildWebTrackingToken(1003, 1195, contactId, SECRET);
    expect(token).toHaveLength(WT_TOKEN_LEN);
    expect(isValidWtToken(token)).toBe(true);
    const parsed = parseWebTrackingToken(token, SECRET);
    expect(parsed.valid).toBe(true);
    expect(Number(parsed.organizationId)).toBe(1003);
    expect(Number(parsed.campaignId)).toBe(1195);
    expect(parsed.contactId).toBe(contactId);
    expect(contactIdFromSegment(parsed.contactId)).toBe(1830917733048487);
  });

  it('decodes Campaign ExactCid QA token with shared secret', () => {
    const token = '0000GB0000JH0008NuKfj5tP0asHSz';
    const parsed = parseWebTrackingToken(token, CAMPAIGN_QA_SECRET);
    expect(parsed.valid).toBe(true);
    expect(Number(parsed.organizationId)).toBe(1003);
    expect(Number(parsed.campaignId)).toBe(1195);
    expect(contactIdFromSegment(parsed.contactId)).toBe(1830917733048487);
  });

  it('decodes segments without secret (QA)', () => {
    const token = '0000GB0000JH0008NuKfj5tP0asHSz';
    const parsed = decodeWebTrackingTokenSegments(token);
    expect(parsed.valid).toBe(true);
    expect(Number(parsed.organizationId)).toBe(1003);
    expect(Number(parsed.campaignId)).toBe(1195);
    expect(contactIdFromSegment(parsed.contactId)).toBe(1830917733048487);
  });

  it('rejects tampered signature', () => {
    const token = buildWebTrackingToken(1003, 1195, 1830917733048487n, SECRET);
    const tampered = `${token.slice(0, 29)}X`;
    expect(parseWebTrackingToken(tampered, SECRET).valid).toBe(false);
  });

  it('rejects wrong secret', () => {
    const token = buildWebTrackingToken(1003, 1195, 1830917733048487n, SECRET);
    expect(parseWebTrackingToken(token, 'wrong-secret').valid).toBe(false);
  });

  it('rejects legacy 24-char tokens', () => {
    const legacy = '0000GB0000Hvc06Hf82dv5gc';
    expect(isValidWtToken(legacy)).toBe(false);
    expect(extractWtToken(`?wt=${legacy}`)).toBe(null);
    expect(decodeWebTrackingTokenSegments(legacy).valid).toBe(false);
  });
});

describe('extractWtToken', () => {
  it('extracts 30-char token from query', () => {
    const token = buildWebTrackingToken(1003, 1195, 1830917733048487n, SECRET);
    expect(extractWtToken(`?wt=${token}&utm_source=x`)).toBe(token);
    expect(extractWtToken(`?WT=${token}&utm_source=x`)).toBe(token);
    expect(getWtQueryParam('?WT=short')).toBe('short');
    expect(extractWtToken('')).toBe(null);
    expect(extractWtToken('?wt=short')).toBe(null);
    expect(extractWtToken('?wt=01234567890123456789012345')).toBe(null);
  });
});

describe('contactIdFromSegment', () => {
  it('omits contact id when segment decodes to zero', () => {
    expect(contactIdFromSegment(0n)).toBeUndefined();
    expect(contactIdFromSegment(1830917733048487n)).toBe(1830917733048487);
  });

  it('base62 encode/decode is reversible', () => {
    expect(base62Decode(base62EncodePad6(1003n))).toBe(1003n);
    expect(base62Decode(base62EncodePad12(1830917733048487n))).toBe(1830917733048487n);
  });
});

describe('parseAttribution with wt', () => {
  it('sets wt_* when token verifies with secret', () => {
    const token = buildWebTrackingToken(1003, 1195, 1830917733048487n, SECRET);
    const touch = parseAttribution(
      `?utm_source=worktual_campaign&utm_medium=email&wt=${token}`,
      '',
      { hmacSecret: SECRET },
    );
    expect(touch.wt_organization_id).toBe(1003);
    expect(touch.wt_campaign_id).toBe(1195);
    expect(touch.wt_contact_id).toBe(1830917733048487);
    expect(touch.utm_source).toBe('worktual_campaign');
    expect(hasAttribution(touch)).toBe(true);
  });

  it('ignores invalid wt length but keeps UTMs', () => {
    const touch = parseAttribution(
      '?utm_source=worktual_campaign&utm_medium=email&wt=01234567890123456789012345',
      '',
      { hmacSecret: SECRET },
    );
    expect(touch.wt_campaign_id).toBeUndefined();
    expect(touch.utm_source).toBe('worktual_campaign');
  });
});

describe('mergeAttribution carry-forward', () => {
  it('copies wt_* onto lastTouch when URL only has UTMs after strip', () => {
    const stored = {
      id: 'cp_test',
      firstTouch: {
        utm_source: 'worktual_campaign',
        wt_organization_id: 1003,
        wt_campaign_id: 1195,
        wt_contact_id: 1830917733048487,
      },
      lastTouch: {
        utm_source: 'worktual_campaign',
        wt_organization_id: 1003,
        wt_campaign_id: 1195,
        wt_contact_id: 1830917733048487,
      },
    };
    const incoming = parseAttribution('?utm_source=worktual_campaign&utm_medium=email', '', {});
    const merged = mergeAttribution(stored, incoming);
    expect(merged.lastTouch.wt_campaign_id).toBe(1195);
    expect(merged.lastTouch.wt_contact_id).toBe(1830917733048487);
  });
});
