# Campaign users, roles, modules, and metric scope

**Audience:** product, ops, and anyone who needs to know who can open which Campaign screens and whose numbers they see.

This is how **Campaign management** works today. Roles come from Accounts. Campaign does **not** implement a separate permission matrix per job title (CMO, analyst, “agent”). It applies **two data scopes** from the role **name**.

---

## How a Campaign user is created

1. The person exists in `accounts.setup_users` with `status = active` and a home `organization_id`.
2. They have a row in `accounts.setup_user_product_access` for `product_id = campaign`, pointing at `accounts.setup_roles`.
3. Login also requires an **active** Campaign entitlement: `campaign.organization_products` with `product_code = campaign` and `status = active` for their org/branch.
4. Campaign copies `setup_roles.name` onto the session as `session.role`. If the user has several roles, login **prefers** a role whose name is `admin` (case-insensitive). If no role row is found, the session role defaults to `user`.

Campaign never stores its own users table. `campaigns.created_by_user_id` is `accounts.setup_users.id`.

---

## Roles Campaign actually uses

Accounts may store any `setup_roles.name` (`admin`, `marketing`, `user`, `agent`, and so on). **Campaign only inspects whether that name is `admin`.**

| Campaign treatment | Role name on the session | Meaning in this product |
|--------------------|--------------------------|-------------------------|
| **Admin** | `admin` (any casing) | Branch-wide campaign lists and KPIs inside the signed-in **organization + branch**. Can call sending-configuration APIs. |
| **Non-admin (operator)** | Every other name, including `user`, `marketing`, `agent`, empty → treated as `user` | **My campaigns only.** Lists, Dashboard, monitor, calendar, analytics ask, and live/failure feeds filter `campaigns.created_by_user_id = session.id`. |

There is **no** extra Campaign role named “agent.” If Accounts assigns `agent`, that person is a non-admin operator: they see only campaigns they created.

Admins do **not** see other organizations, and campaign rows are still limited to **their branch** (`organization_id` + `branch_id`). “See everything” means all campaigns in that workspace, not the whole company.

Code: `backend/src/helpers/campaign-visibility.ts` (`org` vs `mine`), `isAdminRole()` in `backend/src/helpers/config-channels.ts`.

---

## Modules in Campaign management

Module ids live in `frontend/src/config/modules.ts`. Sidebar items come from `modulesForSession(role, industryPack)`. Some modules exist as **routes** even when they are hidden from the sidebar.

### Sidebar (typical)

| Module id | Label | Route | Who sees it in the sidebar | What it is for |
|-----------|-------|-------|----------------------------|----------------|
| `dashboard` | Dashboard | `/dashboard` | Admin and non-admin | Overview KPIs, delivery trend, campaign preview, ops feed, copilot chat (reports agent). Period filters use campaign launch date in campaign timezone. |
| `audience` | Audience | `/audience` | Admin and non-admin | People in CDP for this organization: list, search, create, preferences, campaign-activity on a person. Soft-delete is Campaign’s `custom_fields.campaign_deleted`. |
| `create_campaign` | Create campaign | `/campaigns/create` | Admin and non-admin | Chat workspace to name, pick audience, generate templates, schedule/launch. Also on-demand send, library run, WhatsApp approval workspaces under `/campaigns/create/…`. |
| `drafts` | Drafts | `/campaigns/create?tool=drafts` | Admin and non-admin | Saved create-campaign **chat sessions owned by this user**. Admins do not see other people’s drafts here. |

### Present in the product, hidden from the sidebar

| Module id | Label | Route | Who can use it | What it is for |
|-----------|-------|-------|----------------|----------------|
| `monitoring` | Campaign monitoring | `/campaigns`, `/campaigns/monitor/…` | Any logged-in Campaign user (route). Not in the sidebar (`hideFromSidebar`). | Live / scheduled / past / on-demand / personalised-CRM tabs, campaign detail (selected, sent, opens, clicks, A/B, audience), monitoring chat. |
| `events` | Events tracking | `/events` | Any logged-in Campaign user (route). Not in the sidebar. | Forms/events: draft vs launched, public `/f/:slug`, opens and submissions. List is **org-wide**, not “my events only.” |
| `configuration` | Configuration | `/configuration` | **Admin APIs** (`requireAdmin`). Flagged `adminOnly` in the module catalog. **UI is currently parked:** `CONFIGURATION_UI_HIDDEN = true` redirects `/configuration` to Dashboard. Channel setup is owned by Accounts. | Email/push/SMS sending setup in Campaign when the UI is re-enabled. Non-admins get 403 on admin configuration handlers. |

### Module ids in types / agents, not standalone sidebar items

| Module id | How it shows up | Use |
|-----------|-----------------|-----|
| `reports` | Dashboard copilot uses agent module `reports` | Natural-language questions about the **same scoped** campaign KPIs as Dashboard (LIST_MONITOR / analytics ask). Not a separate `/reports` page. |
| `calendar` | `/campaigns/calendar` (`CampaignCalendarPage`) | Calendar of campaigns in the user’s data scope (admin = branch, non-admin = own). |

Industry packs can hide extra module ids via `pack.modules.hide` (labels/descriptions can also be overridden). That is packaging, not a second RBAC system.

---

## Module access by role

