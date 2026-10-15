# Business segmentation (BA spec)

Source: BA document **“B2B segment”** (B2B, B2C, Hybrid, Generic).

## Organization profile (PostgreSQL)

| Column | Table | Values |
|--------|--------|--------|
| `business_type` | `accounts.organizations` | `B2B`, `B2C` |

Read via `getOrganizationBusinessType()` → dashboard **segmentation profile** (labels and validation), not a hard filter on visitors.

## Intent level (dashboard)

**Intent level** (this **website_id** only, selected period):

| Level | Rules (first match wins) |
|-------|---------------------------|
| **High** | Purchase or any form submit; or strong session engagement (5+ pageviews and 2+ min); or combined signal score ≥ 4 |
| **Medium** | Signal score ≥ 2 (work/personal email, company trait, pricing/demo or product/cart paths, cart, forms, login) |
| **Low** | No signals, or bounce/single-page session |

## Page engagement (dashboard)

**Page engagement** uses `{websiteId}` only — never other websites in the org.

| Org profile | Paths used for peak / threshold |
|-------------|----------------------------------|
| **B2B** | pricing, demo, contact sales, enterprise, docs |
| **B2C** | product, cart, checkout, shop, category |
| **Default** | All paths on this site |

Classifier utilities in `visitorAudienceClassifier.ts` remain for tests and future use; audience breakdown is not exposed in the API.

## Code

| Piece | Path |
|--------|------|
| Profile + validator | `api-node/src/utils/businessSegmentationProfile.ts` |
| Classifier (tests + path regex) | `api-node/src/utils/visitorAudienceClassifier.ts` |
| CH aggregation | `api-node/src/repositories/clickhouse/segmentationRepository.ts` |
| UI | `web/src/components/VisitorSegmentationOverview.jsx` |

## Tests

```bash
cd api-node && node --test src/utils/visitorAudienceClassifier.test.ts src/utils/businessSegmentationProfile.test.ts
```
