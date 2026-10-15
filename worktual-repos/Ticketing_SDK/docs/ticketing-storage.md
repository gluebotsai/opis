# Customer and ticket storage

Postgres is the source of truth. A **customer** is a CDP person. Ticketing keeps a spoke pointer and copies name/email/phone onto each **ticket**. Orders and products stay in CDP; a ticket may store the verified `order_id` / `product_id` used at create.

Tenant key: `organization_id` → `accounts.organizations.id`.

---

## How they join

```
accounts.organizations
        │
        ├── cdp.customer_profile (cdp_id) + cdp.identity_keys (email / phone)
        │         │
        │         ├── cdp.orders + cdp.order_items
        │         │
        │         └── ticketing.contact_profile.cdp_id
        │                       │
        └── ticketing.tickets.customer_id  →  contact_profile.id
            tickets.customer_email / customer_name / customer_phone  (snapshot)
            tickets.order_id / product_id  (optional, from CDP at create)
                    │
                    └── ticketing.ticket_notes.ticket_id
```

Create requires an Active `contact_profile` for a CDP person in that org. Directory and 360 read CDP; they do not invent ids or names.

---

## Customer (person)

### `cdp.customer_profile`

Source of name and address. Join on `organization_id` + `cdp_id`.

Used fields: `cdp_id`, `first_name`, `last_name`, `created_at`, address / city / region / country in `custom_fields` or columns.

### `cdp.identity_keys`

Source of email and phone. Same `cdp_id` + org. `key_type` is `email` or `phone`; `key_value` is the address or number.

### `ticketing.contact_profile`

Spoke link only. **No** name, email, or phone columns.

| Column | Type | Notes |
|--------|------|--------|
| `id` | BIGSERIAL PK | What `tickets.customer_id` stores when numeric |
| `organization_id` | BIGINT NOT NULL | Tenant |
| `cdp_id` | TEXT NOT NULL | Unique per org — join to CDP |
| `external_id` | TEXT | Optional |
| `status` | TEXT NOT NULL DEFAULT `Active` | `Active` / `Inactive` |
| `total_tickets` | INTEGER NOT NULL DEFAULT 0 | Cached count |
| `account_id` | BIGINT | Optional B2B client `ticketing.ticketing_accounts` |
| `password_hash` / `password_set_at` / `last_portal_login_at` | | Portal login only |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

---

## Ticket (case for that customer)

### `ticketing.tickets`

One row per case. Customer fields are a **snapshot at create**. Live directory still uses CDP.

| Column | Type | Notes |
|--------|------|--------|
| `id` | BIGSERIAL PK | Internal id |
| `organization_id` | BIGINT NOT NULL | Tenant |
| `ticket_number` | VARCHAR(64) NOT NULL | e.g. `#12503` |
| `subject` | VARCHAR(255) NOT NULL | |
| `description` | TEXT NOT NULL DEFAULT `''` | Issue body |
| `status` | VARCHAR(32) NOT NULL DEFAULT `Open` | |
| `priority` | VARCHAR(32) NOT NULL DEFAULT `medium` | |
| `customer_id` | BIGINT | `contact_profile.id` |
| `customer_name` | TEXT NOT NULL DEFAULT `''` | Snapshot from CDP |
| `customer_email` | TEXT NOT NULL DEFAULT `''` | Snapshot from CDP |
| `customer_phone` | TEXT | Snapshot from CDP |
| `channel` | TEXT NOT NULL DEFAULT `Web` | `Email` / `Chat` / `Phone` / `Web` |
| `assignee_id` / `assignee_name` | BIGINT / TEXT | L1 staff |
| `resolver_id` / `resolver_name` | BIGINT / TEXT | L2 staff |
| `queue_id` / `queue_name` | BIGINT / TEXT | Team |
| `attachments` | TEXT[] NOT NULL DEFAULT `{}` | `/uploads/…` |
| `due_at` | TIMESTAMPTZ | SLA deadline |
| `first_response_at` | TIMESTAMPTZ | |
| `resolved_at` | TIMESTAMPTZ | |
| `csat_score` | INTEGER | |
| `csat_rated_at` | TIMESTAMPTZ | |
| `csat_comment` | TEXT | |
| `category` / `skill` / `ai_summary` | TEXT | Triage |
| `last_customer_inbound_channel` | TEXT | |
| `portal_chat_session_id` | TEXT | |
| `order_id` | TEXT | Verified CDP order at create |
| `product_id` | TEXT | Line on that order at create |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

List this customer’s tickets: same org and (`customer_id` or lower `customer_email` match).

Order-related create: verify the order belongs to this CDP person, store `order_id` and optional `product_id`. A second ticket for the same customer + same `order_id` is refused.

---

## Ticket conversation

### `ticketing.ticket_notes`

| Column | Type | Notes |
|--------|------|--------|
| `id` | BIGSERIAL PK | |
| `organization_id` | BIGINT NOT NULL | |
| `ticket_id` | BIGINT NOT NULL | → `tickets.id` |
| `author_id` | BIGINT | Staff `agents.id` when staff |
| `author_name` | TEXT NOT NULL | |
| `body` | TEXT NOT NULL | |
| `visibility` | TEXT | `internal` or public (customer-visible) when present |
| `created_at` | TIMESTAMPTZ | |

---

## Customer orders (360 / create check)

Not stored as ticket children. Read from CDP for this person’s `cdp_id`.

| Table | What it holds |
|-------|----------------|
| `cdp.orders` | `order_id`, `order_number`, status, payment, fulfillment, amounts, dates, `custom_fields` |
| `cdp.order_items` | `product_id`, quantity, unit price, title/SKU in `custom_fields` |
| `cdp.products` | Name / SKU for line labels |

`get_customer_order` / ticket panel Order Details use these. Only the chosen ids are copied onto `tickets.order_id` and `tickets.product_id`.

---

## Quick lookup

| Need | Table / columns |
|------|-----------------|
| Who the person is | `cdp.customer_profile` + `cdp.identity_keys` |
| Spoke customer id | `ticketing.contact_profile.id` / `cdp_id` |
| Ticket + requester snapshot | `ticketing.tickets` (`customer_*`, subject, status, CSAT, …) |
| Order/product on that ticket | `tickets.order_id`, `tickets.product_id` |
| Full order / lines | `cdp.orders`, `cdp.order_items` |
| Notes on the ticket | `ticketing.ticket_notes` |
