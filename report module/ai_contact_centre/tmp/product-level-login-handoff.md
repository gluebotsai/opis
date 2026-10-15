# One login per product

## Why

`accounts.auth_sessions` is shared. The old rule treated any active row for an email as “already signed in,” and a forced sign-out deleted every row for that email. A Contact Center login blocked CRM and Ticketing, and signing out of Contact Center signed the other products out.

The rule is now one active login per product. The same email can be signed into Contact Center, CRM, and Ticketing at the same time. A second browser in the same product is still blocked.

## What changed

Contact Center added an optional column. It has no default. Existing rows are left NULL. Contact Center does not update or delete a row whose `product_id` is NULL or another product.

```sql
ALTER TABLE accounts.auth_sessions
  ADD COLUMN IF NOT EXISTS product_id VARCHAR(128);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_email_product
  ON accounts.auth_sessions (email, product_id);
```

Contact Center writes `product_id = 'contact-center'` on its new sessions. Its “already signed in” check and its forced sign-out use only that value.

Do not add a default on this column. A default of `contact-center` would label CRM and Ticketing rows as Contact Center.

## What to change

Use the same `product_id` string already stored on `accounts.setup_user_product_access` (`crm`, `ticketing`, and the other product ids). Set it on every insert into `accounts.auth_sessions`.

Already signed in — look only at your product:

```sql
SELECT 1
FROM accounts.auth_sessions
WHERE lower(email) = lower($1)
  AND expires_at > now()
  AND product_id = 'crm';
```

Forced sign-out or logout — delete only your product:

```sql
DELETE FROM accounts.auth_sessions
WHERE lower(email) = lower($1)
  AND product_id = 'crm';
```

Replace `'crm'` with `'ticketing'` in the Ticketing app. Do not delete rows where `product_id` is NULL or `contact-center`.

Until that filter is in place, a Contact Center row for the same email still looks like an active session to the old email-only check, and the second product login stays blocked.

## Result

| Action | Contact Center | CRM | Ticketing |
| --- | --- | --- | --- |
| Sign in while another product is open | Allowed | Allowed | Allowed |
| Sign in again in the same product | Blocked | Blocked after your filter | Blocked after your filter |
| Sign out of one product | Ends only `contact-center` | Ends only `crm` | Ends only `ticketing` |
