# Shopify Standard Product Taxonomy (pinned)

Download release assets (do NOT use deprecated `dist/` from git after 2026-10-31):

```bash
python scripts/pin_shopify_taxonomy.py --version v2026-08
```

Required files in this directory:

- `categories.en.json.gz`
- `attributes.en.json.gz`
- `attribute_values.en.json.gz`
- `integrations.all_mappings.en.json.gz`

Canonical SKU term id: `shopify:gid://shopify/TaxonomyCategory/...`

Google `google_product_category` ids come **only** from `integrations.all_mappings.en.json.gz`.
