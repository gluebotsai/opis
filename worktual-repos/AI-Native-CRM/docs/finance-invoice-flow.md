# Finance invoice flow (Phase 1–3)

Generic **Sales → Finance → Customer** billing for B2B tenants with the Finance module enabled.

## Phase 1 — offline lifecycle

1. **Create** — Quote accept creates order + draft invoice (`pending_approval`). Finance or Sales can also create from a deal; Sales submissions enter the Finance queue.
2. **Finance review** — Approve or reject (reason required). Customer is **not** emailed on submit.
3. **Send** — After approve, Finance sends PDF + payment instructions from the connected inbox.
4. **Collect** — Finance marks paid with optional offline reference (wire ref / UTR / cheque no.).
5. **Resend** — Same invoice only (`POST …/resend`); never duplicate an open bill for the same order.

## Phase 2 — online payments

1. **Configure** — Configuration → **Billing**: payment terms, bank details, Stripe/Razorpay keys, online/offline routing rules.
2. **Send / resend** — When routing resolves to **online**, Finance send creates (or reuses) a gateway payment link and includes it in the customer email.
3. **Webhook auto-paid** — Register org webhooks:
   - `POST /api/webhooks/stripe/:organizationId`
   - `POST /api/webhooks/razorpay/:organizationId`
4. **Withdraw / void** — Cancels active gateway links before reverting approval or voiding.

Payment links are created on **send**, not on approve (approve and send stay separate Finance actions).

## Invoice billing kinds

| Kind | Customer send |
|------|----------------|
| `standard` | Yes |
| `setup` | Yes |
| `subscription_start` | Yes |
| `renewal` | Yes |
| `amendment` | Yes |
| `adjustment` | No — internal record |
| `credit` | No — internal record |

## Special rules

- **Zero amount** — Auto-marked `paid` on Finance approve when org setting enabled (except `adjustment`).
- **Withdraw approval** — Allowed only while status is still `draft`; cancels any payment link.
- **Re-submit** — After `finance_rejected`, Sales or Finance returns invoice to `pending_approval`.
- **Void** — Finance can void draft / sent / overdue; not paid; cancels payment link.
- **Duplicate guard** — At most one open invoice (`draft` / `sent` / `overdue`) per order (org-configurable).

## Org settings

Per-tenant row: `crm.org_finance_settings` — edited in **Configuration → Billing**.

System fallbacks when unset: [`backend/src/config/finance-defaults.ts`](../backend/src/config/finance-defaults.ts).

## Phase 3 — subscriptions & renewals

1. **Renewal pipeline (3A)** — Daily cron `POST /api/cron/contract-renewals` creates renewal deals for contracts ending within the org renewal window; notifies `contract_renewal_due`. When the renewal deal is **closed won**, the existing contract term extends (no duplicate contract).
2. **Renewal quotes (3D)** — When enabled in Configuration → Billing, cron clones the last order lines into a draft quote on the renewal deal (`quotes.renewal_contract_id`). Manual: `POST /api/sales/contracts/:id/renewal-quote`.
3. **Scheduled billing (3B)** — Quote accept with setup + recurring lines creates **Inv1** (`setup`) immediately and schedules **Inv2** (`subscription_start`) from the billing cutoff day. Cron `POST /api/cron/billing-schedules` generates draft renewal/subscription invoices into the Finance queue. Invoices link `contract_id` / `billing_schedule_id`.
4. **Proration & amendments (3C)** — `GET /api/finance/contracts/:id/proration-preview` and `POST /api/sales/contracts/:id/amendment-quote` for mid-term add-ons; `amendment` invoices follow Phase 2 customer-send routing.

### Phase 3 org settings (Configuration → Billing)

| Setting | Default | Purpose |
|---------|---------|---------|
| Billing cutoff day | 20 | Subscription schedule + renewal invoice timing |
| Renewal window days | 30 | When to open renewal deals |
| Auto-renew default | off | New contracts inherit auto-renew |
| Auto-create renewal quote | on | Cron clones quote on renewal deal |

### Revenue at risk

`GET /api/finance/contracts/at-risk` — active contracts ending within 90 days with no renewal deal.

## Still out of scope

- Reseller, partner, multi-branch billing
- UAT / portal welcome / password rotation
- Commerce B2C checkout

## Batched test checklist (Phase 1–3)

1. Configure billing settings + Stripe/Razorpay test keys and webhook URLs
2. Quote accept → approve → reject → resubmit → withdraw (verify link cancelled)
3. Send online invoice → email contains link → webhook → auto paid
4. Send offline-only (above currency threshold) → no link → manual mark paid with reference
5. Resend reuses link; void cancels link
6. `adjustment` / `credit` blocked from customer send
7. Zero-amount approve → auto paid (no link)
8. Closed-won → contract; renewal cron → renewal deal + optional renewal quote
9. Setup + recurring quote accept → setup invoice + subscription schedule row
10. Billing-schedules cron → draft subscription/renewal invoice → approve → send → pay
11. Renewal invoice paid with auto-renew → contract `ends_at` rolls forward
12. Amendment quote + proration preview → `amendment` invoice path

## Key files

| Area | Path |
|------|------|
| Schema | `prisma/schema.prisma`, migrations `20260824220000_*`, `20260825020000_*`, `20260826020000_*` |
| Renewals | `backend/src/dao/sales/renewal-service.ts` |
| Contracts | `backend/src/service/sales/contract-commands.ts` |
| Schedules | `backend/src/dao/finance/billing-schedule-service.ts` |
| Proration | `backend/src/service/finance/proration.ts` |
| Org settings | `backend/src/dao/finance/org-finance-settings.ts` |
| Routing | `backend/src/service/finance/payment-routing.ts` |
| Gateways | `backend/src/service/finance/payment-gateways/` |
| Webhooks | `backend/src/modules/webhooks/payment-gateways.ts` |
| Commands / routes | `backend/src/service/finance/invoice-commands.ts`, `backend/src/modules/finance/routes.ts` |
| Configuration UI | `frontend/src/pages/FinanceBillingSettingsPage.tsx` |
| Finance UI | `frontend/src/pages/InvoiceDetailPage.tsx`, `frontend/src/pages/FinancePage.tsx` |
