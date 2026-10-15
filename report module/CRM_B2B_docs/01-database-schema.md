# B2B CRM database reference for the reports spoke

This file is the table and column contract for the reports domain agent. The SQL executor uses it to know which table answers a metric and which columns exist. The knowledge-graph executor uses the column meanings and the live example to explain a number.

Column lists for `accounts`, `cdp`, and `inventory` come from the live Worktual database (`information_schema`), not from a guessed subset. CRM must not `CREATE` / `ALTER` / `DROP` those schemas. If a column is listed, it exists. If the “CRM reads this” note is absent, the column is still real — do not invent a sales KPI from it.

CRM tables are listed with every live column on that table. Example JSON is a real row from organization `1003` (Worktual, `business_type` B2B) when the table is tenant-scoped. Secret columns are redacted. Allowed categorical values are at the end under **Enumerations**, each as `schema.table.column` — (values).

## Why CRM reads accounts, cdp, and inventory

### accounts

CRM does not store the login user or the tenant. `accounts.organizations.id` is `organization_id` on every CRM row. `business_type` decides B2B / B2C / B2B2C module gating. `industry_type` selects the CRM field pack. `accounts.setup_users.id` is stored on owners and assignees. Role comes from `setup_user_product_access` where `product_id = 'crm'` joined to `setup_roles.name`. `auth_sessions` is the live login. Mailbox OAuth and A2A spoke clients are shared connection rows. Reports join owners to `setup_users` for names and always filter `organization_id`.

### cdp

Person name, employer text, and most profile fields live on `cdp.customer_profile`. Email and phone live on `cdp.identity_keys`. `crm.contact_profiles.account_contact_id` equals `cdp_id`. Lead status, owner, BANT, and marketing opt-out stay on the CRM overlay. Soft-delete is `crm.contact_profiles.crm_status`, not a CDP delete. `cdp.products` is not the sellable catalog.

### inventory

The only product catalog is `inventory.products`. Commercial lines store `product_id` and join here. CRM may update existing catalog columns. It must not add columns.

## Shared tables (live columns)

### accounts.organizations

Tenant root. One row is one Worktual customer organization.

CRM filters every query by organization id taken from the signed-in user. business_type gates modules. industry_type selects which extra fields a contact or company form shows.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `tenant_id` | varchar | yes | Accounts platform tenant code (string). CRM tenancy uses id, not this field. Do not join CRM tables on tenant_id. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `company_name` | varchar | no | Display name of the Worktual customer (the seller org). Shown on quotes and invoices as the seller. Not the name of a crm.companies account. CRM reads this. |
| `industry_type` | varchar | no | Industry string collected at signup. CRM maps it to a field pack (OrganizationVertical). It does not change lead scores or create industry-specific tables. CRM reads this. |
| `contact_name` | varchar | no | Signup contact person at the tenant. Not a CRM contact and not used as deal owner. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `designation` | varchar | no | Job title of the signup contact. Accounts-owned; CRM does not report on it. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `work_email` | varchar | no | Signup work email for the tenant. Not the same as a rep's setup_users.work_email. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `admin_email` | varchar | no | Admin mailbox recorded at signup. Reports must not treat this as a sales-rep owner. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `tax_number` | varchar | no | Tax / GST identifier for the tenant. Accounts billing, not deal tax. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `billing_address` | text | no | Tenant billing address from signup. Not a crm.company_locations row. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `website_url` | varchar | no | Tenant website from signup. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `country` | varchar | no | Tenant country from signup. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `company_size` | varchar | no | Headcount band from signup. Not crm.companies.employee_count. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `mobile_country_code` | varchar | no | Dialing code of the signup mobile. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `mobile_number` | varchar | no | Signup mobile for the tenant admin. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `lifecycle_status` | varchar | yes | Accounts lifecycle of the tenant (active, prospect, …). Not CRM lead_status. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `converted_at` | timestamptz | yes | When Accounts marked the tenant converted. Not deal closed_at. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `created_at` | timestamptz | yes | When the tenant row was created in Accounts. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `updated_at` | timestamptz | yes | When any Accounts org field last changed. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `business_type` | varchar | no | Motion for the tenant: b2b, b2c, or b2b2c (case may vary in the row). B2C must not receive finance metrics. Empty string means unset. CRM reads this. |
| `support_portal_slug` | varchar | no | Service portal URL slug. Service tickets are not in CRM tables. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `support_portal_enabled` | boolean | yes | Whether the Service portal is on for this tenant. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `support_portal_welcome` | text | no | Welcome copy for the Service portal. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `id` | bigint | yes | Primary key of the tenant. Every CRM row's organization_id stores this bigint. Filter reports to the signed-in org's id. CRM reads this. |
| `reseller_id` | bigint | no | Parent reseller org if this tenant was created through a reseller. Not crm.companies.parent_company_id. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `source_lead_id` | bigint | no | Accounts lead that became this tenant. Not a CRM contact id. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `sip_domain_name` | varchar | yes | CCaaS SIP domain for the tenant. Not used in sales KPIs. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `admin_email_enc` | bytea | no | Encrypted admin email. Never select in a report. Present on the shared table. CRM does not select it today; do not invent a KPI from it. Never project this column into a report result. |
| `work_email_enc` | bytea | no | Encrypted work email. Never select in a report. Present on the shared table. CRM does not select it today; do not invent a KPI from it. Never project this column into a report result. |
| `mobile_country_code_enc` | bytea | no | Encrypted mobile country code. Never select in a report. Present on the shared table. CRM does not select it today; do not invent a KPI from it. Never project this column into a report result. |
| `mobile_number_enc` | bytea | no | Encrypted mobile. Never select in a report. Present on the shared table. CRM does not select it today; do not invent a KPI from it. Never project this column into a report result. |
| `tax_number_enc` | bytea | no | Encrypted tax number. Never select in a report. Present on the shared table. CRM does not select it today; do not invent a KPI from it. Never project this column into a report result. |
| `billing_address_enc` | bytea | no | Encrypted billing address. Never select in a report. Present on the shared table. CRM does not select it today; do not invent a KPI from it. Never project this column into a report result. |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "tenant_id": "9009",
  "company_name": "Worktual",
  "industry_type": "Technology & Software",
  "contact_name": "Rajasekaran",
  "designation": "NLP",
  "work_email": "r.ravi@worktual.com",
  "admin_email": "r.ravi@worktual.com",
  "tax_number": "",
  "billing_address": "Second Floor, SAI SADHAN, TS No 125, North Phase, Thiru Vi Ka Industrial Estate, Ekkatuthangal, Chennai, Tamil Nadu 600032",
  "website_url": "https://beta.worktual.co.uk/",
  "country": "India",
  "company_size": "51-200 employees",
  "mobile_country_code": "+91",
  "mobile_number": "9876543210",
  "lifecycle_status": "active",
  "converted_at": "2026-08-25T15:17:26.443Z",
  "created_at": "2026-08-25T15:17:26.443Z",
  "updated_at": "2026-09-18T04:46:00.765Z",
  "business_type": "B2B",
  "support_portal_slug": null,
  "support_portal_enabled": false,
  "support_portal_welcome": null,
  "id": "1003",
  "reseller_id": null,
  "source_lead_id": "1003",
  "sip_domain_name": "1003.call.worktual.com",
  "admin_email_enc": "[redacted]",
  "work_email_enc": "[redacted]",
  "mobile_country_code_enc": "[redacted]",
  "mobile_number_enc": "[redacted]",
  "tax_number_enc": "[redacted]",
  "billing_address_enc": "[redacted]"
}
```

### accounts.setup_users

Login user directory shared across Worktual products.

Deal owner, contact owner, and activity assignee store this id. A report joins it to print the rep name. Password columns are out of scope for both executors.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `employee_id` | varchar | no | HR / CCaaS employee code. CRM does not use this as owner id. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `first_name` | varchar | yes | Given name of the signed-in person. Concatenate with last_name for owner labels. CRM reads this. |
| `last_name` | varchar | yes | Family name of the signed-in person. CRM reads this. |
| `work_email` | varchar | yes | Login mailbox. Also used for meeting invites when no Google mailbox is connected. Compare case-insensitively. CRM reads this. |
| `mobile_number` | varchar | no | User mobile from Accounts. Not a CRM contact phone. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `primary_language` | varchar | no | Preferred language for CCaaS / Accounts. Not a CRM locale setting. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `secondary_language` | varchar | no | Secondary language on the user directory row. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `location_id` | varchar | no | Accounts office location id. Not crm.company_locations.id. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `status` | varchar | yes | Directory status (active, …). Only active users should be assigned as owners. CRM reads this. |
| `created_at` | timestamptz | yes | When the user was created in Accounts. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `updated_at` | timestamptz | yes | When the directory row last changed. CRM reads this. |
| `shift_types` | jsonb | no | CCaaS shift labels (json). Not sales working hours in CRM. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `password_hash` | text | no | Password verifier. Never select in a report. CRM reads this. Never project this column into a report result. |
| `invite_status` | varchar | no | Invite / activation state from Accounts (for example active). Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `password_set_at` | timestamptz | no | When the user last set a password. Null if never set. CRM reads this. Never project this column into a report result. |
| `invited_at` | timestamptz | no | When the Accounts invite was sent. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `skills` | jsonb | yes | CCaaS skill tags. Not CRM product skills. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `city` | varchar | no | User city on the directory row. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `state` | varchar | no | User state / region on the directory row. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `country` | varchar | no | User country on the directory row. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `business_hours_id` | bigint | no | Accounts business-hours profile. CRM owner hours may also live in CRM helpers; do not invent a quota from this. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `id` | bigint | yes | Primary key of the login user. CRM stores this on owner_user_id, created_by_user_id, and activity assignees. Join here to print the rep name. CRM reads this. |
| `organization_id` | bigint | yes | Tenant this user belongs to. Must match the CRM organization_id filter. CRM reads this. |
| `team_id` | bigint | no | CCaaS team. Not a CRM territory. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `whatsapp_number` | varchar | no | WhatsApp number on the directory row. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `handling_regions` | jsonb | yes | CCaaS routing regions (json array). Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `ext` | integer | yes | PBX extension. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `sip_login_id` | varchar | yes | SIP login for CCaaS. Not a report metric. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `sip_password` | varchar | yes | SIP password. Never select in a report. Present on the shared table. CRM does not select it today; do not invent a KPI from it. Never project this column into a report result. |
| `sip_domain_name` | varchar | yes | SIP domain for this user. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "employee_id": "EMP-002",
  "first_name": "Raghuram",
  "last_name": "M",
  "work_email": "r.meenakshisundaram@worktual.com",
  "mobile_number": "+918778828184",
  "primary_language": "Tamil",
  "secondary_language": "English",
  "location_id": null,
  "status": "active",
  "created_at": "2026-08-25T15:54:48.060Z",
  "updated_at": "2026-09-29T13:19:17.023Z",
  "shift_types": [
    "Night"
  ],
  "password_hash": null,
  "invite_status": "active",
  "password_set_at": null,
  "invited_at": "2026-08-28T17:57:24.750Z",
  "skills": [
    "Administration",
    "Troubleshooting",
    "Operational Skills",
    "Excellent Communication",
    "general",
    "support",
    "soft skills",
    "general support"
  ],
  "city": "Chennai",
  "state": "Tamil Nadu",
  "country": "India",
  "business_hours_id": "1002",
  "id": "1015",
  "organization_id": "1003",
  "team_id": "1002",
  "whatsapp_number": null,
  "handling_regions": [],
  "ext": 101,
  "sip_login_id": "10015",
  "sip_password": null,
  "sip_domain_name": "1003.call.worktual.com"
}
```

### accounts.setup_roles

Role name catalog. CRM maps the name into admin, sales_manager, sales_rep, presales, marketing, finance, or viewer.

The SQL executor uses the resolved CRM role to decide owner scope. It does not invent new role names.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `name` | varchar | yes | Role label CRM maps to admin, sales_manager, sales_rep, presales, marketing, finance, or viewer. Unknown names fall back to sales_rep. CRM reads this. |
| `description` | text | no | Human description of the role in Accounts. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `accessible_products` | jsonb | yes | JSON list of Worktual products this role can open. CRM access still requires a product_id = crm grant. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `module_permission` | varchar | no | Legacy permission blob. CRM module gating uses backend modules.ts, not this column. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `can_view` | boolean | yes | Accounts can-view flag. CRM record visibility uses canViewAllRecords / owner_user_id, not this bit. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `can_create` | boolean | yes | Accounts can-create flag. Not a CRM KPI. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `can_edit` | boolean | yes | Accounts can-edit flag. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `can_delete` | boolean | yes | Accounts can-delete flag. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `can_export` | boolean | yes | Accounts can-export flag. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `can_approve` | boolean | yes | Accounts can-approve flag. Invoice approval in CRM uses invoice columns, not this bit. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `created_at` | timestamptz | yes | When the role was created. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `updated_at` | timestamptz | yes | When the role was last edited. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `product_id` | varchar | no | Product this role catalog row is for. CRM grants still go through setup_user_product_access.product_id = crm. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `module_permissions` | jsonb | no | Newer permission JSON. CRM still resolves the spoke role from name, not from this JSON. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `id` | bigint | yes | Primary key of the role. setup_user_product_access.role_id points here. CRM reads this. |
| `organization_id` | bigint | yes | Tenant that owns this role row when roles are per-org. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "name": "Admin",
  "description": "Full CRM module access for this organization's business type.",
  "accessible_products": [
    "crm"
  ],
  "module_permission": null,
  "can_view": true,
  "can_create": false,
  "can_edit": false,
  "can_delete": false,
  "can_export": false,
  "can_approve": false,
  "created_at": "2026-08-25T15:43:13.472Z",
  "updated_at": "2026-08-25T15:43:13.472Z",
  "product_id": "crm",
  "module_permissions": [
    "dashboard",
    "inbox",
    "contact",
    "company",
    "marketing",
    "sales",
    "activities",
    "product",
    "finance",
    "service",
    "reports_analytics",
    "configuration"
  ],
  "id": "1031",
  "organization_id": "1003"
}
```

### accounts.setup_user_product_access

Grants one user one role on one product. CRM reads rows where product_id is crm.

This is how a user becomes a sales rep or a finance user inside CRM. Reports do not change this table.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `product_id` | varchar | yes | Worktual product. CRM reads only rows where this is crm. CRM reads this. |
| `created_at` | timestamptz | yes | When the user was granted that product role. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `id` | bigint | yes | Primary key of the grant row. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `organization_id` | bigint | yes | Tenant of the grant. CRM reads this. |
| `role_id` | bigint | yes | setup_roles.id. Join to get the role name. CRM reads this. |
| `user_id` | bigint | yes | setup_users.id receiving the grant. CRM reads this. |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "product_id": "crm",
  "created_at": "2026-09-24T12:58:34.103Z",
  "id": "1154",
  "organization_id": "1003",
  "role_id": "1033",
  "user_id": "1066"
}
```

### accounts.auth_sessions

Live login session for a user. CRM uses it to know who is signed in and to revoke a session.

Session health is an operations question, not a sales KPI. The SQL executor may count active sessions only for an admin operations report and must not return token material.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `token` | varchar | yes | Session secret. Never return it from a report. CRM reads this. Never project this column into a report result. |
| `email` | varchar | yes | Email the session was issued for. CRM reads this. |
| `role` | varchar | yes | Role string stamped on the session at login. CRM reads this. |
| `display_name` | varchar | no | Display name cached on the session. CRM reads this. |
| `expires_at` | timestamptz | yes | When the session dies. CRM treats expires_at > now() as live. CRM reads this. |
| `user_id` | bigint | no | setup_users.id of the signed-in person. CRM reads this. |
| `presence_initialized_at` | timestamptz | no | When presence was first marked for this session. Null until initialized. CRM reads this. |
| `product_id` | varchar | no | Product the session belongs to. CRM sessions use crm. CRM reads this. |
| `email_enc` | bytea | no | Encrypted email. Never select in a report. Present on the shared table. CRM does not select it today; do not invent a KPI from it. Never project this column into a report result. |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "token": null,
  "email": "l.balamurugan@worktual.com",
  "role": "agent",
  "display_name": "Lokesh B",
  "expires_at": "2026-09-29T18:04:55.020Z",
  "user_id": null,
  "presence_initialized_at": "2026-09-29T06:04:56.181Z",
  "product_id": "contact-center",
  "email_enc": null
}
```

### accounts.mail_oauth_connections

Shared OAuth connection for a mailbox. CRM also keeps product-specific connection state in crm.user_integration_connections.

A coverage report can say whether a rep has connected mail. The token itself is never a report column.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `account_type` | varchar | yes | Provider kind (google, microsoft, …). CRM reads this. |
| `mailbox_profile` | varchar | yes | Which mailbox profile this connection is (user vs bot). Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `account_email` | varchar | yes | Connected mailbox address. A coverage report may count whether a rep has a row; do not dump tokens. CRM reads this. |
| `account_name` | varchar | no | Display name of the connected mailbox. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `ms_tenant_id` | varchar | no | Microsoft tenant id when the provider is Microsoft. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `access_token_encrypted` | text | yes | Encrypted access token. Never select in a report. CRM reads this. Never project this column into a report result. |
| `refresh_token_encrypted` | text | yes | Encrypted refresh token. Never select in a report. CRM reads this. Never project this column into a report result. |
| `expires_at` | timestamptz | yes | When the access token expires. CRM reads this. |
| `scope` | text | no | OAuth scopes granted. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `needs_reauth` | boolean | yes | True when the user must reconnect the mailbox. CRM reads this. |
| `created_at` | timestamptz | yes | When the connection was created. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `updated_at` | timestamptz | yes | When tokens or metadata last changed. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `account_id` | bigint | yes | Accounts account id for the mailbox owner. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `id` | bigint | yes | Primary key of the shared mailbox OAuth row. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "account_type": "internal",
  "mailbox_profile": "sales",
  "account_email": "d.senthuran@worktual.com",
  "account_name": "Divyaprasath Senthuran",
  "ms_tenant_id": "46a59890-9398-43cf-b1c3-cc09d9365f36",
  "access_token_encrypted": null,
  "refresh_token_encrypted": null,
  "expires_at": "2026-09-18T07:39:19.954Z",
  "scope": "Mail.Read Mail.ReadWrite Mail.Send User.Read profile openid email",
  "needs_reauth": false,
  "created_at": "2026-09-14T11:35:02.319Z",
  "updated_at": "2026-09-18T06:31:01.956Z",
  "account_id": "1114",
  "id": "1150"
}
```

### accounts.a2a_spoke_clients

One Hub client id for this CRM spoke, plus the tokens Hub uses. Approved CRM-owned exception table inside accounts.

The reports agent does not need this table for KPIs. If an admin asks whether the spoke is registered, answer yes or no without secrets.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | bigint | yes | Primary key of the Hub spoke client row. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `a2a_server_name` | varchar | yes | Spoke name (worktual-crm, worktual-hub, …). CRM reads this. |
| `client_id` | varchar | yes | OAuth client id the Hub uses. Do not print in a sales report. CRM reads this. |
| `client_secret` | text | no | Client secret. Never select in a report. CRM reads this. Never project this column into a report result. |
| `access_token` | text | no | Live Hub access token. Never select in a report. Present on the shared table. CRM does not select it today; do not invent a KPI from it. Never project this column into a report result. |
| `access_expires_at` | timestamptz | no | When the Hub access token expires. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `refresh_token` | text | no | Hub refresh token. Never select in a report. Present on the shared table. CRM does not select it today; do not invent a KPI from it. Never project this column into a report result. |
| `refresh_expires_at` | timestamptz | no | When the refresh token expires. Present on the shared table. CRM does not select it today; do not invent a KPI from it. Never project this column into a report result. |
| `skill_version` | varchar | no | Skill catalog version last registered with the Hub. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `created_at` | timestamptz | yes | When the spoke client was created. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `updated_at` | timestamptz | yes | When tokens or skill version last changed. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `organization_id` | bigint | no | Tenant that owns this spoke client. CRM reads this. |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "11",
  "a2a_server_name": "worktual-contact-centre",
  "client_id": "worktual-hub-ccaas",
  "client_secret": null,
  "access_token": null,
  "access_expires_at": "2026-08-28T21:57:47.989Z",
  "refresh_token": null,
  "refresh_expires_at": null,
  "skill_version": "1.0.0",
  "created_at": "2026-08-27T17:15:39.549Z",
  "updated_at": "2026-08-28T20:57:49.192Z",
  "organization_id": null
}
```

### cdp.customer_profile

Shared person profile. One row is one human the tenant knows.

Contact name and employer on a report come from here. CRM sales status does not. Join to crm.contact_profiles on cdp_id = account_contact_id and to crm.companies when the overlay has a company_id.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `cdp_id` | text | yes | Primary key of the person. crm.contact_profiles.account_contact_id stores this text. Cast as text in joins. CRM reads this. |
| `first_name` | varchar | no | Given name of the person. Contact list name comes from here, not from contact_profiles. CRM reads this. |
| `last_name` | varchar | no | Family name of the person. CRM reads this. |
| `gender` | varchar | no | Gender on the shared profile when CDP has it. CRM does not require it. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `date_of_birth` | date | no | Date of birth on the shared profile. Not a sales KPI. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `company` | varchar | no | Employer name denormalized on the CDP person. The CRM account link is contact_profiles.company_id → crm.companies. CRM reads this. |
| `city` | varchar | no | City on the person profile. CRM reads this. |
| `region` | varchar | no | Region / state on the person profile. CRM reads this. |
| `country` | varchar | no | Country on the person profile. CRM reads this. |
| `language` | varchar | no | Preferred language on the person. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `timezone` | varchar | no | Timezone on the person. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `acquisition_channel` | varchar | no | How CDP first acquired the person (for example web). Not crm lead source. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `acquisition_date` | date | no | CDP acquisition date. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `first_referrer` | text | no | First HTTP referrer CDP stored. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `first_seen_at` | timestamptz | no | First time CDP saw this person. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `last_seen_at` | timestamptz | no | Last time CDP saw this person. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `created_at` | timestamptz | yes | When the CDP profile was inserted. CRM reads this. |
| `updated_at` | timestamptz | yes | When the CDP profile last changed. CRM reads this. |
| `organization_id` | bigint | yes | Tenant of the person. Must match CRM organization_id. CRM reads this. |
| `custom_fields` | jsonb | yes | JSON bag. CRM reads title, industry, company_domain, and address_line. Do not invent other keys in SQL. CRM reads this. |
| `tenant_id` | text | yes | CDP tenant string (often default). CRM tenancy uses organization_id. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `preferences_json` | jsonb | yes | CDP preference document. Not CRM marketing opt-out (that is contact_profiles). Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `consent_json` | jsonb | yes | CDP consent document. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `traits_json` | jsonb | yes | CDP traits document. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `contact_type` | varchar | no | CDP person class (contact, customer, churned, lead, …). CRM lead_status converted is aligned to customer/churned. Do not use this as the sales pipeline stage. CRM reads this. |
| `primary_product` | text | no | Which Worktual product last wrote the profile (crm, webtracking, …). Filter CRM people via contact_profiles, not this alone. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `industry` | text | no | Industry on the person when CDP has a dedicated column. CRM also reads custom_fields.industry. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `blocked` | boolean | yes | CDP block flag. Not CRM disqualified. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "cdp_id": "CDP-crm-org1003-bcf4ee030ab0495fb78ef757a6808521",
  "first_name": "MED",
  "last_name": "Bite",
  "gender": null,
  "date_of_birth": null,
  "company": "MED Bites",
  "city": null,
  "region": null,
  "country": null,
  "language": null,
  "timezone": null,
  "acquisition_channel": null,
  "acquisition_date": null,
  "first_referrer": null,
  "first_seen_at": "2026-09-15T09:40:00.061Z",
  "last_seen_at": "2026-09-15T12:56:31.002Z",
  "created_at": "2026-09-15T09:40:00.061Z",
  "updated_at": "2026-09-15T12:57:04.752Z",
  "organization_id": "1003",
  "custom_fields": {
    "company_domain": "medbites.org"
  },
  "tenant_id": "default",
  "preferences_json": {},
  "consent_json": {},
  "traits_json": {
    "full_name": "MED Bite",
    "email_domain": "gmail.com",
    "calculated_traits": {}
  },
  "contact_type": "lead",
  "primary_product": null,
  "industry": null,
  "blocked": false
}
```

