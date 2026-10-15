# Internal — leads, quotations, payments, organizations

## Purpose

Sales pipeline → quotation → payment → organization/subscriptions. This is how customers enter My Account before Setup and product spokes unlock.

## Auth

| Area | Gate |
|------|------|
| Leads / quote sessions / create quotation | `requireAuth` (sales) |
| Finance quotation list / approve / reject | `requireFinanceAuth` |
| Mark paid / sync payment | `requireFinanceAuth` |
| Payment config / lead payment page | Public or light auth as coded |
| Org / subscription reads | `requireAuth` |

## Source map

| Layer | Path |
|-------|------|
| Client | [`src/lib/leads.js`](../../src/lib/leads.js), [`src/lib/quotations.js`](../../src/lib/quotations.js), [`src/lib/payments.js`](../../src/lib/payments.js), [`src/lib/quoteSession.js`](../../src/lib/quoteSession.js), [`src/lib/organizations.js`](../../src/lib/organizations.js) |
| Server | leads / quotations / payments / subscriptions modules via [`server/index.js`](../../server/index.js) |

## Endpoints

### Leads

| Method | Path | Client helper | Notes |
|--------|------|---------------|-------|
| GET | `/api/leads` | `getLeads` | `scope`, `pipelineOnly` query |
| GET | `/api/leads/:id` | `getLeadById` | |
| POST | `/api/leads` | `createLead` | |
| PUT | `/api/leads/:id` | `updateLead` | |
| POST | `/api/leads/:id/customer-portal-access` | `provisionCustomerPortalAccess` | Grant portal |
| GET | `/api/leads/:id/customer-portal-users` | portal user list | |

### Customers (converted orgs list)

| Method | Path | Client helper | Notes |
|--------|------|---------------|-------|
| GET | `/api/customers` | `getCustomers` | |
| GET | `/api/customers/portfolio` | `getCustomerPortfolio` | |

### Quote sessions (draft)

| Method | Path | Client | Notes |
|--------|------|--------|-------|
| GET | `/api/quote-sessions/:leadId` | quoteSession helpers | |
| PUT | `/api/quote-sessions/:leadId` | save draft | |
| DELETE | `/api/quote-sessions/:leadId` | clear draft | |

### Quotations & payments

| Method | Path | Client helper | Notes |
|--------|------|---------------|-------|
| POST | `/api/quotations` | `submitQuotation` | Sales submits |
| GET | `/api/quotations/statuses` | `fetchQuotationStatuses` | |
| GET | `/api/quotations` | `fetchFinanceQuotations` | Finance |
| GET | `/api/quotations/:id` | finance get | |
| POST | `/api/quotations/:id/approve` | `approveQuotation` | Creates payment intent path |
| POST | `/api/quotations/:id/reject` | `rejectQuotation` | |
| POST | `/api/quotations/:id/mark-paid` | `markQuotationPaid` | Finance |
| POST | `/api/quotations/:id/sync-payment` | `syncQuotationPayment` | |
| GET | `/api/quotations/payment/:leadId` | `fetchLeadPayment` | Checkout status |
| GET | `/api/payments/config` | `fetchPaymentConfig` | Public Stripe/Razorpay keys |

### Organizations & subscriptions (internal)

See also [customer/entitlements.md](../customer/entitlements.md) for the same `/api/v1/organizations` and `/api/v1/subscriptions` paths.

## Reuse notes

- Product spokes start **after** paid org exists; they consume entitlements, not lead APIs.
- Do not bypass quotation/payment when provisioning commercial products.
