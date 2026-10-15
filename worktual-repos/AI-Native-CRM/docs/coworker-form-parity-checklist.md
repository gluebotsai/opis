# Coworker chat ↔ form field parity — smoke checklist

## Ownership
- [ ] Chat “rename this product” / “set price to 99” updates via Fastify (Vite handler), not MCP SQL-only name
- [ ] Same for company domain/industry and deal notes/expected close date
- [ ] Stage changes still use `propose_stage_change` / `updateDealStage`

## Product
- [ ] Create fixed product: name, sku, price, currency, max discount, tags, description, image URL
- [ ] Create customizable: offers + addons collected in chat/draft; saved on create
- [ ] Update: tags / maxDiscountPercent / description survive propose_update_product

## Contact
- [ ] Create with addressLine / tags / BANT patches
- [ ] Update uses `addressLine` (not `address`) and persists

## Company / Deal
- [ ] Company create can set ownerUserId / channelRole / parentCompanyId from draft
- [ ] Deal draft accepts contactName + currency; update notes/close date

## Invoice / Quote
- [ ] Invoice create requires deal **and** productId (no silent first-catalog-product qty 1)
- [ ] Quote patch accepts addonQuantities

## Regression
- [ ] Meeting brief / MOM / nurture CRM-BOT paths unchanged