### cdp.identity_keys

Email and phone keys for a CDP person. Unique on organization_id, key_type, key_value.

Looking up a person by email or phone starts here, then joins customer_profile, then contact_profiles. A duplicate email in the same org is rejected by the unique key. Reports must not dump every email in the tenant unless the question asks for a contact list the role is allowed to see.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `identity_id` | text | yes | Primary key of this email/phone key. CRM reads this. |
| `cdp_id` | text | yes | Person this key belongs to. ON DELETE CASCADE from customer_profile. CRM reads this. |
| `key_type` | varchar | yes | Kind of key. CRM writes email, phone, email_secondary, phone_secondary. Other systems may write cdp_id or others — do not invent types. CRM reads this. |
| `key_value` | varchar | yes | The email or phone (or other key). Emails are stored lowercased. Unique with (organization_id, key_type, key_value). CRM reads this. |
| `source_system` | varchar | no | Who wrote the key (crm, cdp_core, …). CRM reads this. |
| `confidence_score` | numeric | no | CDP confidence. CRM does not score leads from this. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |
| `verified` | boolean | yes | Whether CDP marked the key verified. CRM usually writes false on create. CRM reads this. |
| `created_at` | timestamptz | yes | When this key was inserted. CRM picks the oldest email key as primary. CRM reads this. |
| `organization_id` | bigint | yes | Tenant of the key. CRM reads this. |
| `custom_fields` | jsonb | yes | JSON on the key. CRM does not depend on keys here. Present on the shared table. CRM does not select it today; do not invent a KPI from it. |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "identity_id": "cb13775b-0f34-4063-9466-88f37b4ef4a2",
  "cdp_id": "aa7dd5a2-3762-480d-bab5-45017d8486d7",
  "key_type": "email",
  "key_value": "a.antonydavidselvam@worktual.com",
  "source_system": "crm",
  "confidence_score": "1.0000",
  "verified": false,
  "created_at": "2026-09-29T13:06:15.489Z",
  "organization_id": "1003",
  "custom_fields": {}
}
```

### inventory.products

This is the shared product catalog in inventory.products. CRM does not own the table. A row is one sellable product with a name, price, status, and billing type. Quotes, orders, invoices, and offers point at product id so revenue can be split by what was sold.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Catalog product id. Quote, order, and invoice lines store this as product_id. |
| `name` | text | yes | Sellable product name shown on quotes and reports. |
| `tagline` | text | no | Short card line under the name. |
| `description` | text | no | Marketing / sales description. |
| `specifications` | text | no | Long specification text. |
| `image_url` | text | no | Primary image URL. |
| `gallery_urls` | jsonb | no | Extra image URLs (json). |
| `sku` | text | no | Stock keeping unit. Unique per org when set. |
| `price` | numeric | no | List price on the catalog row. Commercial documents may override via price books and lines. |
| `currency` | text | yes | ISO currency of catalog price. Do not mix currencies in a sum. |
| `status` | ProductStatus | yes | draft, active, or archived. Revenue reports usually keep active plus historically sold ids. |
| `category` | text | no | Product category for grouping. |
| `tags` | text | no | Freeform / comma-separated tags. |
| `created_at` | timestamp without time zone | yes | When the catalog row was created. |
| `updated_at` | timestamp without time zone | yes | When the catalog row last changed. |
| `organization_id` | bigint | yes | Tenant that owns the catalog row. |
| `billing_type` | ProductBillingType | yes | one_time or recurring. Recurring feeds ARR-style metrics only when contracts/invoices say so. |
| `billing_frequency` | ProductBillingFrequency | no | monthly, quarterly, or annual when recurring. |
| `unit_of_measure` | ProductUnitOfMeasure | yes | How the product is sold: per_seat, per_agent, per_ticket, or flat. |
| `pricing_tiers` | jsonb | no | Legacy volume tiers on the product. Prefer add-on tiers for customizable products. |
| `product_type` | ProductType | yes | fixed or customizable. Customizable products use add-ons. |
| `custom_attributes` | jsonb | no | Non-price industry labels. Not used in quote math. |
| `max_discount_percent` | numeric | no | Discount above this percent on a quote line needs finance approval. Null means no cap. |
| `brand` | text | no | Brand label for merchandising. |
| `subcategory` | text | no | Finer category than category. |
| `stock_on_hand` | integer | no | Warehouse units. Null means not inventory-tracked (services, subscriptions). |
| `product_url` | text | no | PDP or datasheet URL. Not an image. |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "wt-product-ccaas",
  "name": "AI Native Contact Centre (CCaaS)",
  "tagline": "Lola chat + voice bots with live agents",
  "description": "AI Native Contact Centre Solution (Web, WhatsApp, Facebook, Instagram, Email, SMS chatbots + Voicebot) with live agents. GST excluded from list prices.",
  "specifications": null,
  "image_url": null,
  "gallery_urls": null,
  "sku": "WT-CCAAS",
  "price": "3000.00",
  "currency": "INR",
  "status": "active",
  "category": "CCaaS",
  "tags": null,
  "created_at": "2026-09-03T03:26:36.778Z",
  "updated_at": "2026-09-03T03:26:36.778Z",
  "organization_id": "1003",
  "billing_type": "recurring",
  "billing_frequency": "monthly",
  "unit_of_measure": "flat",
  "pricing_tiers": null,
  "product_type": "customizable",
  "custom_attributes": {
    "source": "Standard Price.xlsx",
    "taxNote": "GST excluded",
    "implementationInr": 90000
  },
  "max_discount_percent": null,
  "brand": null,
  "subcategory": null,
  "stock_on_hand": null,
  "product_url": null
}
```


## CRM tables (live columns)

### crm.a2a_spoke_tasks