| Module | Admin | Non-admin (`agent`, `marketing`, `user`, …) |
|--------|-------|-----------------------------------------------|
| Dashboard | Yes. KPIs = all campaigns in org+branch (minus PPC-only rules). | Yes. Same **formulas**, only **their** campaigns. |
| Audience | Yes. All non-deleted CDP people in the **organization**. | Yes. **Same org-wide contact directory.** Audience is not split by creator. |
| Create campaign | Yes. Drafts they create are theirs. | Yes. Same. |
| Drafts | **Own** sessions only (`created_by_user_id = me`). | Own sessions only. |
| Campaign monitoring | All campaigns in org+branch. Cannot open another org’s campaign. Non-owned campaigns in the branch are visible. | Only campaigns they created. Opening someone else’s campaign id should fail the tenant+creator filter. |
| Calendar | Branch campaigns. | Own campaigns. |
| Events tracking | All events in the org (`organization_id` only). | **Same org-wide event list** (not filtered by `created_by_user_id`). |
| Configuration UI | Hidden globally while `CONFIGURATION_UI_HIDDEN` is true. | Same redirect. |
| Configuration APIs | Allowed. | **403** “Only administrators can manage sending configuration.” |
| Reports copilot | Branch-wide answers; must not claim “my campaigns” for totals. | Answers are already filtered; speak as “your campaigns.” |
| Public form `/f/:slug` | No login. | No login. |

Create-campaign **agent sessions** and template edit sessions always require `created_by_user_id = session.id`, including for admins. Admins cannot resume another user’s draft chat by id.

---

## Data scope (the important filter)

```text
Always:
  campaigns.organization_id = session.organizationId
  campaigns.branch_id       = session.branchId

If session.role is admin:
  (no creator filter)     → scope_applied = org
  scope_label             = "All branch campaigns"

Otherwise:
  campaigns.created_by_user_id = session.id   → scope_applied = mine
  scope_label                 = "Your campaigns"
```

Dashboard, monitor lists, calendar list, portfolio activity series, live sends, recent failures, and `POST /api/analytics/ask` all use this filter, then run the **same** metric math on the remaining rows.

APIs return `scope_applied` and `scope_label` so the UI/chat can say whose numbers they are.

---

## How metrics differ by role

**Formulas do not change by role.** Unique open rate is still unique `opened_at` ÷ email delivered. Dashboard “Sent” is still a **count of campaigns** with ≥1 delivered message. See `docs/CAMPAIGN_DATABASE_METRICS.md`.

What changes is the **campaign set** that goes into those formulas.

| Metric (examples) | Admin calculation set | Non-admin calculation set |
|-------------------|----------------------|---------------------------|
| Campaigns ran | Ran campaigns in the branch in the period | Ran campaigns **they created** in the branch in the period |
| Dashboard Sent / Failed (campaign counts) | Branch campaigns with ≥1 delivery / ≥1 failure | Only among their campaigns |
| Open rate / click rate | Unique events ÷ delivered on **that branch set** | Unique events ÷ delivered on **their campaign set** |
| Delivered by channel / trend | Recipients joined to those campaigns | Recipients joined only to their campaigns |
| Monitor selected / sent / opens / clicks | One campaign, if they can load it (any branch campaign for admin) | Only if `created_by_user_id` is them |
| Contact open/click on a person | Still org CDP + send facts for that contact; campaign **history list** follows which campaigns the user can see when loaded via monitor APIs | Same contact directory; campaign chips/history follow **mine** when those APIs use campaign visibility |

### Exception: daily KPI email

The daily report email is **always** scoped to the **recipient user** (`created_by_user_id = that user`), including admins. An admin’s morning email is “your campaigns yesterday,” not the whole branch. In-app Dashboard for that same admin remains branch-wide.

### Exception: Audience and Events

- **Audience** queries `cdp.customer_profile` by `organization_id` (and not deleted). Role does not hide contacts created by someone else.
- **Events** list by `organization_id`. Role does not hide another user’s forms.

### Reports agent wording

- Non-admin: tools already filter; say “your campaigns.” “By me” is the same set.
- Admin: tools are branch-wide. Do **not** answer “my campaigns” with those totals. Per-employee breakdown is not supported.

---

## What both roles share (not split by creator)

| Surface | Scope |
|---------|--------|
| Tenant isolation | Always `organization_id`. Never another company. |
| Branch on campaigns | Always `branch_id` of the session. |
| CDP people | Whole org (minus Campaign soft-delete). |
| Opportunity events | Whole org. |
| Image gallery / library (org-scoped catalogs) | Tenant catalogs, not “my uploads only” unless a specific API filters `created_by_user_id`. |
| Login entitlement | Active `organization_products` campaign row. |

---

## Short map

```text
Accounts role name
    │
    ├─ admin  → data_scope = org  (all campaigns in this org + branch)
    │            configuration APIs allowed
    │            Dashboard / monitor / calendar / analytics use that set
    │            drafts still only own chat sessions
    │            daily email still only own campaigns
    │
    └─ anything else (including “agent”)  → data_scope = mine
                 campaigns.created_by_user_id = me
                 configuration APIs forbidden
                 Audience + Events still org-wide
```

---

## Related

| File | Use |
|------|-----|
| `docs/CAMPAIGN_DATABASE_METRICS.md` | Tables and KPI formulas (role-independent math) |
| `docs/CAMPAIGN_UI_METRICS.md` | What Dashboard / contact / monitor show |
| `backend/src/helpers/campaign-visibility.ts` | `org` vs `mine` |
| `frontend/src/config/modules.ts` | Module catalog and `adminOnly` |
| `accounts.setup_roles` / `setup_user_product_access` | Where the role name is stored |
