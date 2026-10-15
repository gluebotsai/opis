# CDP customer identity (CRM read/write existing columns only)

CRM contacts use the shared Worktual CDP person store. **Never** `CREATE`/`ALTER`/`DROP` objects in `cdp` or `accounts`.

## Tables

| Table | Role |
|-------|------|
| `cdp.customer_profile` | Person / firmographic profile (`cdp_id` PK) |
| `cdp.identity_keys` | Emails, phones, other keys (`identity_id` PK; FK `cdp_id` CASCADE) |
| `crm.contact_profiles` | CRM overlay; `account_contact_id` = `cdp_id` |

## `identity_keys.key_type` conventions (CRM)

| key_type | Meaning |
|----------|---------|
| `email` | Primary email |
| `phone` | Primary phone |
| `email_secondary` | Additional email |
| `phone_secondary` | Additional phone |

Unique per tenant: `(organization_id, key_type, key_value)`.

Normalize: emails lowercased and trimmed; phones trimmed.

On write set `source_system = 'crm'`, `verified = false` unless product sets otherwise.

## Profile `custom_fields` keys used by CRM

| Key | Meaning |
|-----|---------|
| `title` | Job title |
| `industry` | Company industry (no dedicated column) |
| `company_domain` | Company domain |
| `address_line` | Street / line address (region column may also hold region) |

## Soft delete

CDP has no `is_active`. Soft-archive lives on **`crm.contact_profiles.status`**. Hard-delete of a CDP profile removes keys via CASCADE — use only for explicit hard-delete flows.

## Ops: orphan overlay rows

If `crm.contact_profiles.account_contact_id` points at a missing `customer_profile` (legacy IDs), after the write path is live:

```bash
cd backend && npx tsx --env-file=../.env scripts/backfill-orphan-customer-profiles.ts
# then with --apply to insert stub profiles
```