This stores a task exchanged with another Worktual spoke through the A2A hub. Cross-product operations reports count these tasks by status. CRM business pipeline is still the deals table.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.a2a_spoke_tasks. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `task_id` | text | yes | Identifier stored on crm.a2a_spoke_tasks. Join the table that owns this id. Do not treat it as a display label. |
| `context_id` | text | yes | Identifier stored on crm.a2a_spoke_tasks. Join the table that owns this id. Do not treat it as a display label. |
| `skill_id` | text | yes | Identifier stored on crm.a2a_spoke_tasks. Join the table that owns this id. Do not treat it as a display label. |
| `state` | varchar | yes | Value of state on crm.a2a_spoke_tasks (varchar). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `actor_id` | varchar | yes | Identifier stored on crm.a2a_spoke_tasks. Join the table that owns this id. Do not treat it as a display label. |
| `run_id` | varchar | yes | Identifier stored on crm.a2a_spoke_tasks. Join the table that owns this id. Do not treat it as a display label. |
| `idempotency_key` | varchar | yes | Value of idempotency_key on crm.a2a_spoke_tasks (varchar). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `receipt` | jsonb | no | Value of receipt on crm.a2a_spoke_tasks (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `created_at` | timestamptz | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamptz | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |

No row was available to show a live example.

### crm.agent_input_fingerprints

This stores a fingerprint of an agent input so the same work is not run twice. It is an idempotency record. Reports use it only to explain duplicate suppression, not as a business fact about a deal.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.agent_input_fingerprints. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `agent` | text | yes | Value of agent on crm.agent_input_fingerprints (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `entity_type` | text | yes | Value of entity_type on crm.agent_input_fingerprints (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `entity_id` | text | yes | Identifier stored on crm.agent_input_fingerprints. Join the table that owns this id. Do not treat it as a display label. |
| `input_hash` | text | yes | Sensitive field on crm.agent_input_fingerprints. Never select it in a report. Never project this column into a report result. |
| `last_checked_at` | timestamptz | yes | Timestamp on crm.agent_input_fingerprints for the “last checked” event. Null means that event has not happened. |
| `last_llm_at` | timestamptz | no | Timestamp on crm.agent_input_fingerprints for the “last llm” event. Null means that event has not happened. |
| `created_at` | timestamptz | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamptz | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "aif_cab0e2277c265b165dd45d6d",
  "organization_id": "1003",
  "agent": "audit-forecast",
  "entity_type": "deal",
  "entity_id": "cmul9ofkg01vvqm0u2khw3xn6",
  "input_hash": null,
  "last_checked_at": "2026-09-29T14:46:04.774Z",
  "last_llm_at": "2026-09-29T11:16:05.734Z",
  "created_at": "2026-09-29T11:16:05.735Z",
  "updated_at": "2026-09-29T14:46:04.775Z"
}
```

### crm.agent_memories

This stores durable memory notes an agent saved for a tenant or record. It can explain what the agent remembered. KPI numbers must be calculated from deals, invoices, and contacts, not from memory text.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.agent_memories. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `scope_type` | varchar | yes | Value of scope_type on crm.agent_memories (varchar). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `scope_id` | varchar | yes | Identifier stored on crm.agent_memories. Join the table that owns this id. Do not treat it as a display label. |
| `slot_key` | varchar | yes | Value of slot_key on crm.agent_memories (varchar). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `slot_value` | jsonb | yes | Value of slot_value on crm.agent_memories (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `source` | varchar | no | Value of source on crm.agent_memories (varchar). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `expires_at` | timestamptz | no | Timestamp on crm.agent_memories for the “expires” event. Null means that event has not happened. |
| `created_at` | timestamptz | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamptz | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |

No row was available to show a live example.

### crm.agent_step_events

This is one step an AI agent took, such as a tool call or a decision, stored for audit. Agent-operations reports count steps and failures. Customer pipeline numbers must not be calculated from this log.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.agent_step_events. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `agent` | text | yes | Value of agent on crm.agent_step_events (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `job_id` | text | yes | Identifier stored on crm.agent_step_events. Join the table that owns this id. Do not treat it as a display label. |
| `contact_id` | text | no | CRM contact overlay id (crm.contact_profiles.id) when this row is tied to a person. |
| `step` | text | yes | Value of step on crm.agent_step_events (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `label` | text | yes | Value of label on crm.agent_step_events (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `status` | AgentStepStatus | yes | Lifecycle status of this crm.agent_step_events row. Filter only with documented enum or varchar codes. |
| `detail` | jsonb | no | Value of detail on crm.agent_step_events (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `error_reason` | text | no | Value of error_reason on crm.agent_step_events (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `started_at` | timestamp without time zone | yes | Timestamp on crm.agent_step_events for the “started” event. Null means that event has not happened. |
| `ended_at` | timestamp without time zone | no | Timestamp on crm.agent_step_events for the “ended” event. Null means that event has not happened. |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "ase5c68bc56f9f2f991b58b612b",
  "organization_id": "1003",
  "agent": "company_collection_risk",
  "job_id": "c69a4a3a-8147-4cc5-8215-fa18e31ca9df",
  "contact_id": null,
  "step": "load_context",
  "label": "Loading company invoice history",
  "status": "ok",
  "detail": {
    "companyId": "cmtbnigr10002oe0ujoajpi5z",
    "openInvoiceCount": 0,
    "totalInvoiceCount": 1
  },
  "error_reason": null,
  "started_at": "2026-09-23T05:58:20.960Z",
  "ended_at": "2026-09-23T05:58:22.176Z"
}
```

### crm.api_keys

This stores a hashed API key issued for the tenant. Security reports may count active keys and last use. The raw secret is not stored, and the reports agent must never return the hash.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.api_keys. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `name` | varchar | yes | Display name stored on crm.api_keys. |
| `key_prefix` | varchar | yes | Value of key_prefix on crm.api_keys (varchar). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `key_hash` | varchar | yes | Sensitive field on crm.api_keys. Never select it in a report. Never project this column into a report result. |
| `scopes` | ARRAY | yes | Value of scopes on crm.api_keys (ARRAY). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `created_by_user_id` | bigint | yes | accounts.setup_users.id of the creator. Can differ from the current owner. |
| `created_at` | timestamptz | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `revoked_at` | timestamptz | no | Timestamp on crm.api_keys for the “revoked” event. Null means that event has not happened. |
| `last_used_at` | timestamptz | no | Timestamp on crm.api_keys for the “last used” event. Null means that event has not happened. |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "cmsq28ljp001w1a5ys8ot2h0g",
  "organization_id": "1000",
  "name": "CRUD key 20260812122104",
  "key_prefix": "crm_live_45a17f5f23d7",
  "key_hash": null,
  "scopes": [
    "contacts"
  ],
  "created_by_user_id": "1000",
  "created_at": "2026-08-12T12:23:16.502Z",
  "revoked_at": "2026-08-12T12:23:21.324Z",
  "last_used_at": null
}
```

### crm.appointments

This is a scheduled meeting or call on the CRM calendar, including start, end, guests, and links to a contact, company, or deal. Meeting-volume and upcoming-activity reports use this table. A completed meeting may also have an activity row.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.appointments. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `contact_id` | text | yes | CRM contact overlay id (crm.contact_profiles.id) when this row is tied to a person. |
| `host_user_id` | bigint | yes | Identifier stored on crm.appointments. Join the table that owns this id. Do not treat it as a display label. |
| `activity_id` | text | no | Identifier stored on crm.appointments. Join the table that owns this id. Do not treat it as a display label. |
| `source` | appointment_source | yes | Value of source on crm.appointments (appointment_source). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `status` | appointment_status | yes | Lifecycle status of this crm.appointments row. Filter only with documented enum or varchar codes. |
| `title` | text | yes | Value of title on crm.appointments (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `starts_at` | timestamptz | yes | Timestamp on crm.appointments for the “starts” event. Null means that event has not happened. |
| `ends_at` | timestamptz | yes | Timestamp on crm.appointments for the “ends” event. Null means that event has not happened. |
| `timezone` | varchar | yes | Value of timezone on crm.appointments (varchar). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `provider` | meeting_assist_provider | yes | Value of provider on crm.appointments (meeting_assist_provider). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `join_url` | text | no | Value of join_url on crm.appointments (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `calendar_event_id` | text | no | Identifier stored on crm.appointments. Join the table that owns this id. Do not treat it as a display label. |
| `guest_emails` | jsonb | yes | Value of guest_emails on crm.appointments (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `assignment_reason` | text | no | Value of assignment_reason on crm.appointments (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `canceled_at` | timestamptz | no | Timestamp on crm.appointments for the “canceled” event. Null means that event has not happened. |
| `completed_at` | timestamptz | no | Timestamp on crm.appointments for the “completed” event. Null means that event has not happened. |
| `created_at` | timestamptz | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamptz | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "cmucs0qg900331a7cxz95fovi",
  "organization_id": "1003",
  "contact_id": "CDP-crm-org1003-43ea6662a9a5449e85a7faa7041d7ce4",
  "host_user_id": "1015",
  "activity_id": "cmucs0otv00321a7cx8hw6d8c",
  "source": "crm_ui",
  "status": "scheduled",
  "title": "Meeting with Lucifer S",
  "starts_at": "2026-09-22T14:38:00.000Z",
  "ends_at": "2026-09-22T15:08:00.000Z",
  "timezone": "Asia/Calcutta",
  "provider": "google_meet",
  "join_url": "https://meet.google.com/frz-nbma-tdt",
  "calendar_event_id": "56s5jo4fupjqmvcvv1thk7ar7c",
  "guest_emails": [
    "lucifer543666@gmail.com"
  ],
  "assignment_reason": null,
  "canceled_at": null,
  "completed_at": null,
  "created_at": "2026-09-22T14:35:37.492Z",
  "updated_at": "2026-09-22T14:35:37.492Z"
}
```

### crm.audit_logs

This is an append-only record of who changed a CRM record and which action they took. Compliance and change-history questions read it. It is not a substitute for stage history on deals, because deal stage changes are not modelled as their own table.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.audit_logs. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `actor_user_id` | bigint | no | Identifier stored on crm.audit_logs. Join the table that owns this id. Do not treat it as a display label. |
| `action` | AuditAction | yes | Value of action on crm.audit_logs (AuditAction). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `entity_type` | text | yes | Value of entity_type on crm.audit_logs (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `entity_id` | text | yes | Identifier stored on crm.audit_logs. Join the table that owns this id. Do not treat it as a display label. |
| `meta` | jsonb | no | Value of meta on crm.audit_logs (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `created_at` | timestamp without time zone | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "cmtuae68k001g1age1qum1bs5",
  "organization_id": "1003",
  "actor_user_id": null,
  "action": "delete",
  "entity_type": "proposal",
  "entity_id": "cmtlncwzs00011a16z1ao7cat",
  "meta": {
    "dealId": "cmtlcopyi001p1a9vpooi9rs3"
  },
  "created_at": "2026-09-09T10:32:20.433Z"
}
```

### crm.calendar_meet_captures

This links a calendar event to a captured Meet session so the transcript and analysis can be tied back to the scheduled meeting. Meeting reports join it to appointments and meeting_assist_sessions.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.calendar_meet_captures. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `user_id` | bigint | yes | Identifier stored on crm.calendar_meet_captures. Join the table that owns this id. Do not treat it as a display label. |
| `google_event_id` | text | yes | Identifier stored on crm.calendar_meet_captures. Join the table that owns this id. Do not treat it as a display label. |
| `meet_url` | text | no | Value of meet_url on crm.calendar_meet_captures (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `meet_code` | text | no | Value of meet_code on crm.calendar_meet_captures (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `summary` | text | no | Value of summary on crm.calendar_meet_captures (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `start_at` | timestamptz | no | Timestamp on crm.calendar_meet_captures for the “start” event. Null means that event has not happened. |
| `end_at` | timestamptz | no | Timestamp on crm.calendar_meet_captures for the “end” event. Null means that event has not happened. |
| `status` | CalendarMeetCaptureStatus | yes | Lifecycle status of this crm.calendar_meet_captures row. Filter only with documented enum or varchar codes. |
| `contact_id` | text | no | CRM contact overlay id (crm.contact_profiles.id) when this row is tied to a person. |
| `activity_id` | text | no | Identifier stored on crm.calendar_meet_captures. Join the table that owns this id. Do not treat it as a display label. |
| `meeting_service_id` | text | no | Identifier stored on crm.calendar_meet_captures. Join the table that owns this id. Do not treat it as a display label. |
| `last_error` | text | no | Value of last_error on crm.calendar_meet_captures (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `created_at` | timestamptz | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamptz | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "cmu5k974s00021abr87uxa8wv",
  "organization_id": "1003",
  "user_id": "1017",
  "google_event_id": "23bs65lpg9d2pia08g3jivgnab",
  "meet_url": "https://meet.google.com/kzc-vbsb-udk",
  "meet_code": "kzc-vbsb-udk",
  "summary": "test",
  "start_at": "2026-09-17T13:15:00.000Z",
  "end_at": "2026-09-17T14:15:00.000Z",
  "status": "dispatched",
  "contact_id": null,
  "activity_id": null,
  "meeting_service_id": "1c284be3-4571-4938-981d-2ddd02509316",
  "last_error": null,
  "created_at": "2026-09-17T13:23:52.540Z",
  "updated_at": "2026-09-17T13:23:56.889Z"
}
```

### crm.coaching_insights

This stores a coaching note produced for a sales user from meetings or activity. Manager coaching reports group these by user. They are observations, not changes to deal amount or stage.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.coaching_insights. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `activity_id` | text | yes | Identifier stored on crm.coaching_insights. Join the table that owns this id. Do not treat it as a display label. |
| `contact_id` | text | no | CRM contact overlay id (crm.contact_profiles.id) when this row is tied to a person. |
| `deal_id` | text | no | crm.deals.id this commercial or activity row belongs to. |
| `rep_user_id` | bigint | yes | Identifier stored on crm.coaching_insights. Join the table that owns this id. Do not treat it as a display label. |
| `interaction_type` | varchar | yes | Value of interaction_type on crm.coaching_insights (varchar). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `overall_impression` | varchar | yes | Value of overall_impression on crm.coaching_insights (varchar). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `discovery_quality` | text | no | Value of discovery_quality on crm.coaching_insights (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `objection_handling` | text | no | Value of objection_handling on crm.coaching_insights (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `methodology_note` | text | no | Value of methodology_note on crm.coaching_insights (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `talk_balance_note` | text | no | Value of talk_balance_note on crm.coaching_insights (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `strengths` | jsonb | yes | Value of strengths on crm.coaching_insights (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `growth_areas` | jsonb | yes | Value of growth_areas on crm.coaching_insights (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `highlighted_moment` | text | no | Value of highlighted_moment on crm.coaching_insights (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `coaching_note` | text | no | Value of coaching_note on crm.coaching_insights (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `analyzed_at` | timestamptz | yes | Timestamp on crm.coaching_insights for the “analyzed” event. Null means that event has not happened. |
| `created_at` | timestamptz | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "cmtsolp410001pg0uwebw0hbl",
  "organization_id": "1003",
  "activity_id": "cmtso8uiz001emw0unhgy4jmg",
  "contact_id": "CDP-crm-org1003-1d2ba334939e45d3a2922f88b0944ca1",
  "deal_id": null,
  "rep_user_id": "1018",
  "interaction_type": "meeting",
  "overall_impression": "needs_work",
  "discovery_quality": "The rep failed to ask any discovery questions regarding budget, timeline, team size, or specific pain points with their current traditional CRM.",
  "objection_handling": "No objections were raised by the prospect, but the rep did not proactively address the prospect's request for advantages.",
  "methodology_note": "The call lacked a coherent structure, moving immediately from a purpose inquiry to a request for product advantages without a discovery phase.",
  "talk_balance_note": "The prospect dominates the dialogue by initiating the request for information.",
  "strengths": [
    "The prospect clearly stated an intent to purchase and a dissatisfaction with their current traditional CRM."
  ],
  "growth_areas": [
    "Establishing a discovery phase to understand the prospect's specific requirements before presenting advantages.",
    "Defining clear next steps and a concrete follow-up plan."
  ],
  "highlighted_moment": "Nandha Kumar stating 'I need to buy' — this is a high-intent signal that should have been met with qualifying questions.",
  "coaching_note": "I see you're getting prospects to state their intent to buy early on, which is great! To build on your previous goal of improving discovery, try to pause after they mention their current CRM and ask, 'What specific limitations are you facing with your current setup?' This will he…",
  "analyzed_at": "2026-09-08T13:04:33.889Z",
  "created_at": "2026-09-08T13:04:33.889Z"
}
```

### crm.companies

This is the B2B account the sales team sells to. A row is one legal or operating company inside the tenant, with a name, optional parent for brand-to-store hierarchy, and a channel role that says whether it is a normal account, a franchise, an owned store, or a brand headquarters. CRM refers to this table whenever a deal, quote, order, invoice, contract, or contact must be tied to a company rather than only to a person.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.companies. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `name` | text | yes | Name of the B2B account the team sells to. Not the seller tenant name (that is accounts.organizations.company_name). |
| `industry` | text | no | Industry label on this account. Independent of accounts.organizations.industry_type. |
| `employee_count` | integer | no | Headcount stored on the account. Null if unknown. |
| `owner_user_id` | bigint | no | accounts.setup_users.id of the owner. Reps are scoped to this column. Join setup_users for the name. |
| `created_at` | timestamp without time zone | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamp without time zone | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `domain` | text | no | Company website host (example.com). Used for enrichment and matching, not as the primary key. |
| `linkedin_url` | text | no | LinkedIn URL for the company page. |
| `logo_url` | text | no | Logo image URL for UI. |
| `channel_role` | CompanyChannelRole | yes | standard, franchise, owned_store, or brand_hq. Owner-scoped reps also see children of franchise / owned_store / brand_hq companies they own. |
| `parent_company_id` | text | no | Parent crm.companies.id for brand → store hierarchy. Null on a standalone account. |
| `expansion_signal` | varchar | no | HITL expansion flag from the matcher agent. The agent does not create deals. |
| `expansion_reason` | text | no | Why the expansion signal was set. |
| `expansion_draft` | text | no | Draft talking points for a human to send. Not an outbound email log. |
| `expansion_last_run_at` | timestamptz | no | When the expansion matcher last ran on this company. |
| `collection_risk_level` | varchar | no | HITL collection-risk band from invoice history. The agent does not block the account. |
| `collection_risk_reason` | text | no | Why that risk band was set. |
| `collection_risk_last_run_at` | timestamptz | no | When collection-risk last ran. |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "cmugreb970027mo0uvgsoxmng",
  "name": "Netflix",
  "industry": null,
  "employee_count": null,
  "owner_user_id": null,
  "created_at": "2026-09-25T03:59:16.411Z",
  "updated_at": "2026-09-25T03:59:19.673Z",
  "organization_id": "1003",
  "domain": "netflix.com",
  "linkedin_url": null,
  "logo_url": null,
  "channel_role": "standard",
  "parent_company_id": null,
  "expansion_signal": null,
  "expansion_reason": null,
  "expansion_draft": null,
  "expansion_last_run_at": null,
  "collection_risk_level": null,
  "collection_risk_reason": null,
  "collection_risk_last_run_at": null
}
```

### crm.company_locations

This stores an office or site that belongs to one company, such as headquarters or a branch, including address lines and an optional region code. Contacts and commercial documents can point at a location so a report can split pipeline and revenue by site instead of only by the parent company name.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.company_locations. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `company_id` | text | yes | crm.companies.id for the B2B account on this row. Join companies for the account name. |
| `name` | text | yes | Site name (HQ, city office, plant). |
| `type` | LocationType | yes | hq or branch. |
| `address` | text | no | Street address of the site. |
| `city` | text | no | City of the site. |
| `industry` | text | no | Industry override for this site when it differs from the company. |
| `employee_count` | integer | no | Headcount at this site. |
| `created_at` | timestamp without time zone | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamp without time zone | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |
| `owner_user_id` | bigint | no | accounts.setup_users.id of the owner. Reps are scoped to this column. Join setup_users for the name. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "cmtsms381000z1aimwsee5d0o",
  "company_id": "cmtsms380000y1aim6b2jfeq9",
  "name": "Headquarters",
  "type": "hq",
  "address": null,
  "city": null,
  "industry": null,
  "employee_count": null,
  "created_at": "2026-09-08T06:43:32.724Z",
  "updated_at": "2026-09-08T06:43:32.724Z",
  "owner_user_id": null,
  "organization_id": "1003"
}
```

### crm.contact_activities

This is the same kind of timeline stored against a person rather than a deal. A call or meeting booked from the contact page lands here. Contact activity reports and last-touch metrics join this table to contact_profiles on account_contact_id.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.contact_activities. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `contact_id` | text | yes | CRM contact overlay id (crm.contact_profiles.id) when this row is tied to a person. |
| `type` | ActivityType | yes | Value of type on crm.contact_activities (ActivityType). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `subject` | text | yes | Value of subject on crm.contact_activities (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `body` | text | no | Value of body on crm.contact_activities (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `due_at` | timestamp without time zone | no | Timestamp on crm.contact_activities for the “due” event. Null means that event has not happened. |
| `completed_at` | timestamp without time zone | no | Timestamp on crm.contact_activities for the “completed” event. Null means that event has not happened. |
| `created_by_user_id` | bigint | no | accounts.setup_users.id of the creator. Can differ from the current owner. |
| `created_at` | timestamp without time zone | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamp without time zone | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |
| `folder` | InboxFolder | yes | Value of folder on crm.contact_activities (InboxFolder). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `thread_id` | text | no | Identifier stored on crm.contact_activities. Join the table that owns this id. Do not treat it as a display label. |
| `gmail_message_id` | text | no | Identifier stored on crm.contact_activities. Join the table that owns this id. Do not treat it as a display label. |
| `gmail_thread_id` | text | no | Identifier stored on crm.contact_activities. Join the table that owns this id. Do not treat it as a display label. |
| `email_direction` | EmailDirection | no | Value of email_direction on crm.contact_activities (EmailDirection). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `rfc_message_id` | text | no | Identifier stored on crm.contact_activities. Join the table that owns this id. Do not treat it as a display label. |
| `reminder_sent_at` | timestamp without time zone | no | Timestamp on crm.contact_activities for the “reminder sent” event. Null means that event has not happened. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `task_status` | TaskStatus | no | Value of task_status on crm.contact_activities (TaskStatus). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `assignee_user_id` | bigint | no | Identifier stored on crm.contact_activities. Join the table that owns this id. Do not treat it as a display label. |
| `transcript_text` | text | no | Value of transcript_text on crm.contact_activities (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `transcript_source` | text | no | Value of transcript_source on crm.contact_activities (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `transcript_analyzed_at` | timestamp without time zone | no | Timestamp on crm.contact_activities for the “transcript analyzed” event. Null means that event has not happened. |
| `transcript_insights` | jsonb | no | Value of transcript_insights on crm.contact_activities (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `provider_message_id` | text | no | Identifier stored on crm.contact_activities. Join the table that owns this id. Do not treat it as a display label. |
| `provider_thread_id` | text | no | Identifier stored on crm.contact_activities. Join the table that owns this id. Do not treat it as a display label. |
| `mail_provider` | MailProvider | no | Value of mail_provider on crm.contact_activities (MailProvider). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `needs_manual_response` | boolean | yes | Value of needs_manual_response on crm.contact_activities (boolean). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `reminder_24h_sent_at` | timestamp without time zone | no | Timestamp on crm.contact_activities for the “reminder 24h sent” event. Null means that event has not happened. |
| `reminder_1h_sent_at` | timestamp without time zone | no | Timestamp on crm.contact_activities for the “reminder 1h sent” event. Null means that event has not happened. |
| `miss_escalated_at` | timestamp without time zone | no | Timestamp on crm.contact_activities for the “miss escalated” event. Null means that event has not happened. |
| `mom_sent_at` | timestamp without time zone | no | Timestamp on crm.contact_activities for the “mom sent” event. Null means that event has not happened. |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "cmtsh3r6g0000qr0u8nz24nde",
  "contact_id": "150b0063-aa36-4f60-940c-2e4c7f569964",
  "type": "email",
  "subject": "welcome",
  "body": "hi welcome!<div><br></div>\n\nSent via Gmail (yaswanthmg1@gmail.com)",
  "due_at": null,
  "completed_at": null,
  "created_by_user_id": "1015",
  "created_at": "2026-09-08T04:04:39.448Z",
  "updated_at": "2026-09-08T04:04:39.451Z",
  "folder": "sent",
  "thread_id": "cmtsh3r6g0000qr0u8nz24nde",
  "gmail_message_id": "1a0805e9d6bc3f2b",
  "gmail_thread_id": "1a0805e9d6bc3f2b",
  "email_direction": "outbound",
  "rfc_message_id": "<CA+3WGXhg18M47pDhuHg1di6WrU=vHY4e+9zt=635xkmai+rh6g@mail.gmail.com>",
  "reminder_sent_at": null,
  "organization_id": "1003",
  "task_status": null,
  "assignee_user_id": null,
  "transcript_text": null,
  "transcript_source": null,
  "transcript_analyzed_at": null,
  "transcript_insights": null,
  "provider_message_id": "1a0805e9d6bc3f2b",
  "provider_thread_id": "1a0805e9d6bc3f2b",
  "mail_provider": "google",
  "needs_manual_response": false,
  "reminder_24h_sent_at": null,
  "reminder_1h_sent_at": null,
  "miss_escalated_at": null,
  "mom_sent_at": null
}
```

### crm.contact_profiles

This is the CRM overlay on a CDP person. The person name, email, and phone live in cdp.customer_profile and cdp.identity_keys; this row stores the sales fields those shared tables must not hold, including owner, lead status, company link, BANT, nurture state, and marketing opt-out. Every contact report joins this table to CDP on account_contact_id = cdp_id and filters by organization_id.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.contact_profiles. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `account_contact_id` | text | yes | cdp.customer_profile.cdp_id. Always join CDP for name and email. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `company_id` | text | no | crm.companies.id for the B2B account on this row. Join companies for the account name. |
| `location_id` | text | no | crm.company_locations.id when this row is tied to a site. |
| `owner_user_id` | bigint | no | accounts.setup_users.id of the owner. Reps are scoped to this column. Join setup_users for the name. |
| `lead_source` | varchar | no | How this lead entered CRM (import, inbound, prospect pull, …). |
| `lead_status` | varchar | yes | Sales lifecycle: new, contacted, qualified, disqualified, converted. |
| `disqualify_reason` | varchar | no | Why the lead was disqualified. Group by the stored code. |
| `bant_budget` | boolean | no | BANT: budget confirmed. |
| `bant_authority` | boolean | no | BANT: authority confirmed. |
| `bant_need` | boolean | no | BANT: need confirmed. |
| `bant_timeline` | boolean | no | BANT: timeline confirmed. |
| `converted_deal_id` | text | no | Deal created when this lead converted. Null if not converted. |
| `tags` | ARRAY | yes | CRM tags on the contact. |
| `crm_status` | varchar | yes | Soft-delete of the overlay. Current contacts are crm_status = active. This is not CDP is_active (CDP has none). |
| `notes` | text | no | Free text on the overlay. Do not parse into a KPI. |
| `is_pinned` | boolean | yes | UI pin on the contact list. |
| `created_at` | timestamp without time zone | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamp without time zone | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |
| `assignment_reason` | text | no | Why the assignment agent picked this owner. |
| `sla_deadline` | timestamp without time zone | no | When the assigned owner should first act. |
| `assigned_at` | timestamp without time zone | no | When the current owner was assigned. |
| `assignment_escalated` | boolean | yes | True after assignment SLA escalation. |
| `nurture_status` | varchar | no | Nurture overlay state written by the nurture agent. |
| `nurture_sequence_step` | integer | no | Step index in the nurture sequence. |
| `nurture_started_at` | timestamp without time zone | no | Timestamp on crm.contact_profiles for the “nurture started” event. Null means that event has not happened. |
| `nurture_last_touch_at` | timestamp without time zone | no | Timestamp on crm.contact_profiles for the “nurture last touch” event. Null means that event has not happened. |
| `flagged_for_review` | boolean | yes | Lifecycle agent needs a human because evidence is ambiguous or stalled. |
| `flag_reason` | varchar | no | Why the contact was flagged. |
| `lifecycle_last_action` | varchar | no | Value of lifecycle_last_action on crm.contact_profiles (varchar). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `lifecycle_last_reason` | text | no | Value of lifecycle_last_reason on crm.contact_profiles (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `lifecycle_last_run_at` | timestamptz | no | Timestamp on crm.contact_profiles for the “lifecycle last run” event. Null means that event has not happened. |
| `custom_attributes` | jsonb | no | Vertical pack field values. Never stored as new CDP columns. |
| `marketing_opt_out` | boolean | yes | Durable marketing suppression. Nurture must not send when true. |
| `marketing_opt_out_at` | timestamptz | no | When marketing opt-out was set. |
| `created_by_user_id` | bigint | no | accounts.setup_users.id of the creator. Can differ from the current owner. |
| `assignment_followup_stage` | varchar | no | Value of assignment_followup_stage on crm.contact_profiles (varchar). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `assignment_baseline_status` | varchar | no | Value of assignment_baseline_status on crm.contact_profiles (varchar). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "cp1d5882f0ed304915bc878b3525e62f57",
  "account_contact_id": "CDP-webtracking-org1003-visitor_5f2e1bd6-a001-4c99-b77f-846240127c48",
  "organization_id": "1003",
  "company_id": null,
  "location_id": null,
  "owner_user_id": null,
  "lead_source": "cdp_ingest",
  "lead_status": "new",
  "disqualify_reason": null,
  "bant_budget": null,
  "bant_authority": null,
  "bant_need": null,
  "bant_timeline": null,
  "converted_deal_id": null,
  "tags": [],
  "crm_status": "active",
  "notes": null,
  "is_pinned": false,
  "created_at": "2026-08-29T05:08:53.074Z",
  "updated_at": "2026-08-29T05:16:18.672Z",
  "assignment_reason": null,
  "sla_deadline": null,
  "assigned_at": null,
  "assignment_escalated": false,
  "nurture_status": "deep_cold",
  "nurture_sequence_step": 0,
  "nurture_started_at": "2026-08-29T05:09:07.411Z",
  "nurture_last_touch_at": null,
  "flagged_for_review": true,
  "flag_reason": "No activity for 14+ days — lead gone quiet",
  "lifecycle_last_action": "flag_for_review",
  "lifecycle_last_reason": "No activity for 14+ days — lead gone quiet",
  "lifecycle_last_run_at": "2026-08-29T10:46:18.672Z",
  "custom_attributes": null,
  "marketing_opt_out": false,
  "marketing_opt_out_at": null,
  "created_by_user_id": null,
  "assignment_followup_stage": null,
  "assignment_baseline_status": null
}
```

### crm.contract_billing_schedules

This is one dated billing event under a contract, such as a monthly charge. Recurring-revenue reports that need the next invoice date join this table to contracts. The contract header alone does not list each bill.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.contract_billing_schedules. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `contract_id` | text | yes | Identifier stored on crm.contract_billing_schedules. Join the table that owns this id. Do not treat it as a display label. |
| `billing_kind` | InvoiceBillingKind | yes | Value of billing_kind on crm.contract_billing_schedules (InvoiceBillingKind). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `scheduled_for` | date | yes | Value of scheduled_for on crm.contract_billing_schedules (date). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `status` | ContractBillingScheduleStatus | yes | Lifecycle status of this crm.contract_billing_schedules row. Filter only with documented enum or varchar codes. |
| `invoice_id` | text | no | Identifier stored on crm.contract_billing_schedules. Join the table that owns this id. Do not treat it as a display label. |
| `amount` | numeric | no | Money amount on this crm.contract_billing_schedules row. Keep sums inside one currency. Null is 0 only when the KPI catalog says so. |
| `currency` | text | yes | ISO currency code for money on this row. Never add two currencies together. |
| `idempotency_key` | text | yes | Value of idempotency_key on crm.contract_billing_schedules (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `created_at` | timestamp without time zone | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamp without time zone | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |

No row was available to show a live example.

### crm.contracts

This is a subscription or term agreement with a company, including status, start, and end. Renewal and annual-recurring-revenue reports read contracts and their billing schedule. A contract is not a one-off quote.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.contracts. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `company_id` | text | yes | crm.companies.id for the B2B account on this row. Join companies for the account name. |
| `deal_id` | text | no | crm.deals.id this commercial or activity row belongs to. |
| `title` | text | yes | Value of title on crm.contracts (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `starts_at` | timestamp without time zone | yes | Timestamp on crm.contracts for the “starts” event. Null means that event has not happened. |
| `ends_at` | timestamp without time zone | yes | Timestamp on crm.contracts for the “ends” event. Null means that event has not happened. |
| `arr` | numeric | no | Value of arr on crm.contracts (numeric). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `renew_deal_id` | text | no | Identifier stored on crm.contracts. Join the table that owns this id. Do not treat it as a display label. |
| `renewal_reminded_at` | timestamp without time zone | no | Timestamp on crm.contracts for the “renewal reminded” event. Null means that event has not happened. |
| `created_at` | timestamp without time zone | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamp without time zone | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |
| `auto_renew` | boolean | yes | Value of auto_renew on crm.contracts (boolean). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `status` | ContractStatus | yes | Lifecycle status of this crm.contracts row. Filter only with documented enum or varchar codes. |
| `source_order_id` | text | no | Identifier stored on crm.contracts. Join the table that owns this id. Do not treat it as a display label. |
| `billing_frequency` | ProductBillingFrequency | no | Value of billing_frequency on crm.contracts (ProductBillingFrequency). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `cancelled_at` | timestamp without time zone | no | Timestamp on crm.contracts for the “cancelled” event. Null means that event has not happened. |
| `cancel_reason` | text | no | Value of cancel_reason on crm.contracts (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "cmui5e9di000nmv0uj9fggz91",
  "organization_id": "1003",
  "company_id": "cmugreb970027mo0uvgsoxmng",
  "deal_id": "cmugumk9x004fmo0ubruzr8uq",
  "title": "Contract — Netflix — Kirti Patidar",
  "starts_at": "2026-09-26T03:18:54.773Z",
  "ends_at": "2027-09-26T03:18:54.773Z",
  "arr": null,
  "renew_deal_id": null,
  "renewal_reminded_at": null,
  "created_at": "2026-09-26T03:18:54.774Z",
  "updated_at": "2026-09-26T03:18:54.774Z",
  "auto_renew": false,
  "status": "active",
  "source_order_id": null,
  "billing_frequency": null,
  "cancelled_at": null,
  "cancel_reason": null
}
```

### crm.daily_briefings

This stores the daily briefing generated for one user. A report can show whether a briefing was produced. Pipeline totals inside the briefing text are not a second source of truth; recompute them from deals.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.daily_briefings. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `user_id` | bigint | yes | Identifier stored on crm.daily_briefings. Join the table that owns this id. Do not treat it as a display label. |
| `briefing_date` | date | yes | Value of briefing_date on crm.daily_briefings (date). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `script` | text | yes | Value of script on crm.daily_briefings (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `items` | jsonb | yes | Value of items on crm.daily_briefings (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `played_at` | timestamp without time zone | no | Timestamp on crm.daily_briefings for the “played” event. Null means that event has not happened. |
| `created_at` | timestamp without time zone | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamp without time zone | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "cmtbql6r300091ah6qz259xmx",
  "organization_id": "1003",
  "user_id": "1017",
  "briefing_date": "2026-08-26T18:30:00.000Z",
  "script": "Good evening, Yaswanth.\nLooks like you've got a clear night ahead.\nNothing pending on your plate right now.\nRest up for tomorrow.\nTake care today.",
  "items": {
    "refs": [],
    "pulse": {
      "openDeals": 0,
      "needsReview": 0,
      "overdueTasks": 0,
      "meetingsToday": 0,
      "untouchedLeads": 0,
      "overdueInvoices": 0
    },
    "version": 10
  },
  "played_at": "2026-08-27T10:58:37.283Z",
  "created_at": "2026-08-27T10:58:04.335Z",
  "updated_at": "2026-08-27T10:58:37.284Z"
}
```

### crm.deal_activities

This is the timeline of work logged against one deal: a call, meeting, email, SMS, note, or task. Reports that ask what happened on an opportunity, how many touches it had, or which tasks are still open read this table and join it to deals on deal_id.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.deal_activities. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `deal_id` | text | yes | crm.deals.id this commercial or activity row belongs to. |
| `type` | ActivityType | yes | Value of type on crm.deal_activities (ActivityType). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `subject` | text | yes | Value of subject on crm.deal_activities (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `body` | text | no | Value of body on crm.deal_activities (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `due_at` | timestamp without time zone | no | Timestamp on crm.deal_activities for the “due” event. Null means that event has not happened. |
| `completed_at` | timestamp without time zone | no | Timestamp on crm.deal_activities for the “completed” event. Null means that event has not happened. |
| `created_by_user_id` | bigint | no | accounts.setup_users.id of the creator. Can differ from the current owner. |
| `created_at` | timestamp without time zone | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamp without time zone | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |

No row was available to show a live example.

### crm.deals

This is a B2B opportunity. A row is one sales pursuit with an amount, currency, stage, company, primary contact, and owner. Pipeline, win rate, forecast, and won or lost revenue are calculated from this table. Stage history is not stored here; the current stage and updated_at are the live values.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.deals. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `title` | text | yes | Opportunity name shown on the pipeline. |
| `stage` | DealStage | yes | qualification, discover, propose, negotiate, closed_won, or closed_lost. There is no per-deal probability column; use stage weights from the KPI catalog. |
| `amount` | numeric | no | Deal value. Open-stage sum is pipeline. closed_won sum in period is won revenue. |
| `company_id` | text | yes | crm.companies.id for the B2B account on this row. Join companies for the account name. |
| `location_id` | text | yes | crm.company_locations.id when this row is tied to a site. |
| `contact_id` | text | no | Optional cdp.customer_profile.cdp_id of the person on the deal (not contact_profiles.id). |
| `contact_name` | text | no | Denormalized person name at last save. Prefer CDP for current name. |
| `contact_email` | text | no | Denormalized email at last save. Prefer identity_keys for current email. |
| `owner_user_id` | bigint | no | accounts.setup_users.id of the owner. Reps are scoped to this column. Join setup_users for the name. |
| `notes` | text | no | Free text. Do not parse into won reason or stage history. |
| `closed_at` | timestamp without time zone | no | When the deal was marked won or lost. Period metrics use coalesce(closed_at, created_at). |
| `created_at` | timestamp without time zone | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamp without time zone | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |
| `expected_close_date` | timestamp without time zone | no | Rep's expected close. Slippage compares this to today on open deals. |
| `lost_reason` | text | no | Why the deal was lost. Null on open and won deals. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `forecast_category` | varchar | no | Forecast auditor category overlay. Does not change stage. |
| `forecast_confidence_percent` | integer | no | Auditor confidence 0–100. Not the stage weight. |
| `forecast_flagged` | boolean | yes | True when the auditor flagged the deal. |
| `forecast_reason` | text | no | Why the auditor flagged it. |
| `forecast_last_run_at` | timestamptz | no | Timestamp on crm.deals for the “forecast last run” event. Null means that event has not happened. |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "cmtsms61u00111aimq9lsb7aw",
  "title": "crm",
  "stage": "closed_lost",
  "amount": "1255.00",
  "company_id": "cmtsms380000y1aim6b2jfeq9",
  "location_id": "cmtsms381000z1aimwsee5d0o",
  "contact_id": "150b0063-aa36-4f60-940c-2e4c7f569964",
  "contact_name": "Mohamed Fazil",
  "contact_email": "smohamedfazil16@gmail.com",
  "owner_user_id": "1015",
  "notes": "Based on the meeting transcript, Worktual can prepare a tailored proposal. Seller focus: Technology & Software. Seller business type: B2B. Product SKUs will be attached when the CDP catalog is available; this brief captures requirements only.\n\nMohamed Fazil: And the idea of? Make…",
  "closed_at": "2026-09-17T09:28:24.127Z",
  "created_at": "2026-09-08T06:43:36.399Z",
  "updated_at": "2026-09-17T09:28:42.249Z",
  "expected_close_date": null,
  "lost_reason": "Pricing",
  "organization_id": "1003",
  "forecast_category": null,
  "forecast_confidence_percent": null,
  "forecast_flagged": false,
  "forecast_reason": null,
  "forecast_last_run_at": null
}
```

### crm.domain_enrichment_cache

This caches enrichment data looked up for a company domain so the same domain is not fetched again. It is a cache, not the company master. Company reports should prefer crm.companies and use this only to explain enrichment freshness.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.domain_enrichment_cache. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `domain` | varchar | yes | Value of domain on crm.domain_enrichment_cache (varchar). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `payload` | jsonb | yes | Value of payload on crm.domain_enrichment_cache (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `source` | text | no | Value of source on crm.domain_enrichment_cache (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `expires_at` | timestamp without time zone | yes | Timestamp on crm.domain_enrichment_cache for the “expires” event. Null means that event has not happened. |
| `created_at` | timestamp without time zone | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamp without time zone | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "dec_7012600cb0e750467e0ea31b",
  "organization_id": "1003",
  "domain": "medbites.org",
  "payload": {
    "fields": {
      "domain": {
        "value": "medbites.org",
        "sourceUrl": "https://medbites.org/",
        "confidence": 85
      }
    }
  },
  "source": "enrichment",
  "expires_at": "2026-10-15T07:26:29.880Z",
  "created_at": "2026-09-11T00:38:31.162Z",
  "updated_at": "2026-09-15T07:26:29.883Z"
}
```

### crm.email_auto_reply_jobs

This is the queue row for an automatic email reply. Mail-automation reports count these jobs. The mailbox connection itself is user_integration_connections, and the person is still the CDP contact.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.email_auto_reply_jobs. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `contact_id` | text | yes | CRM contact overlay id (crm.contact_profiles.id) when this row is tied to a person. |
| `inbound_activity_id` | text | yes | Identifier stored on crm.email_auto_reply_jobs. Join the table that owns this id. Do not treat it as a display label. |
| `mailbox_user_id` | bigint | no | Identifier stored on crm.email_auto_reply_jobs. Join the table that owns this id. Do not treat it as a display label. |
| `status` | EmailAutoReplyStatus | yes | Lifecycle status of this crm.email_auto_reply_jobs row. Filter only with documented enum or varchar codes. |
| `decision` | text | no | Value of decision on crm.email_auto_reply_jobs (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `sensitivity` | text | no | Value of sensitivity on crm.email_auto_reply_jobs (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `category` | text | no | Value of category on crm.email_auto_reply_jobs (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `reason` | text | no | Value of reason on crm.email_auto_reply_jobs (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `reply_activity_id` | text | no | Identifier stored on crm.email_auto_reply_jobs. Join the table that owns this id. Do not treat it as a display label. |
| `escalated_to_user_id` | bigint | no | Identifier stored on crm.email_auto_reply_jobs. Join the table that owns this id. Do not treat it as a display label. |
| `attempts` | integer | yes | Value of attempts on crm.email_auto_reply_jobs (integer). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `max_attempts` | integer | yes | Value of max_attempts on crm.email_auto_reply_jobs (integer). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `next_retry_at` | timestamp without time zone | no | Timestamp on crm.email_auto_reply_jobs for the “next retry” event. Null means that event has not happened. |
| `last_error` | text | no | Value of last_error on crm.email_auto_reply_jobs (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `result_summary` | jsonb | no | Value of result_summary on crm.email_auto_reply_jobs (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `created_at` | timestamp without time zone | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamp without time zone | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |
| `completed_at` | timestamp without time zone | no | Timestamp on crm.email_auto_reply_jobs for the “completed” event. Null means that event has not happened. |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "earj_5d1e0ff35141837808646a88",
  "organization_id": "1003",
  "contact_id": "150b0063-aa36-4f60-940c-2e4c7f569964",
  "inbound_activity_id": "cmtsg5hr1000yr00u4bj66b01",
  "mailbox_user_id": null,
  "status": "replied",
  "decision": "safe_auto_reply",
  "sensitivity": "safe",
  "category": "product_inquiry",
  "reason": "The customer is asking about specific products and their capabilities regarding customer data management.",
  "reply_activity_id": "cmtsg5jzh000kor0us61skz73",
  "escalated_to_user_id": null,
  "attempts": 1,
  "max_attempts": 3,
  "next_retry_at": null,
  "last_error": null,
  "result_summary": {
    "reason": "The customer is asking about specific products and their capabilities regarding customer data management.",
    "category": "product_inquiry",
    "decision": "safe_auto_reply",
    "sensitivity": "safe"
  },
  "created_at": "2026-09-08T03:38:00.936Z",
  "updated_at": "2026-09-08T03:38:03.851Z",
  "completed_at": "2026-09-08T03:38:03.849Z"
}
```

### crm.gmail_push_watches

This stores the Gmail push-watch subscription for one mailbox so inbound mail can wake the CRM. It is integration state. A report may show whether the watch is active. It does not contain the email body.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.gmail_push_watches. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `organization_id` | bigint | no | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `user_id` | bigint | no | Identifier stored on crm.gmail_push_watches. Join the table that owns this id. Do not treat it as a display label. |
| `account_email` | text | yes | Value of account_email on crm.gmail_push_watches (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `watch_kind` | text | yes | Value of watch_kind on crm.gmail_push_watches (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `history_id` | text | no | Identifier stored on crm.gmail_push_watches. Join the table that owns this id. Do not treat it as a display label. |
| `expiration` | timestamptz | no | Value of expiration on crm.gmail_push_watches (timestamptz). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `created_at` | timestamptz | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamptz | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "cmucjhamz001j1a1ra2k2wgw1",
  "organization_id": "1003",
  "user_id": "1015",
  "account_email": "lucifer543666@gmail.com",
  "watch_kind": "user",
  "history_id": "35339",
  "expiration": "2026-09-29T10:36:32.805Z",
  "created_at": "2026-09-22T10:36:33.664Z",
  "updated_at": "2026-09-24T10:57:27.267Z"
}
```

### crm.google_calendar_watches

This stores the Google Calendar watch subscription for one user. Calendar-sync health reports read it. Meetings themselves are in appointments and activities.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.google_calendar_watches. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `user_id` | bigint | yes | Identifier stored on crm.google_calendar_watches. Join the table that owns this id. Do not treat it as a display label. |
| `channel_id` | text | yes | Identifier stored on crm.google_calendar_watches. Join the table that owns this id. Do not treat it as a display label. |
| `resource_id` | text | no | Identifier stored on crm.google_calendar_watches. Join the table that owns this id. Do not treat it as a display label. |
| `channel_token` | text | yes | Sensitive field on crm.google_calendar_watches. Never select it in a report. Never project this column into a report result. |
| `sync_token` | text | no | Sensitive field on crm.google_calendar_watches. Never select it in a report. Never project this column into a report result. |
| `expiration` | timestamptz | no | Value of expiration on crm.google_calendar_watches (timestamptz). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `created_at` | timestamptz | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamptz | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "cmu5k7a9e00001anw44hjap03",
  "organization_id": "1003",
  "user_id": "1015",
  "channel_id": "5de8e0c7-5a5e-4480-acc7-5a73ad58490d",
  "resource_id": "msiQGL2Asx3tjaXBccHW4Zr1lpU",
  "channel_token": null,
  "sync_token": null,
  "expiration": "2026-10-05T11:01:52.000Z",
  "created_at": "2026-09-17T13:22:23.283Z",
  "updated_at": "2026-09-29T11:01:55.134Z"
}
```

### crm.invoice_lines

This is one billed line on an invoice. Product revenue and tax reports sum these lines and join them to invoices and inventory.products. Do not sum invoice headers and lines together or revenue will be double-counted.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.invoice_lines. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `invoice_id` | text | yes | Identifier stored on crm.invoice_lines. Join the table that owns this id. Do not treat it as a display label. |
| `kind` | InvoiceLineKind | yes | Value of kind on crm.invoice_lines (InvoiceLineKind). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `product_id` | text | no | inventory.products.id. Join products for name, sku, and billing type. |
| `addon_id` | text | no | Identifier stored on crm.invoice_lines. Join the table that owns this id. Do not treat it as a display label. |
| `name` | text | yes | Display name stored on crm.invoice_lines. |
| `description` | text | no | Value of description on crm.invoice_lines (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `quantity` | numeric | yes | Value of quantity on crm.invoice_lines (numeric). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `unit_price` | numeric | yes | Value of unit_price on crm.invoice_lines (numeric). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `tax_percent` | numeric | yes | Value of tax_percent on crm.invoice_lines (numeric). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `amount` | numeric | yes | Money amount on this crm.invoice_lines row. Keep sums inside one currency. Null is 0 only when the KPI catalog says so. |
| `sort_order` | integer | yes | Value of sort_order on crm.invoice_lines (integer). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `created_at` | timestamp without time zone | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamp without time zone | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "cmu2lc61n00151atak6x7qpcr",
  "invoice_id": "cmu2lc61m00131atas2xbrfat",
  "kind": "product",
  "product_id": "wt-product-crm",
  "addon_id": null,
  "name": "AI Native CRM",
  "description": "SKU WT-CRM",
  "quantity": "1.00",
  "unit_price": "15000.0000",
  "tax_percent": "18.00",
  "amount": "15000.00",
  "sort_order": 0,
  "created_at": "2026-09-15T06:00:52.184Z",
  "updated_at": "2026-09-15T06:00:52.184Z",
  "organization_id": "1003"
}
```

### crm.invoice_templates

This is a reusable invoice layout. It does not hold money owed. Invoice presentation reports may count which template was used. Amounts live on invoices and invoice lines.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.invoice_templates. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `name` | text | yes | Display name stored on crm.invoice_templates. |
| `code` | text | no | Value of code on crm.invoice_templates (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `kind` | InvoiceTemplateKind | yes | Value of kind on crm.invoice_templates (InvoiceTemplateKind). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `sections` | jsonb | yes | Value of sections on crm.invoice_templates (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `blueprint` | jsonb | no | Value of blueprint on crm.invoice_templates (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `assets` | jsonb | no | Value of assets on crm.invoice_templates (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `is_default` | boolean | yes | Value of is_default on crm.invoice_templates (boolean). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `created_at` | timestamp without time zone | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamp without time zone | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "cmtemia5l001mnx0ucibplepn",
  "organization_id": "1003",
  "name": "Standard invoice",
  "code": "STANDARD",
  "kind": "standard",
  "sections": "[json 994 chars omitted]",
  "blueprint": "[json 1813 chars omitted]",
  "assets": [],
  "is_default": true,
  "created_at": "2026-08-29T11:27:08.841Z",
  "updated_at": "2026-08-29T11:27:08.841Z"
}
```

### crm.invoices

This is the finance document raised from an order. Status covers draft, pending approval, sent, and paid or void paths used by the finance flow. Revenue-collected and accounts-receivable reports use this table, joined to the company and the source order.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.invoices. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `order_id` | text | no | Identifier stored on crm.invoices. Join the table that owns this id. Do not treat it as a display label. |
| `company_id` | text | no | crm.companies.id for the B2B account on this row. Join companies for the account name. |
| `number` | text | yes | Value of number on crm.invoices (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `status` | InvoiceStatus | yes | draft, sent, paid, void, or overdue. |
| `currency` | text | yes | ISO currency code for money on this row. Never add two currencies together. |
| `total` | numeric | yes | Value of total on crm.invoices (numeric). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `due_at` | timestamp without time zone | no | When payment is due. Overdue invoices use this plus status. |
| `paid_at` | timestamp without time zone | no | When the invoice was marked paid. Null if unpaid. |
| `created_by_user_id` | bigint | no | accounts.setup_users.id of the creator. Can differ from the current owner. |
| `created_at` | timestamp without time zone | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamp without time zone | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |
| `deal_id` | text | no | crm.deals.id this commercial or activity row belongs to. |
| `discount_amount` | numeric | yes | Value of discount_amount on crm.invoices (numeric). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `tax_amount` | numeric | yes | Value of tax_amount on crm.invoices (numeric). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `issue_date` | timestamp without time zone | no | Value of issue_date on crm.invoices (timestamp without time zone). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `payment_terms` | text | no | Value of payment_terms on crm.invoices (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `notes` | text | no | Value of notes on crm.invoices (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `billing_address` | text | no | Value of billing_address on crm.invoices (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `lead_email` | text | no | Value of lead_email on crm.invoices (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `lead_phone` | text | no | Value of lead_phone on crm.invoices (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `tax_id` | text | no | Identifier stored on crm.invoices. Join the table that owns this id. Do not treat it as a display label. |
| `tax_details` | jsonb | no | Value of tax_details on crm.invoices (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `template_id` | text | no | Identifier stored on crm.invoices. Join the table that owns this id. Do not treat it as a display label. |
| `sections` | jsonb | no | Value of sections on crm.invoices (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `blueprint` | jsonb | no | Value of blueprint on crm.invoices (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `assets` | jsonb | no | Value of assets on crm.invoices (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `approved_by_user_id` | bigint | no | Identifier stored on crm.invoices. Join the table that owns this id. Do not treat it as a display label. |
| `approved_at` | timestamptz | no | Timestamp on crm.invoices for the “approved” event. Null means that event has not happened. |
| `approval_status` | varchar | yes | Value of approval_status on crm.invoices (varchar). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `escalation_severity` | varchar | no | Value of escalation_severity on crm.invoices (varchar). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `escalation_reason` | text | no | Value of escalation_reason on crm.invoices (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `escalation_draft` | text | no | Value of escalation_draft on crm.invoices (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `escalation_last_run_at` | timestamptz | no | Timestamp on crm.invoices for the “escalation last run” event. Null means that event has not happened. |
| `approval_note` | text | no | Value of approval_note on crm.invoices (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `billing_kind` | InvoiceBillingKind | yes | Value of billing_kind on crm.invoices (InvoiceBillingKind). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `submitted_for_approval_at` | timestamptz | no | Timestamp on crm.invoices for the “submitted for approval” event. Null means that event has not happened. |
| `resubmitted_at` | timestamptz | no | Timestamp on crm.invoices for the “resubmitted” event. Null means that event has not happened. |
| `payment_method` | InvoicePaymentMethod | no | Value of payment_method on crm.invoices (InvoicePaymentMethod). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `payment_reference` | text | no | Value of payment_reference on crm.invoices (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `payment_confirmed_by_user_id` | bigint | no | Identifier stored on crm.invoices. Join the table that owns this id. Do not treat it as a display label. |
| `payment_confirmed_at` | timestamptz | no | Timestamp on crm.invoices for the “payment confirmed” event. Null means that event has not happened. |
| `voided_at` | timestamptz | no | Timestamp on crm.invoices for the “voided” event. Null means that event has not happened. |
| `void_reason` | text | no | Value of void_reason on crm.invoices (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `voided_by_user_id` | bigint | no | Identifier stored on crm.invoices. Join the table that owns this id. Do not treat it as a display label. |
| `payment_provider` | InvoicePaymentProvider | no | Value of payment_provider on crm.invoices (InvoicePaymentProvider). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `payment_link_url` | text | no | Value of payment_link_url on crm.invoices (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `payment_session_id` | text | no | Identifier stored on crm.invoices. Join the table that owns this id. Do not treat it as a display label. |
| `payment_session_expires_at` | timestamp without time zone | no | Timestamp on crm.invoices for the “payment session expires” event. Null means that event has not happened. |
| `payment_session_status` | InvoicePaymentSessionStatus | no | Value of payment_session_status on crm.invoices (InvoicePaymentSessionStatus). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `sent_at` | timestamp without time zone | no | Timestamp on crm.invoices for the “sent” event. Null means that event has not happened. |
| `last_sent_at` | timestamp without time zone | no | Timestamp on crm.invoices for the “last sent” event. Null means that event has not happened. |
| `contract_id` | text | no | Identifier stored on crm.invoices. Join the table that owns this id. Do not treat it as a display label. |
| `billing_schedule_id` | text | no | Identifier stored on crm.invoices. Join the table that owns this id. Do not treat it as a display label. |
| `dunning_stage` | varchar | yes | Value of dunning_stage on crm.invoices (varchar). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `dunning_stage_sent_at` | timestamptz | no | Timestamp on crm.invoices for the “dunning stage sent” event. Null means that event has not happened. |
| `dunning_draft` | text | no | Value of dunning_draft on crm.invoices (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `lead_email_enc` | bytea | no | Sensitive field on crm.invoices. Never select it in a report. Never project this column into a report result. |
| `lead_phone_enc` | bytea | no | Sensitive field on crm.invoices. Never select it in a report. Never project this column into a report result. |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "cmuf1928e002rms0uyeqb9dev",
  "organization_id": "1003",
  "order_id": null,
  "company_id": null,
  "number": "INV-00003",
  "status": "draft",
  "currency": "INR",
  "total": "15000.00",
  "due_at": "2026-10-24T06:30:00.000Z",
  "paid_at": null,
  "created_by_user_id": "1015",
  "created_at": "2026-09-23T22:59:35.246Z",
  "updated_at": "2026-09-23T23:25:32.265Z",
  "deal_id": null,
  "discount_amount": "0.00",
  "tax_amount": "0.00",
  "issue_date": "2026-09-24T06:30:00.000Z",
  "payment_terms": "Net 30",
  "notes": null,
  "billing_address": "New York, USA, Dp World",
  "lead_email": "divyaprasathrs@gmail.com",
  "lead_phone": null,
  "tax_id": null,
  "tax_details": {
    "meta": {
      "cityPercent": 0,
      "statePercent": 0,
      "countyPercent": 0,
      "specialDistrictPercent": 0
    },
    "system": "Sales Tax",
    "country": "US",
    "taxAmount": 0,
    "components": [],
    "summaryLines": [
      "No sales tax applies (0%)"
    ],
    "taxableAmount": 15000,
    "effectivePercent": 0
  },
  "template_id": "cmtemia5l001mnx0ucibplepn",
  "sections": "[json 1008 chars omitted]",
  "blueprint": "[json 1813 chars omitted]",
  "assets": [],
  "approved_by_user_id": "1015",
  "approved_at": "2026-09-24T04:31:57.996Z",
  "approval_status": "approved",
  "escalation_severity": "watch",
  "escalation_reason": "The invoice is 31 days before its due date, has no prior payment history, and there is no previous escalation, so there are no current red flags.",
  "escalation_draft": "Hi,\n\nThis is a friendly pre-due reminder that invoice INV-00003 for INR 15,000 is due on 24 October 2026 under Net 30 terms.\n\nPlease let us know if you need a copy of the invoice or have any questions.\n\nBest regards",
  "escalation_last_run_at": "2026-09-24T04:55:32.261Z",
  "approval_note": null,
  "billing_kind": "standard",
  "submitted_for_approval_at": null,
  "resubmitted_at": null,
  "payment_method": null,
  "payment_reference": null,
  "payment_confirmed_by_user_id": null,
  "payment_confirmed_at": null,
  "voided_at": null,
  "void_reason": null,
  "voided_by_user_id": null,
  "payment_provider": null,
  "payment_link_url": null,
  "payment_session_id": null,
  "payment_session_expires_at": null,
  "payment_session_status": null,
  "sent_at": null,
  "last_sent_at": null,
  "contract_id": null,
  "billing_schedule_id": null,
  "dunning_stage": "none",
  "dunning_stage_sent_at": null,
  "dunning_draft": null,
  "lead_email_enc": "[redacted]",
  "lead_phone_enc": null
}
```

### crm.lead_enrichment_jobs

This is the queue row for an enrichment run on one lead, including status. Operations reports count failed or stuck enrichment jobs here. The business metric for the lead itself is not this job row.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.lead_enrichment_jobs. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `contact_id` | text | yes | CRM contact overlay id (crm.contact_profiles.id) when this row is tied to a person. |
| `company_id` | text | no | crm.companies.id for the B2B account on this row. Join companies for the account name. |
| `status` | LeadEnrichmentStatus | yes | Lifecycle status of this crm.lead_enrichment_jobs row. Filter only with documented enum or varchar codes. |
| `attempts` | integer | yes | Value of attempts on crm.lead_enrichment_jobs (integer). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `max_attempts` | integer | yes | Value of max_attempts on crm.lead_enrichment_jobs (integer). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `next_retry_at` | timestamp without time zone | no | Timestamp on crm.lead_enrichment_jobs for the “next retry” event. Null means that event has not happened. |
| `last_error` | text | no | Value of last_error on crm.lead_enrichment_jobs (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `result_summary` | jsonb | no | Value of result_summary on crm.lead_enrichment_jobs (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `created_at` | timestamp without time zone | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamp without time zone | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |
| `completed_at` | timestamp without time zone | no | Timestamp on crm.lead_enrichment_jobs for the “completed” event. Null means that event has not happened. |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "cej1281796f3479438197af7fd50fbc38a5",
  "organization_id": "1003",
  "contact_id": "CDP-webchat-org1003-visitor_d8d103f7-5292-4958-a063-c632aaf6b3a6",
  "company_id": "cmtbnigr10002oe0ujoajpi5z",
  "status": "enriched",
  "attempts": 14,
  "max_attempts": 5,
  "next_retry_at": null,
  "last_error": null,
  "result_summary": "[json 866 chars omitted]",
  "created_at": "2026-08-27T09:30:29.581Z",
  "updated_at": "2026-08-27T23:46:36.707Z",
  "completed_at": "2026-08-27T23:46:36.706Z"
}
```

### crm.lead_enrichment_snapshots

This stores the enrichment payload captured for one lead at a point in time. Lead-quality reports can show whether a contact was enriched. The live person record remains in CDP plus contact_profiles.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.lead_enrichment_snapshots. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `contact_id` | text | yes | CRM contact overlay id (crm.contact_profiles.id) when this row is tied to a person. |
| `company_name` | text | no | Value of company_name on crm.lead_enrichment_snapshots (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `company_size` | text | no | Value of company_size on crm.lead_enrichment_snapshots (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `industry` | text | no | Value of industry on crm.lead_enrichment_snapshots (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `revenue_band` | text | no | Value of revenue_band on crm.lead_enrichment_snapshots (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `seniority_tier` | varchar | no | Value of seniority_tier on crm.lead_enrichment_snapshots (varchar). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `geography` | text | no | Value of geography on crm.lead_enrichment_snapshots (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `email_domain_type` | varchar | no | Value of email_domain_type on crm.lead_enrichment_snapshots (varchar). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `enrichment_confidence` | double precision | no | Value of enrichment_confidence on crm.lead_enrichment_snapshots (double precision). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `enrichment_source` | text | no | Value of enrichment_source on crm.lead_enrichment_snapshots (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `conflict_flags` | jsonb | no | Value of conflict_flags on crm.lead_enrichment_snapshots (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `enrichment_timestamp` | timestamp without time zone | yes | Value of enrichment_timestamp on crm.lead_enrichment_snapshots (timestamp without time zone). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `created_at` | timestamp without time zone | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamp without time zone | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |
| `company_description` | text | no | Value of company_description on crm.lead_enrichment_snapshots (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `products` | text | no | Value of products on crm.lead_enrichment_snapshots (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "les_4709e3cc7604472656ffc85a",
  "organization_id": "1003",
  "contact_id": "CDP-crm-org1003-868d9de11f7e47f5ae16850ef6829410",
  "company_name": "HDFC",
  "company_size": null,
  "industry": null,
  "revenue_band": null,
  "seniority_tier": "manager",
  "geography": null,
  "email_domain_type": "personal",
  "enrichment_confidence": null,
  "enrichment_source": "scrape_wikidata",
  "conflict_flags": null,
  "enrichment_timestamp": "2026-09-04T04:18:30.196Z",
  "created_at": "2026-09-01T04:17:14.678Z",
  "updated_at": "2026-09-04T04:18:30.196Z",
  "company_description": null,
  "products": null
}
```

### crm.lead_lifecycle_jobs

This is the queue row for a lifecycle decision on a lead, such as qualify or disqualify. Lifecycle operations reports read job status here. The resulting lead_status is stored on contact_profiles.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.lead_lifecycle_jobs. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `contact_id` | text | yes | CRM contact overlay id (crm.contact_profiles.id) when this row is tied to a person. |
| `status` | LeadLifecycleStatus | yes | Lifecycle status of this crm.lead_lifecycle_jobs row. Filter only with documented enum or varchar codes. |
| `ladder` | text | no | Value of ladder on crm.lead_lifecycle_jobs (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `from_stage` | text | no | Value of from_stage on crm.lead_lifecycle_jobs (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `to_stage` | text | no | Value of to_stage on crm.lead_lifecycle_jobs (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `decision` | text | no | Value of decision on crm.lead_lifecycle_jobs (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `reason` | text | no | Value of reason on crm.lead_lifecycle_jobs (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `trigger_reason` | text | no | Value of trigger_reason on crm.lead_lifecycle_jobs (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `deal_id` | text | no | crm.deals.id this commercial or activity row belongs to. |
| `attempts` | integer | yes | Value of attempts on crm.lead_lifecycle_jobs (integer). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `max_attempts` | integer | yes | Value of max_attempts on crm.lead_lifecycle_jobs (integer). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `next_retry_at` | timestamp without time zone | no | Timestamp on crm.lead_lifecycle_jobs for the “next retry” event. Null means that event has not happened. |
| `last_error` | text | no | Value of last_error on crm.lead_lifecycle_jobs (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `result_summary` | jsonb | no | Value of result_summary on crm.lead_lifecycle_jobs (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `last_applied_at` | timestamp without time zone | no | Timestamp on crm.lead_lifecycle_jobs for the “last applied” event. Null means that event has not happened. |
| `created_at` | timestamp without time zone | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamp without time zone | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |
| `completed_at` | timestamp without time zone | no | Timestamp on crm.lead_lifecycle_jobs for the “completed” event. Null means that event has not happened. |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "llj_9a0d8153958af138240a582c",
  "organization_id": "1003",
  "contact_id": "06200a60-07fe-4d1a-8cc4-b531bec9b20f",
  "status": "waited",
  "ladder": "none",
  "from_stage": null,
  "to_stage": null,
  "decision": "wait",
  "reason": "Insufficient evidence to advance lead status; waiting for further engagement or signals.",
  "trigger_reason": "cron_sweep",
  "deal_id": null,
  "attempts": 5,
  "max_attempts": 5,
  "next_retry_at": "2026-09-29T00:51:43.918Z",
  "last_error": null,
  "result_summary": {
    "reason": "Insufficient evidence to advance lead status; waiting for further engagement or signals.",
    "waitHours": 48
  },
  "last_applied_at": "2026-09-17T00:42:48.020Z",
  "created_at": "2026-09-16T00:41:32.801Z",
  "updated_at": "2026-09-27T00:51:43.922Z",
  "completed_at": "2026-09-27T00:51:43.918Z"
}
```

### crm.lead_nurture_jobs

This is the queue row for an automated nurture touch on a lead. Nurture operations reports count pending and sent jobs. Marketing opt-out on contact_profiles must be respected before any send is treated as successful.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.lead_nurture_jobs. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `contact_id` | text | yes | CRM contact overlay id (crm.contact_profiles.id) when this row is tied to a person. |
| `status` | LeadNurtureStatus | yes | Lifecycle status of this crm.lead_nurture_jobs row. Filter only with documented enum or varchar codes. |
| `decision` | text | no | Value of decision on crm.lead_nurture_jobs (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `attempts` | integer | yes | Value of attempts on crm.lead_nurture_jobs (integer). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `max_attempts` | integer | yes | Value of max_attempts on crm.lead_nurture_jobs (integer). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `next_retry_at` | timestamp without time zone | no | Timestamp on crm.lead_nurture_jobs for the “next retry” event. Null means that event has not happened. |
| `last_error` | text | no | Value of last_error on crm.lead_nurture_jobs (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `result_summary` | jsonb | no | Value of result_summary on crm.lead_nurture_jobs (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `last_sent_at` | timestamp without time zone | no | Timestamp on crm.lead_nurture_jobs for the “last sent” event. Null means that event has not happened. |
| `created_at` | timestamp without time zone | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamp without time zone | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |
| `completed_at` | timestamp without time zone | no | Timestamp on crm.lead_nurture_jobs for the “completed” event. Null means that event has not happened. |
| `nurture_status` | varchar | no | Value of nurture_status on crm.lead_nurture_jobs (varchar). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `current_sequence_step` | integer | no | Value of current_sequence_step on crm.lead_nurture_jobs (integer). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `sequence_started_at` | timestamp without time zone | no | Timestamp on crm.lead_nurture_jobs for the “sequence started” event. Null means that event has not happened. |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "lnj_b7b12dd882ecf31fef7066ee",
  "organization_id": "1003",
  "contact_id": "06200a60-07fe-4d1a-8cc4-b531bec9b20f",
  "status": "sent",
  "decision": "nurture_now",
  "attempts": 1,
  "max_attempts": 5,
  "next_retry_at": "2026-10-07T00:41:54.548Z",
  "last_error": null,
  "result_summary": {
    "score": 55,
    "source": "ai-service",
    "subject": "Quick question",
    "rationale": "New lead with no prior outreach or decline signal; suitable for initial nurture."
  },
  "last_sent_at": "2026-09-16T00:41:54.548Z",
  "created_at": "2026-09-16T00:41:42.122Z",
  "updated_at": "2026-09-17T00:42:55.785Z",
  "completed_at": "2026-09-16T00:41:54.572Z",
  "nurture_status": "active_cold",
  "current_sequence_step": 0,
  "sequence_started_at": "2026-09-16T00:41:42.123Z"
}
```

### crm.lead_scoring_jobs

This is the queue row for a lead-score calculation. Scoring operations reports count jobs by status. The score value the business sees is stored with the lead score result, not only as a job.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.lead_scoring_jobs. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `contact_id` | text | yes | CRM contact overlay id (crm.contact_profiles.id) when this row is tied to a person. |
| `status` | LeadScoringStatus | yes | Lifecycle status of this crm.lead_scoring_jobs row. Filter only with documented enum or varchar codes. |
| `score` | integer | no | Value of score on crm.lead_scoring_jobs (integer). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `grade` | text | no | Value of grade on crm.lead_scoring_jobs (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `band` | text | no | Value of band on crm.lead_scoring_jobs (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `rationale` | text | no | Value of rationale on crm.lead_scoring_jobs (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `factors` | jsonb | no | Value of factors on crm.lead_scoring_jobs (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `next_best_action` | text | no | Value of next_best_action on crm.lead_scoring_jobs (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `trigger_reason` | text | no | Value of trigger_reason on crm.lead_scoring_jobs (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `previous_score` | integer | no | Value of previous_score on crm.lead_scoring_jobs (integer). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `attempts` | integer | yes | Value of attempts on crm.lead_scoring_jobs (integer). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `max_attempts` | integer | yes | Value of max_attempts on crm.lead_scoring_jobs (integer). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `next_retry_at` | timestamp without time zone | no | Timestamp on crm.lead_scoring_jobs for the “next retry” event. Null means that event has not happened. |
| `last_error` | text | no | Value of last_error on crm.lead_scoring_jobs (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `result_summary` | jsonb | no | Value of result_summary on crm.lead_scoring_jobs (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `created_at` | timestamp without time zone | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamp without time zone | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |
| `completed_at` | timestamp without time zone | no | Timestamp on crm.lead_scoring_jobs for the “completed” event. Null means that event has not happened. |
| `fit_score` | integer | no | Value of fit_score on crm.lead_scoring_jobs (integer). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `intent_score` | integer | no | Value of intent_score on crm.lead_scoring_jobs (integer). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "lsj_00b55550db0982997a883770",
  "organization_id": "1003",
  "contact_id": "CDP-crm-org1003-6e1c623cea5a4710b056d6b47c9e7032",
  "status": "scored",
  "score": 80,
  "grade": "A",
  "band": "hot",
  "rationale": "High-value enterprise target (Apple) with explicit demo/quote request intent. Despite a personal email domain, the inbound request and recent activity indicate high urgency.",
  "factors": [
    "Enterprise firmographics",
    "Explicit demo request",
    "High website visit frequency"
  ],
  "next_best_action": "Reply to the latest customer message and propose concrete next steps from the recent meeting.",
  "trigger_reason": "enrichment_complete",
  "previous_score": 80,
  "attempts": 24,
  "max_attempts": 5,
  "next_retry_at": null,
  "last_error": null,
  "result_summary": "[json 1026 chars omitted]",
  "created_at": "2026-09-04T05:02:37.339Z",
  "updated_at": "2026-09-08T10:06:00.496Z",
  "completed_at": "2026-09-08T10:06:00.492Z",
  "fit_score": 35,
  "intent_score": 45
}
```

### crm.lead_summaries

This stores the latest AI summary text for a lead. A report that shows the written summary reads it. Counts of leads still come from contact_profiles, not from how many summary rows exist.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.lead_summaries. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `contact_id` | text | yes | CRM contact overlay id (crm.contact_profiles.id) when this row is tied to a person. |
| `summary` | text | yes | Value of summary on crm.lead_summaries (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `headline` | text | no | Value of headline on crm.lead_summaries (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `intent` | text | no | Value of intent on crm.lead_summaries (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `signature` | text | yes | Value of signature on crm.lead_summaries (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `source` | text | yes | Value of source on crm.lead_summaries (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `model` | text | no | Value of model on crm.lead_summaries (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `created_at` | timestamp without time zone | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamp without time zone | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |
| `recommended_action` | text | no | Value of recommended_action on crm.lead_summaries (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `flags` | jsonb | no | Value of flags on crm.lead_summaries (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "ls_5b16913263c9bd0a327b4b2a",
  "organization_id": "1003",
  "contact_id": "CDP-webchat-org1003-visitor_50a00a9e-479c-4e90-a3b6-1536329a6f77",
  "summary": "Situation\nA new lead has been ingested into the CRM via cdp_ingest. Name, title, company, and domain are all unknown.\n\nEngagement\n- Score band: cold\n- Fit score: 5 (firmographics only)\n- Intent score: 0\n- BANT: no criteria met\n- Deals: none\n- Activities: none recorded\n\nNext step\n…",
  "headline": null,
  "intent": "New lead",
  "signature": "61ee989bc0fac7a88386b4f8f4d235d07376e544",
  "source": "ai",
  "model": "ai-service",
  "created_at": "2026-08-27T06:32:12.924Z",
  "updated_at": "2026-08-27T06:32:12.924Z",
  "recommended_action": "Enrich lead data via email lookup or firmographic append to establish company identity and title before any outreach; current record lacks sufficient information for meaningful scoring.",
  "flags": {
    "band": "cold",
    "score": 5,
    "fitScore": 5,
    "intentScore": 0
  }
}
```

### crm.meeting_analyses

This stores the AI read of one meeting, including summary and extracted points. Meeting-quality and coaching reports join it to the appointment or meeting session. It does not replace the calendar appointment.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.meeting_analyses. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `activity_id` | text | yes | Identifier stored on crm.meeting_analyses. Join the table that owns this id. Do not treat it as a display label. |
| `contact_id` | text | no | CRM contact overlay id (crm.contact_profiles.id) when this row is tied to a person. |
| `deal_id` | text | no | crm.deals.id this commercial or activity row belongs to. |
| `outcome` | varchar | no | Value of outcome on crm.meeting_analyses (varchar). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `bant_budget` | boolean | no | Value of bant_budget on crm.meeting_analyses (boolean). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `bant_authority` | boolean | no | Value of bant_authority on crm.meeting_analyses (boolean). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `bant_need` | boolean | no | Value of bant_need on crm.meeting_analyses (boolean). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `bant_timeline_text` | varchar | no | Value of bant_timeline_text on crm.meeting_analyses (varchar). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `next_step_agreed` | text | no | Value of next_step_agreed on crm.meeting_analyses (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `objections_raised` | jsonb | yes | Value of objections_raised on crm.meeting_analyses (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `confidence` | double precision | yes | Value of confidence on crm.meeting_analyses (double precision). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `evidence` | jsonb | yes | Value of evidence on crm.meeting_analyses (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `analyzed_at` | timestamptz | yes | Timestamp on crm.meeting_analyses for the “analyzed” event. Null means that event has not happened. |
| `created_at` | timestamptz | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "617daad7170b424786c05818",
  "organization_id": "1003",
  "activity_id": "cmu6kp12d001g1akci1c4mfor",
  "contact_id": "CDP-crm-org1003-3793d33baa10438dad02ebc73a5f4920",
  "deal_id": null,
  "outcome": "positive",
  "bant_budget": false,
  "bant_authority": false,
  "bant_need": false,
  "bant_timeline_text": null,
  "next_step_agreed": null,
  "objections_raised": [],
  "confidence": 0.7,
  "evidence": [],
  "analyzed_at": "2026-09-18T06:36:14.986Z",
  "created_at": "2026-09-18T06:36:14.986Z"
}
```

### crm.meeting_assist_sessions

This is one live or completed Meet assist session for a meeting. Assist usage reports count sessions and whether a rep opened the panel. Transcript text is in meeting_transcript_chunks.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.meeting_assist_sessions. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `contact_id` | text | yes | CRM contact overlay id (crm.contact_profiles.id) when this row is tied to a person. |
| `activity_id` | text | yes | Identifier stored on crm.meeting_assist_sessions. Join the table that owns this id. Do not treat it as a display label. |
| `provider` | meeting_assist_provider | yes | Value of provider on crm.meeting_assist_sessions (meeting_assist_provider). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `external_meeting_id` | text | no | Identifier stored on crm.meeting_assist_sessions. Join the table that owns this id. Do not treat it as a display label. |
| `join_url` | text | no | Value of join_url on crm.meeting_assist_sessions (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `host_user_id` | bigint | no | Identifier stored on crm.meeting_assist_sessions. Join the table that owns this id. Do not treat it as a display label. |
| `status` | meeting_assist_status | yes | Lifecycle status of this crm.meeting_assist_sessions row. Filter only with documented enum or varchar codes. |
| `started_at` | timestamp without time zone | yes | Timestamp on crm.meeting_assist_sessions for the “started” event. Null means that event has not happened. |
| `ended_at` | timestamp without time zone | no | Timestamp on crm.meeting_assist_sessions for the “ended” event. Null means that event has not happened. |
| `last_assist_at` | timestamp without time zone | no | Timestamp on crm.meeting_assist_sessions for the “last assist” event. Null means that event has not happened. |
| `last_suggestions` | jsonb | no | Value of last_suggestions on crm.meeting_assist_sessions (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `meta` | jsonb | no | Value of meta on crm.meeting_assist_sessions (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `created_at` | timestamp without time zone | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamp without time zone | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "cmul00unr000iqm0uv8en6u9p",
  "organization_id": "1003",
  "contact_id": "CDP-crm-org1003-3793d33baa10438dad02ebc73a5f4920",
  "activity_id": "cmul00uk8000fqm0u7t6swyu1",
  "provider": "google_meet",
  "external_meeting_id": "8gac22e77v2ls41ap4tqn4j500",
  "join_url": "https://meet.google.com/wmz-brwe-yfg",
  "host_user_id": "1015",
  "status": "active",
  "started_at": "2026-09-28T03:11:49.623Z",
  "ended_at": null,
  "last_assist_at": null,
  "last_suggestions": null,
  "meta": "[json 2514 chars omitted]",
  "created_at": "2026-09-28T03:11:49.623Z",
  "updated_at": "2026-09-28T03:38:36.410Z"
}
```

### crm.meeting_transcript_chunks

This is one piece of transcript captured during a Meet assist session. It joins meeting_assist_sessions. Analytical questions about what was said belong to the knowledge-graph executor; the SQL executor only counts or fetches chunks the role is allowed to see.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.meeting_transcript_chunks. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `session_id` | text | yes | Identifier stored on crm.meeting_transcript_chunks. Join the table that owns this id. Do not treat it as a display label. |
| `seq` | integer | yes | Value of seq on crm.meeting_transcript_chunks (integer). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `speaker` | text | no | Value of speaker on crm.meeting_transcript_chunks (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `text` | text | yes | Value of text on crm.meeting_transcript_chunks (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `spoken_at` | timestamp without time zone | no | Timestamp on crm.meeting_transcript_chunks for the “spoken” event. Null means that event has not happened. |
| `source` | text | yes | Value of source on crm.meeting_transcript_chunks (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `created_at` | timestamp without time zone | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `speaker_email` | varchar | no | Value of speaker_email on crm.meeting_transcript_chunks (varchar). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "cmue1nlq4001f1a0la9tcic36",
  "session_id": "cmudxfs2c00251aiqzzy8um3t",
  "seq": 145,
  "speaker": "Lucifer S",
  "text": "Hello",
  "spoken_at": null,
  "source": "vexa_live",
  "created_at": "2026-09-23T06:23:07.516Z",
  "organization_id": "1003",
  "speaker_email": null
}
```

### crm.notifications

This is an in-app notification for one user, such as quote accepted or a task due. Adoption reports can count unread notifications. It is not the business event itself; join the linked record if the question is about the quote or deal.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.notifications. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `recipient_user_id` | bigint | yes | Identifier stored on crm.notifications. Join the table that owns this id. Do not treat it as a display label. |
| `actor_user_id` | bigint | no | Identifier stored on crm.notifications. Join the table that owns this id. Do not treat it as a display label. |
| `kind` | text | yes | Value of kind on crm.notifications (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `title` | text | yes | Value of title on crm.notifications (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `body` | text | no | Value of body on crm.notifications (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `href` | text | no | Value of href on crm.notifications (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `entity_type` | text | no | Value of entity_type on crm.notifications (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `entity_id` | text | no | Identifier stored on crm.notifications. Join the table that owns this id. Do not treat it as a display label. |
| `contact_id` | text | no | CRM contact overlay id (crm.contact_profiles.id) when this row is tied to a person. |
| `metadata` | jsonb | no | Value of metadata on crm.notifications (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `read_at` | timestamp without time zone | no | Timestamp on crm.notifications for the “read” event. Null means that event has not happened. |
| `created_at` | timestamp without time zone | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "nt_f8b92be66187cdd5cda420b1",
  "organization_id": "1003",
  "recipient_user_id": "1017",
  "actor_user_id": null,
  "kind": "meeting_brief",
  "title": "Meeting reminder (in ~24 hours): amelian' harrason",
  "body": "Monday, August 31, 2026 · 5:00 PM – 5:30 PM (Asia/Kolkata) · Google Meet",
  "href": "/contact/CDP-webchat-org1003-visitor_0cedeabe-003d-431a-a5d5-e5a069708a2e",
  "entity_type": null,
  "entity_id": null,
  "contact_id": null,
  "metadata": null,
  "read_at": null,
  "created_at": "2026-08-30T05:58:06.328Z"
}
```

### crm.order_lines

This is one line copied onto the sales order from the quote. Fulfilment and product-quantity reports use these lines. They join sales_orders and the catalog product.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.order_lines. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `order_id` | text | yes | Identifier stored on crm.order_lines. Join the table that owns this id. Do not treat it as a display label. |
| `product_id` | text | no | inventory.products.id. Join products for name, sku, and billing type. |
| `name` | text | yes | Display name stored on crm.order_lines. |
| `quantity` | numeric | yes | Value of quantity on crm.order_lines (numeric). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `unit_price` | numeric | yes | Value of unit_price on crm.order_lines (numeric). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `amount` | numeric | yes | Money amount on this crm.order_lines row. Keep sums inside one currency. Null is 0 only when the KPI catalog says so. |
| `sort_order` | integer | yes | Value of sort_order on crm.order_lines (integer). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `created_at` | timestamp without time zone | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamp without time zone | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "cmt30jssy000m1aqdvnw6n17v",
  "order_id": "cmt30jssy000k1aqdlgjzzaga",
  "product_id": null,
  "name": "Contact Center",
  "quantity": "1.00",
  "unit_price": "0.00",
  "amount": "0.00",
  "sort_order": 0,
  "created_at": "2026-08-21T08:27:00.177Z",
  "updated_at": "2026-08-21T08:27:00.177Z",
  "organization_id": "1000"
}
```

### crm.org_assignment_settings

This stores how the tenant wants new leads assigned, including the assignment mode and related rules. A routing or coverage report reads this to explain why an owner was chosen. It does not itself contain the lead rows.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.org_assignment_settings. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `senior_amount_threshold` | integer | yes | Value of senior_amount_threshold on crm.org_assignment_settings (integer). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `updated_by_user_id` | bigint | no | Identifier stored on crm.org_assignment_settings. Join the table that owns this id. Do not treat it as a display label. |
| `created_at` | timestamp without time zone | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamp without time zone | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |
| `lead_icp` | jsonb | no | Value of lead_icp on crm.org_assignment_settings (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `followup_policy` | jsonb | no | Value of followup_policy on crm.org_assignment_settings (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "cmtbukjsj00001auwjxhzexsn",
  "organization_id": "1003",
  "senior_amount_threshold": 50000,
  "updated_by_user_id": "1015",
  "created_at": "2026-08-27T12:49:33.043Z",
  "updated_at": "2026-09-15T04:47:01.484Z",
  "lead_icp": {
    "sizeTiers": [
      "500-1000"
    ],
    "serviceableGeos": [
      "IN"
    ],
    "targetIndustries": [
      "BFSI"
    ],
    "adjacentIndustries": [
      "Finance"
    ]
  },
  "followup_policy": null
}
```

### crm.org_finance_settings

This stores tenant finance preferences such as default currency and invoice behaviour. Finance reports use it so totals are labelled in the tenant currency and draft-versus-send rules match the org, not a hardcoded default.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.org_finance_settings. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `default_payment_terms` | text | yes | Value of default_payment_terms on crm.org_finance_settings (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `zero_amount_auto_paid` | boolean | yes | Value of zero_amount_auto_paid on crm.org_finance_settings (boolean). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `offline_reference_min_len` | integer | yes | Value of offline_reference_min_len on crm.org_finance_settings (integer). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `duplicate_invoice_guard` | boolean | yes | Value of duplicate_invoice_guard on crm.org_finance_settings (boolean). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `online_payments_enabled` | boolean | yes | Value of online_payments_enabled on crm.org_finance_settings (boolean). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `payment_routing_rules` | jsonb | no | Value of payment_routing_rules on crm.org_finance_settings (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `bank_details` | jsonb | no | Value of bank_details on crm.org_finance_settings (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `invoice_number_prefix` | text | no | Value of invoice_number_prefix on crm.org_finance_settings (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `invoice_number_next_seq` | integer | yes | Value of invoice_number_next_seq on crm.org_finance_settings (integer). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `stripe_publishable_key` | text | no | Value of stripe_publishable_key on crm.org_finance_settings (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `stripe_secret_key_enc` | text | no | Sensitive field on crm.org_finance_settings. Never select it in a report. Never project this column into a report result. |
| `stripe_webhook_secret_enc` | text | no | Sensitive field on crm.org_finance_settings. Never select it in a report. Never project this column into a report result. |
| `razorpay_key_id` | text | no | Identifier stored on crm.org_finance_settings. Join the table that owns this id. Do not treat it as a display label. |
| `razorpay_key_secret_enc` | text | no | Sensitive field on crm.org_finance_settings. Never select it in a report. Never project this column into a report result. |
| `razorpay_webhook_secret_enc` | text | no | Sensitive field on crm.org_finance_settings. Never select it in a report. Never project this column into a report result. |
| `updated_by_user_id` | bigint | no | Identifier stored on crm.org_finance_settings. Join the table that owns this id. Do not treat it as a display label. |
| `created_at` | timestamp without time zone | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamp without time zone | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |
| `billing_cutoff_day` | integer | yes | Value of billing_cutoff_day on crm.org_finance_settings (integer). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `renewal_window_days` | integer | yes | Value of renewal_window_days on crm.org_finance_settings (integer). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `auto_renew_default` | boolean | yes | Value of auto_renew_default on crm.org_finance_settings (boolean). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `renewal_quote_auto_create` | boolean | yes | Value of renewal_quote_auto_create on crm.org_finance_settings (boolean). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `revenue_target_monthly` | numeric | no | Value of revenue_target_monthly on crm.org_finance_settings (numeric). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `revenue_target_quarterly` | numeric | no | Value of revenue_target_quarterly on crm.org_finance_settings (numeric). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `revenue_forecast_last_run` | jsonb | no | Value of revenue_forecast_last_run on crm.org_finance_settings (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `revenue_forecast_last_run_at` | timestamptz | no | Timestamp on crm.org_finance_settings for the “revenue forecast last run” event. Null means that event has not happened. |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "cmtemicqd001nnx0uxlrdha0d",
  "organization_id": "1003",
  "default_payment_terms": "Net 30",
  "zero_amount_auto_paid": true,
  "offline_reference_min_len": 1,
  "duplicate_invoice_guard": true,
  "online_payments_enabled": true,
  "payment_routing_rules": {
    "rules": [],
    "defaultProvider": "stripe"
  },
  "bank_details": {
    "iban": "",
    "ifsc": "UTIB0000234",
    "notes": "",
    "swift": "",
    "bankName": "Axis",
    "accountName": "Worktual",
    "accountNumber": "926010000000009",
    "routingNumber": ""
  },
  "invoice_number_prefix": null,
  "invoice_number_next_seq": 1,
  "stripe_publishable_key": null,
  "stripe_secret_key_enc": null,
  "stripe_webhook_secret_enc": null,
  "razorpay_key_id": null,
  "razorpay_key_secret_enc": null,
  "razorpay_webhook_secret_enc": null,
  "updated_by_user_id": "1015",
  "created_at": "2026-08-29T11:27:12.182Z",
  "updated_at": "2026-09-23T23:03:27.157Z",
  "billing_cutoff_day": 20,
  "renewal_window_days": 30,
  "auto_renew_default": false,
  "renewal_quote_auto_create": true,
  "revenue_target_monthly": null,
  "revenue_target_quarterly": null,
  "revenue_forecast_last_run": {
    "hasTarget": false,
    "narrative": "No revenue was collected in September 2026 and there are no open overdue or near-close invoices to track. With no monthly or quarterly target configured, there is no gap to close. This is a clean slate rather than a missed target.",
    "gapScenario": "",
    "atRiskInvoiceIds": []
  },
  "revenue_forecast_last_run_at": "2026-09-23T11:34:06.625Z"
}
```

### crm.org_research_provider_configs

This stores which research or prospect provider the tenant has enabled, such as ZoomInfo, without putting secrets in the report output. Prospect-source reports use it only to name the provider. Pulled people live in prospect tables and then in CDP if imported.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.org_research_provider_configs. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `provider` | ResearchProvider | yes | Value of provider on crm.org_research_provider_configs (ResearchProvider). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `enabled` | boolean | yes | Value of enabled on crm.org_research_provider_configs (boolean). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `api_key_enc` | text | no | Sensitive field on crm.org_research_provider_configs. Never select it in a report. Never project this column into a report result. |
| `api_key_hint` | text | no | Value of api_key_hint on crm.org_research_provider_configs (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. Never project this column into a report result. |
| `settings` | jsonb | no | Value of settings on crm.org_research_provider_configs (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `updated_by_user_id` | bigint | no | Identifier stored on crm.org_research_provider_configs. Join the table that owns this id. Do not treat it as a display label. |
| `created_at` | timestamp without time zone | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamp without time zone | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "rpc_8c748a4584a9470ffa5008c1",
  "organization_id": "1003",
  "provider": "builtwith",
  "enabled": false,
  "api_key_enc": null,
  "api_key_hint": null,
  "settings": {
    "competitorStacks": []
  },
  "updated_by_user_id": "1015",
  "created_at": "2026-09-15T02:06:11.905Z",
  "updated_at": "2026-09-15T04:47:02.245Z"
}
```

### crm.organization_profiles

This is optional CRM configuration for one tenant, keyed by the same organization id used in accounts.organizations. It holds the industry field-pack choice, internal email domains used to tell staff from customers, and related settings. Reports use it when a metric must respect tenant industry or internal-domain rules.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `vertical` | OrganizationVertical | yes | Value of vertical on crm.organization_profiles (OrganizationVertical). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `vertical_config` | jsonb | yes | Value of vertical_config on crm.organization_profiles (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `created_at` | timestamp without time zone | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamp without time zone | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |
| `internal_domains` | ARRAY | yes | Value of internal_domains on crm.organization_profiles (ARRAY). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `internal_domains_mode` | varchar | yes | Value of internal_domains_mode on crm.organization_profiles (varchar). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `internal_domain_overrides` | ARRAY | yes | Value of internal_domain_overrides on crm.organization_profiles (ARRAY). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `internal_domains_updated_at` | timestamptz | no | Timestamp on crm.organization_profiles for the “internal domains updated” event. Null means that event has not happened. |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "organization_id": "1003",
  "vertical": "general",
  "vertical_config": {},
  "created_at": "2026-09-18T12:06:09.076Z",
  "updated_at": "2026-09-29T09:22:56.810Z",
  "internal_domains": [
    "worktual.com"
  ],
  "internal_domains_mode": "derived",
  "internal_domain_overrides": [],
  "internal_domains_updated_at": "2026-09-29T14:52:56.809Z"
}
```

### crm.payment_gateway_events

This stores a webhook event received from a payment provider after an invoice payment link is used. Collection and paid-invoice reports join it to invoices to show that money moved, including the provider reference. It is an event log, not the invoice itself.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.payment_gateway_events. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `provider` | PaymentGatewayProvider | yes | Value of provider on crm.payment_gateway_events (PaymentGatewayProvider). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `external_event_id` | text | yes | Identifier stored on crm.payment_gateway_events. Join the table that owns this id. Do not treat it as a display label. |
| `invoice_id` | text | no | Identifier stored on crm.payment_gateway_events. Join the table that owns this id. Do not treat it as a display label. |
| `payload` | jsonb | no | Value of payload on crm.payment_gateway_events (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `processed_at` | timestamp without time zone | yes | Timestamp on crm.payment_gateway_events for the “processed” event. Null means that event has not happened. |

No row was available to show a live example.

### crm.price_book_entries

This is one product's price inside one price book, including amount and currency. It joins price_books and inventory.products. A report that compares list price to the price actually quoted uses this row as the list price.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.price_book_entries. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `price_book_id` | text | yes | Identifier stored on crm.price_book_entries. Join the table that owns this id. Do not treat it as a display label. |
| `product_id` | text | no | inventory.products.id. Join products for name, sku, and billing type. |
| `offer_id` | text | no | Identifier stored on crm.price_book_entries. Join the table that owns this id. Do not treat it as a display label. |
| `addon_id` | text | no | Identifier stored on crm.price_book_entries. Join the table that owns this id. Do not treat it as a display label. |
| `amount` | numeric | yes | Money amount on this crm.price_book_entries row. Keep sums inside one currency. Null is 0 only when the KPI catalog says so. |
| `billing_frequency` | ProductBillingFrequency | no | Value of billing_frequency on crm.price_book_entries (ProductBillingFrequency). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `created_at` | timestamp without time zone | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamp without time zone | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "wt-entry-in-ccaas-starter",
  "organization_id": "1003",
  "price_book_id": "wt-book-india",
  "product_id": null,
  "offer_id": "wt-offer-ccaas-starter",
  "addon_id": null,
  "amount": "3000.00",
  "billing_frequency": null,
  "created_at": "2026-09-03T03:26:38.519Z",
  "updated_at": "2026-09-03T03:26:38.519Z"
}
```

### crm.price_books

This is a named price list for the tenant, for example standard or partner pricing. It has no amounts by itself. Quote lines resolve a price through price book entries, so a price-list report starts at this header and joins the entries.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.price_books. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `name` | text | yes | Display name stored on crm.price_books. |
| `code` | text | no | Value of code on crm.price_books (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `currency` | text | yes | ISO currency code for money on this row. Never add two currencies together. |
| `is_default` | boolean | yes | Value of is_default on crm.price_books (boolean). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `created_at` | timestamp without time zone | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamp without time zone | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "wt-book-uk",
  "organization_id": "1003",
  "name": "United Kingdom",
  "code": "UK",
  "currency": "GBP",
  "is_default": false,
  "created_at": "2026-09-03T03:26:36.010Z",
  "updated_at": "2026-09-03T03:26:36.010Z"
}
```

### crm.privacy_requests

This stores a privacy request such as delete or export for a person. Compliance reports count open requests. Honouring the request is an operational workflow; the row is the record that it was asked.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.privacy_requests. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `activity_id` | text | yes | Identifier stored on crm.privacy_requests. Join the table that owns this id. Do not treat it as a display label. |
| `contact_id` | text | yes | CRM contact overlay id (crm.contact_profiles.id) when this row is tied to a person. |
| `request_type` | varchar | yes | Value of request_type on crm.privacy_requests (varchar). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `confidence` | varchar | yes | Value of confidence on crm.privacy_requests (varchar). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `status` | varchar | yes | Lifecycle status of this crm.privacy_requests row. Filter only with documented enum or varchar codes. |
| `reason` | text | no | Value of reason on crm.privacy_requests (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `draft_confirmation` | text | no | Value of draft_confirmation on crm.privacy_requests (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `reviewed_by_user_id` | bigint | no | Identifier stored on crm.privacy_requests. Join the table that owns this id. Do not treat it as a display label. |
| `reviewed_at` | timestamptz | no | Timestamp on crm.privacy_requests for the “reviewed” event. Null means that event has not happened. |
| `executed_at` | timestamptz | no | Timestamp on crm.privacy_requests for the “executed” event. Null means that event has not happened. |
| `created_at` | timestamptz | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamptz | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |

No row was available to show a live example.

### crm.process_confirmations

This stores a user's confirmation of a proposed process step, so an agent does not apply a change the user rejected. Audit reports for agent actions join it to the related record. It is not a deal stage.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.process_confirmations. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `contact_id` | text | yes | CRM contact overlay id (crm.contact_profiles.id) when this row is tied to a person. |
| `owner_user_id` | bigint | yes | accounts.setup_users.id of the owner. Reps are scoped to this column. Join setup_users for the name. |
| `activity_id` | text | no | Identifier stored on crm.process_confirmations. Join the table that owns this id. Do not treat it as a display label. |
| `deal_id` | text | no | crm.deals.id this commercial or activity row belongs to. |
| `action_kind` | text | yes | Value of action_kind on crm.process_confirmations (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `title` | text | yes | Value of title on crm.process_confirmations (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `summary` | text | no | Value of summary on crm.process_confirmations (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `payload` | jsonb | yes | Value of payload on crm.process_confirmations (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `status` | ProcessConfirmationStatus | yes | Lifecycle status of this crm.process_confirmations row. Filter only with documented enum or varchar codes. |
| `decided_at` | timestamp without time zone | no | Timestamp on crm.process_confirmations for the “decided” event. Null means that event has not happened. |
| `decided_by_user_id` | bigint | no | Identifier stored on crm.process_confirmations. Join the table that owns this id. Do not treat it as a display label. |
| `result_note` | text | no | Value of result_note on crm.process_confirmations (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `created_at` | timestamp without time zone | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamp without time zone | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "cmul9ohzn01wgqm0uihizon2w",
  "organization_id": "1003",
  "contact_id": "CDP-crm-org1003-52db908dc4ab4fad9d502baab1dec921",
  "owner_user_id": "1066",
  "activity_id": null,
  "deal_id": "cmul9ofkg01vvqm0u2khw3xn6",
  "action_kind": "quote_send",
  "title": "Approve: quote send",
  "summary": "The lead has requested a payment link and is asking for pricing details in USD, which directly supports sending the current draft quote.",
  "payload": "[json 454 chars omitted]",
  "status": "pending",
  "decided_at": null,
  "decided_by_user_id": null,
  "result_note": null,
  "created_at": "2026-09-28T07:42:09.491Z",
  "updated_at": "2026-09-28T07:42:09.491Z"
}
```

### crm.product_addon_tiers

This is a priced tier of an add-on, such as a seat band or usage band. It joins addons. A report that needs the add-on price uses the tier amount rather than inventing a price on the add-on header.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.product_addon_tiers. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `addon_id` | text | yes | Identifier stored on crm.product_addon_tiers. Join the table that owns this id. Do not treat it as a display label. |
| `min_qty` | integer | yes | Value of min_qty on crm.product_addon_tiers (integer). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `max_qty` | integer | no | Value of max_qty on crm.product_addon_tiers (integer). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `unit_price` | numeric | yes | Value of unit_price on crm.product_addon_tiers (numeric). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `created_at` | timestamp without time zone | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamp without time zone | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "wt-tier-tix-1k",
  "addon_id": "wt-addon-ticket-overage",
  "min_qty": 1,
  "max_qty": 1000,
  "unit_price": "12.0000",
  "created_at": "2026-09-03T03:26:40.772Z",
  "updated_at": "2026-09-03T03:26:40.772Z",
  "organization_id": "1003"
}
```

### crm.product_addons

This is an optional extra that can be sold alongside a product. The row names the add-on and links it to a catalog product. Quote and invoice lines can include it so attach-rate reports can count how often the extra is sold with the base product.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.product_addons. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `product_id` | text | yes | inventory.products.id. Join products for name, sku, and billing type. |
| `name` | text | yes | Display name stored on crm.product_addons. |
| `unit_label` | text | no | Value of unit_label on crm.product_addons (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `pricing_model` | AddonPricingModel | yes | Value of pricing_model on crm.product_addons (AddonPricingModel). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `flat_price` | numeric | no | Value of flat_price on crm.product_addons (numeric). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `unit_price` | numeric | no | Value of unit_price on crm.product_addons (numeric). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `step_size` | integer | no | Value of step_size on crm.product_addons (integer). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `step_price` | numeric | no | Value of step_price on crm.product_addons (numeric). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `sort_order` | integer | yes | Value of sort_order on crm.product_addons (integer). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `created_at` | timestamp without time zone | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamp without time zone | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |
| `meter_key` | AddonMeterKey | no | Value of meter_key on crm.product_addons (AddonMeterKey). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `is_overage` | boolean | yes | Value of is_overage on crm.product_addons (boolean). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "wt-addon-ccaas-impl",
  "organization_id": "1003",
  "product_id": "wt-product-ccaas",
  "name": "Implementation",
  "unit_label": null,
  "pricing_model": "flat",
  "flat_price": "90000.00",
  "unit_price": null,
  "step_size": null,
  "step_price": null,
  "sort_order": 0,
  "created_at": "2026-09-03T03:26:36.778Z",
  "updated_at": "2026-09-03T03:26:36.778Z",
  "meter_key": "flat",
  "is_overage": false
}
```

### crm.product_offers

This is a CRM commercial wrapper around one catalog product, such as a named offer the sales team can put on a quote. It joins inventory.products so the catalog stays shared while CRM-only offer terms stay in crm. Reports that ask which offer is attached to revenue start here and follow the product id.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.product_offers. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `product_id` | text | yes | inventory.products.id. Join products for name, sku, and billing type. |
| `name` | text | yes | Display name stored on crm.product_offers. |
| `code` | text | no | Value of code on crm.product_offers (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `billing_type` | ProductBillingType | no | Value of billing_type on crm.product_offers (ProductBillingType). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `billing_frequency` | ProductBillingFrequency | no | Value of billing_frequency on crm.product_offers (ProductBillingFrequency). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `included_qty` | integer | no | Value of included_qty on crm.product_offers (integer). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `meter_key` | AddonMeterKey | no | Value of meter_key on crm.product_offers (AddonMeterKey). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `sort_order` | integer | yes | Value of sort_order on crm.product_offers (integer). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `status` | ProductStatus | yes | Lifecycle status of this crm.product_offers row. Filter only with documented enum or varchar codes. |
| `created_at` | timestamp without time zone | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamp without time zone | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "wt-offer-ccaas-starter",
  "organization_id": "1003",
  "product_id": "wt-product-ccaas",
  "name": "Starter",
  "code": "STARTER",
  "billing_type": "recurring",
  "billing_frequency": "monthly",
  "included_qty": 1,
  "meter_key": "seat",
  "sort_order": 0,
  "status": "active",
  "created_at": "2026-09-03T03:26:36.778Z",
  "updated_at": "2026-09-03T03:26:36.778Z"
}
```

### crm.proposal_content_playbooks

This stores reusable proposal content guidance learned from the corpus. It is read by the proposal agent. A report may list playbooks. It does not price a deal.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.proposal_content_playbooks. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `version` | integer | yes | Value of version on crm.proposal_content_playbooks (integer). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `section_specs_json` | jsonb | yes | Value of section_specs_json on crm.proposal_content_playbooks (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `length_model_json` | jsonb | yes | Value of length_model_json on crm.proposal_content_playbooks (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `exemplar_bank_json` | jsonb | yes | Value of exemplar_bank_json on crm.proposal_content_playbooks (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `case_study_count` | integer | yes | Value of case_study_count on crm.proposal_content_playbooks (integer). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `confidence_level` | text | yes | Value of confidence_level on crm.proposal_content_playbooks (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `variance_log_json` | jsonb | no | Value of variance_log_json on crm.proposal_content_playbooks (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `created_at` | timestamp without time zone | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "cmugwru73005gmo0uvzmp9sq3",
  "organization_id": "1003",
  "version": 1,
  "section_specs_json": "[json 1139 chars omitted]",
  "length_model_json": {
    "type": "Linear Multi-Variable Regression",
    "basis": "Calculated based on historical proposal page counts relative to the input BRD word count and complexity score.",
    "fallback": "If complexity or word count is missing, default to a standard 10-page proposal template.",
    "coefficients": {
      "intercept": 3,
      "perThousandWords": 3.5,
      "perComplexityPoint": 8
    }
  },
  "exemplar_bank_json": "[json 1371 chars omitted]",
  "case_study_count": 3,
  "confidence_level": "low",
  "variance_log_json": "[json 790 chars omitted]",
  "created_at": "2026-09-25T06:29:45.568Z"
}
```

### crm.proposal_corpus_batches

This groups a batch of past proposals used to learn writing patterns. It is training content for the proposal agent. Revenue reports do not use it.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.proposal_corpus_batches. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `created_by_user_id` | bigint | yes | accounts.setup_users.id of the creator. Can differ from the current owner. |
| `name` | text | no | Display name stored on crm.proposal_corpus_batches. |
| `status` | ProposalCorpusBatchStatus | yes | Lifecycle status of this crm.proposal_corpus_batches row. Filter only with documented enum or varchar codes. |
| `last_error` | text | no | Value of last_error on crm.proposal_corpus_batches (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `result_summary` | jsonb | no | Value of result_summary on crm.proposal_corpus_batches (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `created_at` | timestamp without time zone | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamp without time zone | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |
| `completed_at` | timestamp without time zone | no | Timestamp on crm.proposal_corpus_batches for the “completed” event. Null means that event has not happened. |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "cmugi0mns0000zureohxsoc6r",
  "organization_id": "1003",
  "created_by_user_id": "1015",
  "name": null,
  "status": "completed",
  "last_error": null,
  "result_summary": {
    "source": "ai",
    "itemCount": 2,
    "pairCount": 1,
    "goldItemId": "cmugi0nrd0004zuremid6yk19",
    "playbookId": "cmugi38fg000czureou2o9g6b",
    "playbookIds": [
      "cmugi38fg000czureou2o9g6b"
    ]
  },
  "created_at": "2026-09-24T23:36:41.465Z",
  "updated_at": "2026-09-24T23:38:44.603Z",
  "completed_at": "2026-09-24T23:38:44.602Z"
}
```

### crm.proposal_corpus_case_studies

This stores a case study extracted from the proposal corpus. Proposal content reports can list case studies. Won-revenue proof still comes from deals in closed_won, not from this text.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.proposal_corpus_case_studies. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `batch_id` | text | yes | Identifier stored on crm.proposal_corpus_case_studies. Join the table that owns this id. Do not treat it as a display label. |
| `pair_id` | text | yes | Identifier stored on crm.proposal_corpus_case_studies. Join the table that owns this id. Do not treat it as a display label. |
| `pairing_confidence` | double precision | yes | Value of pairing_confidence on crm.proposal_corpus_case_studies (double precision). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `section_analysis` | jsonb | yes | Value of section_analysis on crm.proposal_corpus_case_studies (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `length_analysis` | jsonb | yes | Value of length_analysis on crm.proposal_corpus_case_studies (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `created_at` | timestamp without time zone | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "cmugi2rnp000azurerc42ae1m",
  "organization_id": "1003",
  "batch_id": "cmugi0mns0000zureohxsoc6r",
  "pair_id": "cmugi10zs0008zurehokwr2rp",
  "pairing_confidence": 0.92,
  "section_analysis": "[json 5926 chars omitted]",
  "length_analysis": "[json 869 chars omitted]",
  "created_at": "2026-09-24T23:38:21.079Z"
}
```

### crm.proposal_corpus_items

This is one document inside a proposal corpus batch. It joins the batch. The knowledge-graph executor may cite it when explaining proposal language. The SQL executor only counts items.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.proposal_corpus_items. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `batch_id` | text | yes | Identifier stored on crm.proposal_corpus_items. Join the table that owns this id. Do not treat it as a display label. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `kind` | ProposalCorpusItemKind | yes | Value of kind on crm.proposal_corpus_items (ProposalCorpusItemKind). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `storage_path` | text | yes | Value of storage_path on crm.proposal_corpus_items (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `filename` | text | yes | Value of filename on crm.proposal_corpus_items (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `mime` | text | no | Value of mime on crm.proposal_corpus_items (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `page_count` | integer | no | Value of page_count on crm.proposal_corpus_items (integer). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `sha256` | text | no | Value of sha256 on crm.proposal_corpus_items (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `extract_json` | jsonb | no | Value of extract_json on crm.proposal_corpus_items (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `status` | ProposalCorpusItemStatus | yes | Lifecycle status of this crm.proposal_corpus_items row. Filter only with documented enum or varchar codes. |
| `last_error` | text | no | Value of last_error on crm.proposal_corpus_items (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `created_at` | timestamp without time zone | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamp without time zone | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |
| `pair_slot` | integer | yes | Value of pair_slot on crm.proposal_corpus_items (integer). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "cmugkrldl000wzuvkb2qv6hzn",
  "batch_id": "cmugkrk9w000szuvkn08a8fd3",
  "organization_id": "1003",
  "kind": "proposal",
  "storage_path": "1003/cmugkrk9w000szuvkn08a8fd3/cmugkrldl000wzuvkb2qv6hzn.pdf",
  "filename": "ORANGE_FINANCE_proposal.pdf",
  "mime": "application/pdf",
  "page_count": 6,
  "sha256": "6579b1e7a9cc7dad6e166b2aa8d466588bb3f8fcc3676fbe1932a0dedbfc5d2b",
  "extract_json": "[json 107183 chars omitted]",
  "status": "structured",
  "last_error": null,
  "created_at": "2026-09-25T00:53:38.745Z",
  "updated_at": "2026-09-25T00:54:34.112Z",
  "pair_slot": 0
}
```

### crm.proposal_corpus_jobs

This is the job that builds or refreshes a proposal corpus. Operations reports count job status. Customer-facing proposal status remains on the proposals table.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.proposal_corpus_jobs. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `batch_id` | text | yes | Identifier stored on crm.proposal_corpus_jobs. Join the table that owns this id. Do not treat it as a display label. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `status` | ProposalCorpusJobStatus | yes | Lifecycle status of this crm.proposal_corpus_jobs row. Filter only with documented enum or varchar codes. |
| `stage` | text | yes | Deal pipeline stage: qualification, discover, propose, negotiate, closed_won, closed_lost. |
| `attempts` | integer | yes | Value of attempts on crm.proposal_corpus_jobs (integer). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `max_attempts` | integer | yes | Value of max_attempts on crm.proposal_corpus_jobs (integer). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `last_error` | text | no | Value of last_error on crm.proposal_corpus_jobs (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `result_summary` | jsonb | no | Value of result_summary on crm.proposal_corpus_jobs (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `created_at` | timestamp without time zone | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamp without time zone | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |
| `completed_at` | timestamp without time zone | no | Timestamp on crm.proposal_corpus_jobs for the “completed” event. Null means that event has not happened. |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "cmugi0oat0006zurez3wdwx0z",
  "batch_id": "cmugi0mns0000zureohxsoc6r",
  "organization_id": "1003",
  "status": "pending_review",
  "stage": "pending_review",
  "attempts": 1,
  "max_attempts": 3,
  "last_error": null,
  "result_summary": {
    "source": "ai",
    "itemCount": 2,
    "pairCount": 1,
    "goldItemId": "cmugi0nrd0004zuremid6yk19",
    "playbookId": "cmugi38fg000czureou2o9g6b",
    "playbookIds": [
      "cmugi38fg000czureou2o9g6b"
    ]
  },
  "created_at": "2026-09-24T23:36:43.589Z",
  "updated_at": "2026-09-24T23:38:44.254Z",
  "completed_at": "2026-09-24T23:38:44.253Z"
}
```

### crm.proposal_corpus_pairs

This stores a matched pair of corpus texts used to compare proposal language. It joins corpus items. It is an analysis artefact, not a customer quote.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.proposal_corpus_pairs. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `batch_id` | text | yes | Identifier stored on crm.proposal_corpus_pairs. Join the table that owns this id. Do not treat it as a display label. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `requirement_item_id` | text | yes | Identifier stored on crm.proposal_corpus_pairs. Join the table that owns this id. Do not treat it as a display label. |
| `proposal_item_id` | text | yes | Identifier stored on crm.proposal_corpus_pairs. Join the table that owns this id. Do not treat it as a display label. |
| `confidence` | double precision | no | Value of confidence on crm.proposal_corpus_pairs (double precision). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `gaps_json` | jsonb | no | Value of gaps_json on crm.proposal_corpus_pairs (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `created_at` | timestamp without time zone | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamp without time zone | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |
| `pairing_source` | text | yes | Value of pairing_source on crm.proposal_corpus_pairs (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `is_visual_master` | boolean | yes | Value of is_visual_master on crm.proposal_corpus_pairs (boolean). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "cmugi10zs0008zurehokwr2rp",
  "batch_id": "cmugi0mns0000zureohxsoc6r",
  "organization_id": "1003",
  "requirement_item_id": "cmugi0n7u0002zuren1mr05e9",
  "proposal_item_id": "cmugi0nrd0004zuremid6yk19",
  "confidence": 0.92,
  "gaps_json": [],
  "created_at": "2026-09-24T23:37:00.040Z",
  "updated_at": "2026-09-24T23:37:00.040Z",
  "pairing_source": "user_explicit",
  "is_visual_master": true
}
```

### crm.proposal_playbooks

This is the active playbook the proposal agent follows for the tenant. It joins organization scope. Reports can show which playbook is active. Quote math stays on quotes.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.proposal_playbooks. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `source_batch_id` | text | no | Identifier stored on crm.proposal_playbooks. Join the table that owns this id. Do not treat it as a display label. |
| `name` | text | yes | Display name stored on crm.proposal_playbooks. |
| `tags_json` | jsonb | no | Value of tags_json on crm.proposal_playbooks (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `sections_json` | jsonb | yes | Value of sections_json on crm.proposal_playbooks (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `status` | ProposalPlaybookStatus | yes | Lifecycle status of this crm.proposal_playbooks row. Filter only with documented enum or varchar codes. |
| `approved_at` | timestamp without time zone | no | Timestamp on crm.proposal_playbooks for the “approved” event. Null means that event has not happened. |
| `approved_by_user_id` | bigint | no | Identifier stored on crm.proposal_playbooks. Join the table that owns this id. Do not treat it as a display label. |
| `created_at` | timestamp without time zone | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamp without time zone | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |
| `blueprint` | jsonb | no | Value of blueprint on crm.proposal_playbooks (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `assets` | jsonb | no | Value of assets on crm.proposal_playbooks (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `content_playbook_id` | text | no | Identifier stored on crm.proposal_playbooks. Join the table that owns this id. Do not treat it as a display label. |
| `section_library_json` | jsonb | no | Value of section_library_json on crm.proposal_playbooks (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "cmugi38fg000czureou2o9g6b",
  "organization_id": "1003",
  "source_batch_id": "cmugi0mns0000zureohxsoc6r",
  "name": "Worktual proposal pattern",
  "tags_json": "[json 1487 chars omitted]",
  "sections_json": "[json 5458 chars omitted]",
  "status": "approved",
  "approved_at": "2026-09-24T23:38:42.978Z",
  "approved_by_user_id": null,
  "created_at": "2026-09-24T23:38:42.987Z",
  "updated_at": "2026-09-24T23:38:42.987Z",
  "blueprint": "[json 23859 chars omitted]",
  "assets": "[json 45986 chars omitted]",
  "content_playbook_id": null,
  "section_library_json": "[json 3085 chars omitted]"
}
```

### crm.proposal_templates

This is a reusable proposal document template for the tenant. It stores layout and default sections, not a customer-specific proposal. Template-usage reports count how many proposals were created from each template.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.proposal_templates. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `name` | text | yes | Display name stored on crm.proposal_templates. |
| `code` | text | no | Value of code on crm.proposal_templates (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `kind` | ProposalTemplateKind | yes | Value of kind on crm.proposal_templates (ProposalTemplateKind). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `sections` | jsonb | yes | Value of sections on crm.proposal_templates (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `is_default` | boolean | yes | Value of is_default on crm.proposal_templates (boolean). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `created_at` | timestamp without time zone | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamp without time zone | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |
| `blueprint` | jsonb | no | Value of blueprint on crm.proposal_templates (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `assets` | jsonb | no | Value of assets on crm.proposal_templates (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "cmtemht2z001knx0uww5pi3x7",
  "organization_id": "1003",
  "name": "Standard proposal",
  "code": "STANDARD",
  "kind": "standard",
  "sections": "[json 4062 chars omitted]",
  "is_default": true,
  "created_at": "2026-08-29T11:26:46.715Z",
  "updated_at": "2026-08-29T11:26:46.715Z",
  "blueprint": "[json 2198 chars omitted]",
  "assets": []
}
```

### crm.proposals

This is a customer-specific proposal linked to a deal or company. It stores the document status and content used before or alongside a quote. Proposal pipeline reports join it to deals so a manager can see which opportunities have a proposal.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.proposals. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `deal_id` | text | yes | crm.deals.id this commercial or activity row belongs to. |
| `number` | text | yes | Value of number on crm.proposals (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `title` | text | yes | Value of title on crm.proposals (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `summary` | text | no | Value of summary on crm.proposals (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `version` | integer | yes | Value of version on crm.proposals (integer). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `status` | ProposalStatus | yes | Lifecycle status of this crm.proposals row. Filter only with documented enum or varchar codes. |
| `attachment_url` | text | no | Value of attachment_url on crm.proposals (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `shared_at` | timestamp without time zone | no | Timestamp on crm.proposals for the “shared” event. Null means that event has not happened. |
| `created_by_user_id` | bigint | no | accounts.setup_users.id of the creator. Can differ from the current owner. |
| `created_at` | timestamp without time zone | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamp without time zone | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |
| `template_id` | text | no | Identifier stored on crm.proposals. Join the table that owns this id. Do not treat it as a display label. |
| `sections` | jsonb | no | Value of sections on crm.proposals (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `customer_name` | text | no | Value of customer_name on crm.proposals (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `blueprint` | jsonb | no | Value of blueprint on crm.proposals (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `assets` | jsonb | no | Value of assets on crm.proposals (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `approved_by_user_id` | bigint | no | Identifier stored on crm.proposals. Join the table that owns this id. Do not treat it as a display label. |
| `approved_at` | timestamptz | no | Timestamp on crm.proposals for the “approved” event. Null means that event has not happened. |
| `approval_status` | varchar | yes | Value of approval_status on crm.proposals (varchar). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "cmu1j268p001b1aernc8z4xbn",
  "organization_id": "1003",
  "deal_id": "cmtlcopyi001p1a9vpooi9rs3",
  "number": "PROP-0013",
  "title": "Proposal for positron — AI Native Contact Centre (CCaaS)",
  "summary": "Positron Hospital is seeking a centralized patient engagement and enquiry automation platform. The solution requires an AI Voicebot (Lola) and Web Chatbot to handle routine enquiries in English and Hindi, a 3-seat Live Agent Dashboard for seamless human escalation with full conte…",
  "version": 1,
  "status": "draft",
  "attachment_url": null,
  "shared_at": null,
  "created_by_user_id": "1015",
  "created_at": "2026-09-14T12:09:20.473Z",
  "updated_at": "2026-09-14T12:09:21.822Z",
  "template_id": null,
  "sections": "[json 7546 chars omitted]",
  "customer_name": "positron",
  "blueprint": "[json 26904 chars omitted]",
  "assets": null,
  "approved_by_user_id": null,
  "approved_at": null,
  "approval_status": "drafting"
}
```

### crm.prospect_provider_cache

This caches a provider response so the same search is not billed twice. It is a cache. Lead counts must use imported contact_profiles, not cached provider rows.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.prospect_provider_cache. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `provider` | ResearchProvider | yes | Value of provider on crm.prospect_provider_cache (ResearchProvider). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `query_hash` | text | yes | Sensitive field on crm.prospect_provider_cache. Never select it in a report. Never project this column into a report result. |
| `payload` | jsonb | yes | Value of payload on crm.prospect_provider_cache (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `expires_at` | timestamp without time zone | yes | Timestamp on crm.prospect_provider_cache for the “expires” event. Null means that event has not happened. |
| `created_at` | timestamp without time zone | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamp without time zone | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |

No row was available to show a live example.

### crm.prospect_pull_candidates

This is one person returned by a prospect job before or during import. It joins prospect_pull_jobs. A report of candidates versus imported leads joins this table to contact_profiles and must not treat a skipped known contact as a new lead.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.prospect_pull_candidates. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `job_id` | text | yes | Identifier stored on crm.prospect_pull_candidates. Join the table that owns this id. Do not treat it as a display label. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `rank` | integer | no | Value of rank on crm.prospect_pull_candidates (integer). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `selected` | boolean | yes | Value of selected on crm.prospect_pull_candidates (boolean). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `first_name` | text | no | Value of first_name on crm.prospect_pull_candidates (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `last_name` | text | no | Value of last_name on crm.prospect_pull_candidates (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `email` | text | no | Value of email on crm.prospect_pull_candidates (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `phone` | text | no | Value of phone on crm.prospect_pull_candidates (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `title` | text | no | Value of title on crm.prospect_pull_candidates (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `company_name` | text | no | Value of company_name on crm.prospect_pull_candidates (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `company_domain` | text | no | Value of company_domain on crm.prospect_pull_candidates (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `linkedin_url` | text | no | Value of linkedin_url on crm.prospect_pull_candidates (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `industry` | text | no | Value of industry on crm.prospect_pull_candidates (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `employee_count` | integer | no | Value of employee_count on crm.prospect_pull_candidates (integer). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `city` | text | no | Value of city on crm.prospect_pull_candidates (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `country` | text | no | Value of country on crm.prospect_pull_candidates (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `technographics` | jsonb | no | Value of technographics on crm.prospect_pull_candidates (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `sources_found_in` | jsonb | yes | Value of sources_found_in on crm.prospect_pull_candidates (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `qualify_reasons` | jsonb | no | Value of qualify_reasons on crm.prospect_pull_candidates (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `qualify_score` | integer | no | Value of qualify_score on crm.prospect_pull_candidates (integer). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `provider_payload` | jsonb | no | Value of provider_payload on crm.prospect_pull_candidates (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `imported_contact_id` | text | no | Identifier stored on crm.prospect_pull_candidates. Join the table that owns this id. Do not treat it as a display label. |
| `created_at` | timestamp without time zone | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamp without time zone | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "ppc_1f8615d4cbe127d2d4b78a30",
  "job_id": "ppj_0c2ebbbaa7a8c4c7b5a1fc33",
  "organization_id": "1003",
  "rank": 1,
  "selected": true,
  "first_name": "Jameson",
  "last_name": "Ta",
  "email": null,
  "phone": null,
  "title": "Chief Executive Officer & General Manager",
  "company_name": "Lane Transit District",
  "company_domain": null,
  "linkedin_url": null,
  "industry": null,
  "employee_count": null,
  "city": null,
  "country": null,
  "technographics": null,
  "sources_found_in": [
    "zoominfo"
  ],
  "qualify_reasons": [
    "General ICP proximity"
  ],
  "qualify_score": 40,
  "provider_payload": {
    "zoominfoId": "7395978367",
    "contactAccuracyScore": 89
  },
  "imported_contact_id": null,
  "created_at": "2026-09-28T04:22:57.471Z",
  "updated_at": "2026-09-28T04:22:57.471Z"
}
```

### crm.prospect_pull_jobs

This is one prospect-search job, including the filters the user asked for and the job status. Prospect operations reports count jobs. People already in contacts are skipped by the product rule and should not be counted again as new leads.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.prospect_pull_jobs. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `requested_by_user_id` | bigint | yes | Identifier stored on crm.prospect_pull_jobs. Join the table that owns this id. Do not treat it as a display label. |
| `status` | ProspectPullStatus | yes | Lifecycle status of this crm.prospect_pull_jobs row. Filter only with documented enum or varchar codes. |
| `limit_n` | integer | yes | Value of limit_n on crm.prospect_pull_jobs (integer). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `sources_requested` | jsonb | yes | Value of sources_requested on crm.prospect_pull_jobs (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `sources_used` | jsonb | no | Value of sources_used on crm.prospect_pull_jobs (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `criteria` | jsonb | yes | Value of criteria on crm.prospect_pull_jobs (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `attempts` | integer | yes | Value of attempts on crm.prospect_pull_jobs (integer). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `max_attempts` | integer | yes | Value of max_attempts on crm.prospect_pull_jobs (integer). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `last_error` | text | no | Value of last_error on crm.prospect_pull_jobs (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `result_summary` | jsonb | no | Value of result_summary on crm.prospect_pull_jobs (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `created_at` | timestamp without time zone | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamp without time zone | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |
| `completed_at` | timestamp without time zone | no | Timestamp on crm.prospect_pull_jobs for the “completed” event. Null means that event has not happened. |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "ppj_bb4b0cef4e5578cbcf04f1c4",
  "organization_id": "1003",
  "requested_by_user_id": "1015",
  "status": "ready_for_review",
  "limit_n": 10,
  "sources_requested": [
    "zoominfo"
  ],
  "sources_used": [
    "zoominfo"
  ],
  "criteria": {
    "productFitHint": "actively searching for our products"
  },
  "attempts": 1,
  "max_attempts": 3,
  "last_error": null,
  "result_summary": {
    "sourcesUsed": [
      "zoominfo"
    ],
    "qualifySource": "heuristic",
    "candidateCount": 0,
    "providerErrors": []
  },
  "created_at": "2026-09-17T12:17:58.841Z",
  "updated_at": "2026-09-17T12:18:07.149Z",
  "completed_at": "2026-09-17T12:18:07.148Z"
}
```

### crm.quote_lines

This is one product, offer, or add-on row on a quote, with quantity, unit price, and line total. Product-mix and discount reports join quote_lines to quotes and to inventory.products. The quote header total should equal the sum of these lines.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.quote_lines. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `quote_id` | text | yes | Identifier stored on crm.quote_lines. Join the table that owns this id. Do not treat it as a display label. |
| `product_id` | text | no | inventory.products.id. Join products for name, sku, and billing type. |
| `name` | text | yes | Display name stored on crm.quote_lines. |
| `quantity` | numeric | yes | Value of quantity on crm.quote_lines (numeric). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `unit_price` | numeric | yes | Value of unit_price on crm.quote_lines (numeric). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `amount` | numeric | yes | Money amount on this crm.quote_lines row. Keep sums inside one currency. Null is 0 only when the KPI catalog says so. |
| `sort_order` | integer | yes | Value of sort_order on crm.quote_lines (integer). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `created_at` | timestamp without time zone | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamp without time zone | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "cmtsmshtn001i1aim6vycgj8c",
  "quote_id": "cmtsmshtn001g1aim4gqmbd0t",
  "product_id": "wt-product-crm",
  "name": "crm",
  "quantity": "1.00",
  "unit_price": "15000.00",
  "amount": "15000.00",
  "sort_order": 0,
  "created_at": "2026-09-08T06:43:51.802Z",
  "updated_at": "2026-09-08T06:43:51.802Z",
  "organization_id": "1003"
}
```

### crm.quote_templates

This is a reusable quote layout for the tenant. It does not hold a customer price. Quote-template reports only count usage. The money sits on quotes and quote lines.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.quote_templates. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `name` | text | yes | Display name stored on crm.quote_templates. |
| `code` | text | no | Value of code on crm.quote_templates (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `kind` | QuoteTemplateKind | yes | Value of kind on crm.quote_templates (QuoteTemplateKind). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `sections` | jsonb | yes | Value of sections on crm.quote_templates (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `is_default` | boolean | yes | Value of is_default on crm.quote_templates (boolean). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `created_at` | timestamp without time zone | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamp without time zone | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |
| `blueprint` | jsonb | no | Value of blueprint on crm.quote_templates (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `assets` | jsonb | no | Value of assets on crm.quote_templates (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "cmtemi92b001lnx0urtvff1pd",
  "organization_id": "1003",
  "name": "Standard quotation",
  "code": "STANDARD",
  "kind": "standard",
  "sections": "[json 1763 chars omitted]",
  "is_default": true,
  "created_at": "2026-08-29T11:27:07.427Z",
  "updated_at": "2026-08-29T11:27:07.427Z",
  "blueprint": "[json 2629 chars omitted]",
  "assets": []
}
```

### crm.quotes

This is a priced offer sent to a company. Status moves through draft, sent, accepted, declined, or expired. The B2B handoff to an order starts when a sent quote is accepted. Quote conversion and discount reports use this header plus its lines.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.quotes. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `deal_id` | text | yes | crm.deals.id this commercial or activity row belongs to. |
| `number` | text | yes | Value of number on crm.quotes (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `version` | integer | yes | Value of version on crm.quotes (integer). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `status` | QuoteStatus | yes | draft, sent, accepted, rejected, or void. |
| `currency` | text | yes | ISO currency code for money on this row. Never add two currencies together. |
| `subtotal` | numeric | yes | Value of subtotal on crm.quotes (numeric). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `discount_pct` | numeric | yes | Value of discount_pct on crm.quotes (numeric). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `total` | numeric | yes | Quote header total. Do not add this to line totals in the same sum. |
| `valid_until` | timestamp without time zone | no | Value of valid_until on crm.quotes (timestamp without time zone). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `notes` | text | no | Value of notes on crm.quotes (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `sent_at` | timestamp without time zone | no | Timestamp on crm.quotes for the “sent” event. Null means that event has not happened. |
| `accepted_at` | timestamp without time zone | no | Timestamp on crm.quotes for the “accepted” event. Null means that event has not happened. |
| `created_by_user_id` | bigint | no | accounts.setup_users.id of the creator. Can differ from the current owner. |
| `created_at` | timestamp without time zone | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamp without time zone | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |
| `proposal_id` | text | no | Identifier stored on crm.quotes. Join the table that owns this id. Do not treat it as a display label. |
| `template_id` | text | no | Identifier stored on crm.quotes. Join the table that owns this id. Do not treat it as a display label. |
| `document_sections` | jsonb | no | Value of document_sections on crm.quotes (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `customer_name` | text | no | Value of customer_name on crm.quotes (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `company_name` | text | no | Value of company_name on crm.quotes (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `vendor_name` | text | no | Value of vendor_name on crm.quotes (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `blueprint` | jsonb | no | Value of blueprint on crm.quotes (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `assets` | jsonb | no | Value of assets on crm.quotes (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `approved_by_user_id` | bigint | no | Identifier stored on crm.quotes. Join the table that owns this id. Do not treat it as a display label. |
| `approved_at` | timestamptz | no | Timestamp on crm.quotes for the “approved” event. Null means that event has not happened. |
| `approval_status` | varchar | yes | Value of approval_status on crm.quotes (varchar). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `approval_note` | text | no | Value of approval_note on crm.quotes (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `renewal_contract_id` | text | no | Identifier stored on crm.quotes. Join the table that owns this id. Do not treat it as a display label. |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "cmtsmshtn001g1aim4gqmbd0t",
  "organization_id": "1003",
  "deal_id": "cmtsms61u00111aimq9lsb7aw",
  "number": "Q-00001",
  "version": 1,
  "status": "draft",
  "currency": "USD",
  "subtotal": "15000.00",
  "discount_pct": "0.00",
  "total": "15000.00",
  "valid_until": null,
  "notes": "Draft from post-meeting agent — catalog pricing applied; review before sending.",
  "sent_at": null,
  "accepted_at": null,
  "created_by_user_id": "1015",
  "created_at": "2026-09-08T06:43:51.802Z",
  "updated_at": "2026-09-08T06:50:47.081Z",
  "proposal_id": "cmtsmsc4n00181aimptz7q0wm",
  "template_id": "cmtemi92b001lnx0urtvff1pd",
  "document_sections": "[json 1700 chars omitted]",
  "customer_name": "Mohamed Fazil",
  "company_name": "Mohamed Fazil (account)",
  "vendor_name": "Worktual",
  "blueprint": "[json 2629 chars omitted]",
  "assets": [],
  "approved_by_user_id": null,
  "approved_at": null,
  "approval_status": "pending_approval",
  "approval_note": null,
  "renewal_contract_id": null
}
```

### crm.report_snapshots

This stores a saved result of a report so the same numbers can be shown again without re-querying. The SQL executor may write a snapshot only when the product asks to save a report. Live answers should still be calculated from the source tables.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.report_snapshots. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `kind` | text | yes | Value of kind on crm.report_snapshots (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `payload` | jsonb | yes | Value of payload on crm.report_snapshots (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `generated_at` | timestamp without time zone | yes | Timestamp on crm.report_snapshots for the “generated” event. Null means that event has not happened. |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "cmtefkyuq0003nr0vcr557rua",
  "organization_id": "1003",
  "kind": "funnel",
  "payload": {
    "wonCount": 0,
    "lostCount": 0,
    "generatedAt": "2026-08-29T13:43:16.849Z",
    "lostReasons": {},
    "quoteCounts": {},
    "dealsByStage": {
      "qualification": 1
    },
    "invoiceCounts": {},
    "leadsByStatus": {}
  },
  "generated_at": "2026-08-29T08:13:16.850Z"
}
```

### crm.sales_orders

This is the confirmed order created from an accepted quote. It copies company, contact, deal, currency, and total, and receives a number such as SO-10042. Order reports join it to the quote it came from and to the invoice that finance drafts from it.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.sales_orders. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `deal_id` | text | no | crm.deals.id this commercial or activity row belongs to. |
| `quote_id` | text | no | Identifier stored on crm.sales_orders. Join the table that owns this id. Do not treat it as a display label. |
| `company_id` | text | no | crm.companies.id for the B2B account on this row. Join companies for the account name. |
| `number` | text | yes | Value of number on crm.sales_orders (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `status` | OrderStatus | yes | Lifecycle status of this crm.sales_orders row. Filter only with documented enum or varchar codes. |
| `currency` | text | yes | ISO currency code for money on this row. Never add two currencies together. |
| `total` | numeric | yes | Value of total on crm.sales_orders (numeric). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `confirmed_at` | timestamp without time zone | no | Timestamp on crm.sales_orders for the “confirmed” event. Null means that event has not happened. |
| `created_by_user_id` | bigint | no | accounts.setup_users.id of the creator. Can differ from the current owner. |
| `created_at` | timestamp without time zone | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamp without time zone | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |
| `contact_id` | text | no | CRM contact overlay id (crm.contact_profiles.id) when this row is tied to a person. |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "cmt30jssy000k1aqdlgjzzaga",
  "organization_id": "1000",
  "deal_id": "cmt2qekw0005w1a8msl7rcok0",
  "quote_id": "cmt2qfrix006s1a8m3tchnquz",
  "company_id": "cmst71o4n004i1ak40xdavdzn",
  "number": "SO-00001",
  "status": "confirmed",
  "currency": "USD",
  "total": "15000.00",
  "confirmed_at": "2026-08-21T08:27:00.175Z",
  "created_by_user_id": "1000",
  "created_at": "2026-08-21T08:27:00.177Z",
  "updated_at": "2026-08-21T08:27:00.177Z",
  "contact_id": "723c9f6a-4b90-4221-9411-3d17835144e0"
}
```

### crm.sales_user_assignment_profiles

This stores assignment attributes for one CRM user, such as skills or territories used by lead routing. Coverage and assignment-fairness reports join it to accounts.setup_users on user id so a metric can group leads by the rep profile rather than by the lead alone.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.sales_user_assignment_profiles. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `user_id` | bigint | yes | Identifier stored on crm.sales_user_assignment_profiles. Join the table that owns this id. Do not treat it as a display label. |
| `accepting_leads` | boolean | yes | Value of accepting_leads on crm.sales_user_assignment_profiles (boolean). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `max_open_deals` | integer | no | Value of max_open_deals on crm.sales_user_assignment_profiles (integer). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `seniority_tier` | SalesSeniorityTier | no | Value of seniority_tier on crm.sales_user_assignment_profiles (SalesSeniorityTier). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `on_pto_until` | date | no | Value of on_pto_until on crm.sales_user_assignment_profiles (date). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `country` | varchar | no | Value of country on crm.sales_user_assignment_profiles (varchar). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `created_at` | timestamp without time zone | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamp without time zone | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |

No row was available to show a live example.

### crm.seo_generated_content

This stores content the SEO flow generated for a project. Content-output reports count rows by project. It is not an email sent to a lead.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.seo_generated_content. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `user_id` | bigint | no | Identifier stored on crm.seo_generated_content. Join the table that owns this id. Do not treat it as a display label. |
| `project_id` | text | no | Identifier stored on crm.seo_generated_content. Join the table that owns this id. Do not treat it as a display label. |
| `content_type` | text | yes | Value of content_type on crm.seo_generated_content (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `title` | text | yes | Value of title on crm.seo_generated_content (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `slug` | text | no | Value of slug on crm.seo_generated_content (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `seo_score` | integer | no | Value of seo_score on crm.seo_generated_content (integer). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `body` | jsonb | yes | Value of body on crm.seo_generated_content (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `created_at` | timestamptz | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamptz | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |
| `status` | text | yes | Lifecycle status of this crm.seo_generated_content row. Filter only with documented enum or varchar codes. |
| `campaign_id` | text | no | Identifier stored on crm.seo_generated_content. Join the table that owns this id. Do not treat it as a display label. |
| `primary_keyword` | text | no | Value of primary_keyword on crm.seo_generated_content (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `keyword_query_id` | text | no | Identifier stored on crm.seo_generated_content. Join the table that owns this id. Do not treat it as a display label. |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "seoc_69c37bc3105f431c",
  "organization_id": "1003",
  "user_id": "1015",
  "project_id": "29951981",
  "content_type": "blog",
  "title": "The Future of Communication: How Voice Bots are Transforming Modern Business",
  "slug": "voice-bots-for-business-transformation",
  "seo_score": 92,
  "body": "[json 3781 chars omitted]",
  "created_at": "2026-09-07T18:02:52.602Z",
  "updated_at": "2026-09-07T18:02:52.602Z",
  "status": "draft",
  "campaign_id": null,
  "primary_keyword": null,
  "keyword_query_id": null
}
```

### crm.seo_keyword_queries

This stores a keyword query run for an SEO project, including the phrase asked. Keyword reports group these queries. Search volume is only a provider number when the snapshot says so.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.seo_keyword_queries. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `user_id` | bigint | no | Identifier stored on crm.seo_keyword_queries. Join the table that owns this id. Do not treat it as a display label. |
| `seed` | text | yes | Value of seed on crm.seo_keyword_queries (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `location` | text | yes | Value of location on crm.seo_keyword_queries (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `language` | text | yes | Value of language on crm.seo_keyword_queries (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `filters` | jsonb | yes | Value of filters on crm.seo_keyword_queries (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `cache_key` | text | yes | Value of cache_key on crm.seo_keyword_queries (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `semrush_called_at` | timestamptz | no | Timestamp on crm.seo_keyword_queries for the “semrush called” event. Null means that event has not happened. |
| `expires_at` | timestamptz | yes | Timestamp on crm.seo_keyword_queries for the “expires” event. Null means that event has not happened. |
| `payload` | jsonb | yes | Value of payload on crm.seo_keyword_queries (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `error` | text | no | Value of error on crm.seo_keyword_queries (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `budget_skipped` | boolean | yes | Value of budget_skipped on crm.seo_keyword_queries (boolean). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `created_at` | timestamptz | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamptz | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "seokq_639f43d44fde38a2c56bcb41",
  "organization_id": "1003",
  "user_id": "1015",
  "seed": "salesforce CRM vs Worktual Crm",
  "location": "us",
  "language": "en",
  "filters": {
    "source": "llm"
  },
  "cache_key": "fc8c322b51dfa7d962665b5865fe0b59bc4b99ed9736eefdc4e6a2ea7bafaae9",
  "semrush_called_at": null,
  "expires_at": "2026-10-03T10:57:28.826Z",
  "payload": "[json 2656 chars omitted]",
  "error": null,
  "budget_skipped": false,
  "created_at": "2026-09-26T10:57:35.629Z",
  "updated_at": "2026-09-26T10:57:35.629Z"
}
```

### crm.seo_projects

This is an SEO project record kept beside CRM for a tenant site or campaign. SEO reports count projects and join snapshots. It is not a sales deal and must not be added into pipeline.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.seo_projects. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `external_project_id` | text | yes | Identifier stored on crm.seo_projects. Join the table that owns this id. Do not treat it as a display label. |
| `domain` | text | no | Value of domain on crm.seo_projects (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `market` | text | no | Value of market on crm.seo_projects (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `raw` | jsonb | no | Value of raw on crm.seo_projects (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `synced_at` | timestamptz | yes | Timestamp on crm.seo_projects for the “synced” event. Null means that event has not happened. |
| `created_at` | timestamptz | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamptz | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "seop_4bea631dcbc043163916a061",
  "organization_id": "1003",
  "external_project_id": "17788577",
  "domain": "worktual.co.uk",
  "market": "uk",
  "raw": {
    "url": "worktual.co.uk",
    "tools": [
      {
        "tool": "siteaudit"
      },
      {
        "tool": "gat"
      },
      {
        "tool": "tracking"
      },
      {
        "tool": "backlinkAudit"
      },
      {
        "tool": "seoideas"
      },
      {
        "tool": "linkBuilding"
      }
    ],
    "owner_id": 1850129,
    "permission": [
      "OWNER"
    ],
    "project_id": 17788577,
    "project_name": "Worktual - UK",
    "domain_unicode": "worktual.co.uk"
  },
  "synced_at": "2026-09-04T16:58:45.435Z",
  "created_at": "2026-09-04T16:52:43.548Z",
  "updated_at": "2026-09-04T16:58:45.435Z"
}
```

### crm.seo_saved_keywords

This is a keyword the user chose to keep for a project. Saved-keyword reports list these rows. They join seo_projects and are not CRM lead tags.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.seo_saved_keywords. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `query_id` | text | yes | Identifier stored on crm.seo_saved_keywords. Join the table that owns this id. Do not treat it as a display label. |
| `term` | text | yes | Value of term on crm.seo_saved_keywords (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `metrics` | jsonb | yes | Value of metrics on crm.seo_saved_keywords (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `content_id` | text | no | Identifier stored on crm.seo_saved_keywords. Join the table that owns this id. Do not treat it as a display label. |
| `created_at` | timestamptz | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamptz | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "seosk_b9175574d22f9b9d0dfda54f",
  "organization_id": "1003",
  "query_id": "seokq_bf497b5576f268850f1357a6",
  "term": "cognitive cdp",
  "metrics": {
    "kd": 18,
    "cpc": 4.2,
    "term": "cognitive cdp",
    "intent": "commercial",
    "source": "llm_estimate",
    "volume": 170,
    "competition": 0.35,
    "opportunity": 78
  },
  "content_id": null,
  "created_at": "2026-09-15T07:04:20.905Z",
  "updated_at": "2026-09-15T07:04:39.916Z"
}
```

### crm.seo_social_posts

This stores a social post draft or record created from the SEO flow. Social-output reports count posts by project and status. It does not mean the post was published on LinkedIn unless status says so.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.seo_social_posts. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `user_id` | bigint | no | Identifier stored on crm.seo_social_posts. Join the table that owns this id. Do not treat it as a display label. |
| `content_id` | text | no | Identifier stored on crm.seo_social_posts. Join the table that owns this id. Do not treat it as a display label. |
| `platform` | text | yes | Value of platform on crm.seo_social_posts (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `post_type` | text | yes | Value of post_type on crm.seo_social_posts (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `copy` | jsonb | yes | Value of copy on crm.seo_social_posts (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `status` | text | yes | Lifecycle status of this crm.seo_social_posts row. Filter only with documented enum or varchar codes. |
| `scheduled_at` | timestamptz | no | Timestamp on crm.seo_social_posts for the “scheduled” event. Null means that event has not happened. |
| `published_at` | timestamptz | no | Timestamp on crm.seo_social_posts for the “published” event. Null means that event has not happened. |
| `external_post_id` | text | no | Identifier stored on crm.seo_social_posts. Join the table that owns this id. Do not treat it as a display label. |
| `last_error` | text | no | Value of last_error on crm.seo_social_posts (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `accounts_connection_id` | text | no | Identifier stored on crm.seo_social_posts. Join the table that owns this id. Do not treat it as a display label. |
| `created_at` | timestamptz | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamptz | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "seosp_9403cf6d90af4994",
  "organization_id": "1003",
  "user_id": "1015",
  "content_id": "seoc_23d686dfd2c44e78",
  "platform": "linkedin",
  "post_type": "feed",
  "copy": "[json 884870 chars omitted]",
  "status": "draft",
  "scheduled_at": null,
  "published_at": null,
  "external_post_id": null,
  "last_error": null,
  "accounts_connection_id": null,
  "created_at": "2026-09-11T06:31:24.213Z",
  "updated_at": "2026-09-11T06:31:24.213Z"
}
```

### crm.seo_tool_snapshots

This stores a point-in-time SEO tool result for a project. Trend reports order these by time and join seo_projects. Estimates are not Semrush results unless the Semrush source is actually configured.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.seo_tool_snapshots. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |
| `external_project_id` | text | yes | Identifier stored on crm.seo_tool_snapshots. Join the table that owns this id. Do not treat it as a display label. |
| `tool_name` | text | yes | Value of tool_name on crm.seo_tool_snapshots (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `payload` | jsonb | no | Value of payload on crm.seo_tool_snapshots (jsonb). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `error` | text | no | Value of error on crm.seo_tool_snapshots (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `fetched_at` | timestamptz | yes | Timestamp on crm.seo_tool_snapshots for the “fetched” event. Null means that event has not happened. |
| `created_at` | timestamptz | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamptz | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "seos_981750758098846c4f8db560",
  "organization_id": "1003",
  "external_project_id": "_org_",
  "tool_name": "backlinks_research",
  "payload": "[json 2558 chars omitted]",
  "error": "tool_call: execute_report: parameter 'target' is required; parameter 'target_type' is required",
  "fetched_at": "2026-09-04T17:03:04.155Z",
  "created_at": "2026-09-04T16:48:15.472Z",
  "updated_at": "2026-09-04T17:03:04.155Z"
}
```

### crm.user_integration_connections

This stores one user's connected mailbox or calendar credentials for Gmail, Outlook, or Google Calendar. The reports agent should not read token columns. It may count whether a user has connected mail or calendar, and only inside the same organization.

Columns below are the live `information_schema` list for this table.

| Column | Type | Required | What this column is for |
| --- | --- | --- | --- |
| `id` | text | yes | Primary key of crm.user_integration_connections. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document. |
| `user_id` | bigint | yes | Identifier stored on crm.user_integration_connections. Join the table that owns this id. Do not treat it as a display label. |
| `provider` | IntegrationProvider | yes | Value of provider on crm.user_integration_connections (IntegrationProvider). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `account_email` | text | no | Value of account_email on crm.user_integration_connections (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `access_token` | text | yes | Sensitive field on crm.user_integration_connections. Never select it in a report. Never project this column into a report result. |
| `refresh_token` | text | no | Sensitive field on crm.user_integration_connections. Never select it in a report. Never project this column into a report result. |
| `token_expires_at` | timestamp without time zone | no | Timestamp on crm.user_integration_connections for the “token expires” event. Null means that event has not happened. Never project this column into a report result. |
| `scope` | text | no | Value of scope on crm.user_integration_connections (text). Use it only for the fact this table stores — not as a substitute for a missing official metric column. |
| `created_at` | timestamp without time zone | yes | When this row was inserted. Use for “created this week/month”. It does not move on later edits. |
| `updated_at` | timestamp without time zone | yes | When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events). |
| `organization_id` | bigint | yes | Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first. |

Live example (Worktual org `1003` when the table has `organization_id`; otherwise the first matching row). Secrets are redacted.

```json
{
  "id": "cmuhznxg900b5mo0u0p98aqmc",
  "user_id": "1018",
  "provider": "google",
  "account_email": "divyaprasathd@gmail.com",
  "access_token": null,
  "refresh_token": null,
  "token_expires_at": null,
  "scope": "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/meetings.conference.media.readonly https://www.googleapis.com/auth/meetings.space.readonly https://www.googleapis.com/auth/calendar.readonly https://www.goog…",
  "created_at": "2026-09-26T00:38:28.185Z",
  "updated_at": "2026-09-29T08:53:48.375Z",
  "organization_id": "1003"
}
```


## Enumerations

Allowed values are listed as `schema.table.column` — (value, value). A filter that uses any other spelling will not match rows. Prisma enums live in the `crm` type namespace even when the column is on `inventory.products`.

### Prisma enum columns

- `crm.agent_step_events.status` — (started, ok, failed, skipped)
- `crm.appointments.provider` — (google_meet, zoom, teams, other)
- `crm.appointments.source` — (crm_ui, ccaas_webchat, demo_agent)
- `crm.appointments.status` — (scheduled, canceled, completed, no_show)
- `crm.audit_logs.action` — (create, update, delete, stage_change, assign, convert, merge, quote_sent, quote_accepted, order_created, invoice_created)
- `crm.calendar_meet_captures.status` — (pending, dispatched, cancelled, failed)
- `crm.companies.channel_role` — (standard, franchise, owned_store, brand_hq)
- `crm.company_locations.type` — (hq, branch)
- `crm.contact_activities.email_direction` — (outbound, inbound)
- `crm.contact_activities.folder` — (inbox, sent, draft, trash)
- `crm.contact_activities.mail_provider` — (google, microsoft)
- `crm.contact_activities.task_status` — (open, in_progress, completed)
- `crm.contact_activities.type` — (call, meeting, email, sms, note, task)
- `crm.contract_billing_schedules.billing_kind` — (standard, setup, subscription_start, renewal, amendment, adjustment, credit)
- `crm.contract_billing_schedules.status` — (scheduled, generated, cancelled)
- `crm.contracts.billing_frequency` — (monthly, quarterly, annual)
- `crm.contracts.status` — (active, expired, cancelled)
- `crm.deal_activities.type` — (call, meeting, email, sms, note, task)
- `crm.deals.stage` — (qualification, discover, propose, negotiate, closed_won, closed_lost)
- `crm.email_auto_reply_jobs.status` — (pending, analyzing, replied, awaiting_demo, escalated, skipped, failed)
- `crm.gmail_push_watches.watch_kind` — (user, crm_bot)
- `crm.invoice_lines.kind` — (product, addon)
- `crm.invoice_templates.kind` — (standard)
- `crm.invoices.billing_kind` — (standard, setup, subscription_start, renewal, amendment, adjustment, credit)
- `crm.invoices.payment_method` — (offline, manual, stripe, razorpay)
- `crm.invoices.payment_provider` — (stripe, razorpay)
- `crm.invoices.payment_session_status` — (active, expired, paid, cancelled)
- `crm.invoices.status` — (draft, sent, paid, void, overdue)
- `crm.lead_enrichment_jobs.status` — (pending, running, enriched, skipped, failed)
- `crm.lead_lifecycle_jobs.status` — (pending, analyzing, applied, waited, skipped, failed)
- `crm.lead_nurture_jobs.status` — (pending, analyzing, sent, waited, skipped, failed)
- `crm.lead_scoring_jobs.status` — (pending, scoring, scored, failed)
- `crm.meeting_assist_sessions.provider` — (google_meet, zoom, teams, other)
- `crm.meeting_assist_sessions.status` — (active, ended, failed)
- `crm.org_research_provider_configs.provider` — (apollo, zoominfo, lusha, builtwith)
- `crm.organization_profiles.vertical` — (general, ecommerce, healthcare, finance, telecom)
- `crm.payment_gateway_events.provider` — (stripe, razorpay)
- `crm.price_book_entries.billing_frequency` — (monthly, quarterly, annual)
- `crm.process_confirmations.status` — (pending, approved, rejected, expired)
- `crm.product_addons.meter_key` — (seat, minute, session, email, agent, flat, custom)
- `crm.product_addons.pricing_model` — (flat, per_unit, stepped, tiered)
- `crm.product_offers.billing_frequency` — (monthly, quarterly, annual)
- `crm.product_offers.billing_type` — (one_time, recurring)
- `crm.product_offers.meter_key` — (seat, minute, session, email, agent, flat, custom)
- `crm.product_offers.status` — (draft, active, archived)
- `crm.proposal_corpus_batches.status` — (uploading, processing, pending_review, failed, completed)
- `crm.proposal_corpus_items.kind` — (requirement, proposal)
- `crm.proposal_corpus_items.status` — (pending, ingested, structured, failed)
- `crm.proposal_corpus_jobs.status` — (pending, ingesting, structuring, pairing, synthesizing, pending_review, failed, cancelled)
- `crm.proposal_playbooks.status` — (draft, pending_review, approved, rejected)
- `crm.proposal_templates.kind` — (standard)
- `crm.proposals.status` — (draft, shared, accepted, declined)
- `crm.prospect_provider_cache.provider` — (apollo, zoominfo, lusha, builtwith)
- `crm.prospect_pull_jobs.status` — (pending, searching, qualifying, personnel, ready_for_review, importing, imported, failed, cancelled)
- `crm.quote_templates.kind` — (standard)
- `crm.quotes.status` — (draft, sent, accepted, rejected, void)
- `crm.sales_orders.status` — (draft, confirmed, fulfilled, cancelled)
- `crm.sales_user_assignment_profiles.seniority_tier` — (junior, mid, senior)
- `crm.user_integration_connections.provider` — (google, microsoft, zoom, yahoo)
- `inventory.products.billing_frequency` — (monthly, quarterly, annual)
- `inventory.products.billing_type` — (one_time, recurring)
- `inventory.products.product_type` — (fixed, customizable)
- `inventory.products.status` — (draft, active, archived)
- `inventory.products.unit_of_measure` — (per_seat, per_agent, per_ticket, flat)

### Varchar / text codes CRM writes

These are not Prisma enums. Use only the codes below.

- `accounts.organizations.business_type` — (b2b, b2c, b2b2c). Case in the row may be B2B. Empty string means unset. B2C must not see finance metrics.
- `accounts.setup_users.status` — (active). CRM only assigns work to active users. Other Accounts statuses may exist; do not invent them.
- `accounts.setup_user_product_access.product_id` — (crm). CRM reads only product_id = crm. Other Worktual products have their own grants.
- `accounts.auth_sessions.product_id` — (crm). CRM login sessions use product_id = crm.
- `cdp.customer_profile.contact_type` — (contact, lead, prospect, customer, churned). CDP person class. Not a deal stage. converted CRM leads align to customer or churned.
- `cdp.identity_keys.key_type` — (email, phone, email_secondary, phone_secondary). Values CRM writes. Other systems may also write cdp_id or similar. Do not invent types in SQL.
- `crm.contact_profiles.lead_status` — (new, contacted, qualifying, qualified, disqualified, converted). Sales lead pipeline on the CRM overlay.
- `crm.contact_profiles.crm_status` — (active, inactive, archived). Soft state of the overlay. Current-contact reports filter crm_status = active.
- `crm.organization_profiles.internal_domains_mode` — (derived, manual, needs_manual). How internal email domains were set for meeting routing.
- `crm.contact_profiles.assignment_followup_stage` — (owner_notified, owner_reminded, manager_notified, admin_notified, acted). Assignment follow-up ladder. Null until assignment starts.
- `crm.proposals.approval_status` — (drafting, pending_approval, pending_finance_approval, finance_rejected, sent). Human / finance gate on the proposal document. Separate from proposals.status.
- `crm.quotes.approval_status` — (drafting, pending_approval, pending_finance_approval, finance_rejected, sent). Finance discount gate on the quote. Separate from quotes.status.
- `crm.invoices.approval_status` — (drafting, pending_approval, finance_rejected). Finance approval before send. pending_approval means waiting on finance.

`crm.contact_profiles.disqualify_reason` and `crm.contact_profiles.assignment_reason` are free short codes written by jobs. Group by the stored value. Do not invent a closed list.

