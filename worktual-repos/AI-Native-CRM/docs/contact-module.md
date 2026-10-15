# Contact Module — Functional & UI/UX Guide

Enterprise CRM contact (person) module: list, create, edit, detail, activities, dedupe/merge, lead conversion, and firmographic enrichment.

---

## 1. Purpose

Contacts are the person-level records of the CRM (leads, prospects, customers). They live in the **account database** and link to **companies / locations / deals / activities** in the CRM database. The module is gated by business type and role (see RBAC below).

**Tenancy / motion model:** shared tables for B2B, B2C, and B2B2C — see [`multi-tenancy-common-model.md`](multi-tenancy-common-model.md). Do not fork contact tables by business type or industry.

---

## 2. Routes & screens

| Route | Screen | Primary file |
|---|---|---|
| `/contact` | Contact list | `src/app/(app)/contact/page.tsx` |
| `/contact/new` | Create contact | `src/app/(app)/contact/new/page.tsx` |
| `/contact/[id]` | Contact detail | `src/app/(app)/contact/[id]/page.tsx` |
| `/contact/[id]/edit` | Edit contact | `src/app/(app)/contact/[id]/edit/page.tsx` |

Optional query params:

- List: `q`, `stage`, `leadStatus`, `status`, `page`
- New: `companyId`, `locationId` (prefill from company / location deep links)

Sidebar module key: `contact` (`backend/src/config/modules.ts` / `frontend/src/config/modules.ts`).

---

## 3. Data model (functional)

### 3.1 Dual database

| Data | Database | Access |
|---|---|---|
| Contact (person identity + company denorm) | `my_account_qa` (`ACCOUNT_DATABASE_URL`) | `accountRepository` / `account-pool` |
| Contact CRM profile (owner, lifecycle, company link, …) | `crm_qa.contact_profiles` | Prisma `ContactProfile` |
| Company, location, deals, activities, enrichment jobs | `crm_qa` (`DATABASE_URL`) | Prisma |

Bridge: `contact_profiles.account_contact_id` → `cdp.customer_profile.cdp_id` (text). Company/location FKs live on the profile (`company_id`, `location_id`). CDP profiles keep denormalized `company` / custom_fields for shared-product reads.

**Invariant:** Company detail card reads **Prisma Company** as source of truth (name, domain, industry, employees). Contact denormalized company fields are write-through projections.

### 3.2 Contact fields

**Person**

- Name: `firstName`, `lastName`
- Identity: `email` (unique), `phone`, secondary emails/phones
- Profile: `title`, `addressLine`, `city`, `country`
- Company link: `companyId`, `locationId` (+ denormalized company name/domain/industry)

**CRM**

- `lifecycleStage`: `lead` \| `prospect` \| `customer` \| `churned`
- `leadStatus`: `new` \| `contacted` \| `qualifying` \| `qualified` \| `disqualified` \| `converted`
- `leadSource`, `disqualifyReason`
- BANT: `bantBudget`, `bantAuthority`, `bantNeed`, `bantTimeline` (B2B / B2B2C UI)
- `ownerUserId`, `tags`, `status` (`active` \| `inactive` \| `archived`), `notes`
- `convertedDealId`, `isPinned`

Lifecycle invariant (`src/lib/contact-lifecycle.ts`): moving to `customer` / `churned` forces `leadStatus = converted`.

### 3.3 Company linking

On create/update (`resolveCompanyFields` in `contact-service.ts`):

1. If an existing `companyId` is selected → load company snapshot; sync denormalized fields.
2. If **Create new company** → ensure Prisma company (match by name or create) with submitted **domain** and **industry**, create HQ location when needed, set `crm_company_id`.
3. Clearing company clears link + denormalized fields.

Submitted domain/industry must land on the canonical Company row (not only on the contact projection), so the detail **Company details** card shows them.

---

## 4. Core workflows

### 4.1 Create contact

1. User opens `/contact/new` (or deep-linked with company/location).
2. Form validates required fields (name, email; company name if creating a new company).
3. **Duplicate gate** runs before save (heuristic match). User can merge or continue.
4. Server creates or **upserts** (strong email/phone duplicate → update primary + merge; no second active contact).
5. Ownership rules applied (see RBAC).
6. Business-type tag added (`b2b` / `b2c` / `b2b2c`).
7. If a **company name** exists → enrichment job enqueued immediately.
8. Redirect to `/contact/[id]`.

### 4.1b CSV import (hybrid)

Manual: Contacts list → **Import CSV** (choose file, paste, **Load sample**, or **Download sample**). Dry run then confirm.

Chat stays in chat: “import contacts from CSV” replies with instructions and a **CSV Instructions** link (`GET /api/contacts/import/sample` downloads the template). Never paste raw CSV into chat and never open the dialog. Attach a `.csv`, paste rows, or say **import this sample** — then `propose_import_contacts` runs the Fastify import. Email/phone duplicates are **skipped** (not merged); chat reports counts plus duplicate/failed rows with reasons. `propose_import_contacts` is `FORM_OWNED`; Fastify writes.

`POST /api/contacts/import` `{ csvText, dryRun? }` — max 500 rows. Each new row uses create-only (no upsert merge). Duplicate email or phone (org CRM) → skip. Lead pipeline enqueues after create. Default `leadSource = csv_import`.

Sample (B2B / B2B2C):

```csv
first_name,last_name,email,phone,title,company,company_domain,lifecycle_stage,lead_status,lead_source,status
Priya,Nair,priya.nair@acme.com,+91 98765 43210,VP Sales,Acme Corp,acme.com,lead,new,csv_import,active
```

B2C omits company columns. Aliases accept export headers (`Name`, `Email`, `Company`, `Stage`, `Lead status`).

### 4.2 Edit / delete

- Edit: full form; same company resolve/sync.
- Delete: confirmation; soft/active cleanup + related activity cleanup; orphan company prune when unused.

### 4.3 Duplicate detection & merge

**Match signals** (`src/lib/contacts/duplicate-match.ts`): exact/secondary email, exact/secondary phone, same name + company, same name + city, same name. Confidence scored with reasons.

| Path | Behavior |
|---|---|
| Create form gate | Suggest duplicates; user chooses merge or continue |
| Detail alert | Banner when likely duplicates exist |
| Auto on inbound/create | Strong match (email/phone, confidence ≥ 85) → fill blanks on primary + soft-archive losers |
| Manual merge wizard | Pick primary + field sources; reassign deals/activities; archive duplicates |

### 4.4 Lead conversion

- Shown when lifecycle is `lead` and lead status is not `converted` / `disqualified`.
- Hidden for B2C (no B2B deal path).
- Requires **Qualified** lead status (UX gate).
- Creates/links company + location + deal; sets contact to converted / prospect.

### 4.4b Lead Lifecycle Agent (autonomous)

The Lifecycle Agent is the single owner of three ladders and **writes** them
directly — manual edits still work and are never reverted.

| Ladder | Values | Field |
|---|---|---|
| Lead status | New → Contacted → Qualifying → Qualified → Disqualified / Converted | `contacts.lead_status` |
| Lifecycle stage | Lead → Prospect → Customer → Churned | `contacts.lifecycle_stage` |
| Sales pipeline | Qualify → Discover → Propose → Negotiate → Won / Lost | `deals.stage` |

**Pipeline:** job row in `lead_lifecycle_jobs` (one per org + contact), enqueued
by activities, inbox sync, scoring, nurture sends, and deal/quote changes; drained
by `/api/cron/lead-lifecycle`, which also sweeps open leads and live deals.

**Rules:** one step per run (event-driven, no apply cooldown), monotonic (never regresses a stage),
and every move goes through the same services the UI uses (`convertLeadToDeal`,
`createQuote` / `markQuoteSent` / `acceptQuote`, `updateDealStage`). Commercial
moves — sending or accepting a quote, closing won/lost, disqualifying — require an
explicit **customer-voiced** signal (inbound email, call, meeting, or transcript);
our own outbound copy never counts. When AI is configured it can veto a commercial
move but can never invent one. B2C stops at Qualified: no deal, quote, or finance.

**Ownership routing:** leads are pooled (unowned). Contact Owner is only
`contact_profiles.owner_user_id` — never the company owner. When score reaches
≥ 40 (or lifecycle converts a qualified lead) the system calls
`resolveRegionalSalesOwner` (`territory-assignment.ts`), which routes by
**business type** then **region**, balancing open-deal count. The chosen rep
becomes owner of **both** the deal and the contact; the assignment reason is
written to the timeline note. Territory may *prefer* an existing company
relationship when picking a rep after the gate — that is assignment preference,
not fake ownership of cold leads.

**Signals:** activity subjects/bodies today, plus `contact_activities.transcript_text`
and cached `transcript_insights` once a provider or manual upload attaches one
(`attachActivityTranscript`).

**UI:** `LeadLifecycleStatusBadge` on the contact page + a Lead lifecycle card on
the Agents dashboard; each move writes a timeline note and notifies admins.

### 4.5 Firmographic enrichment

**Triggers:**

1. **CRM create path** — after contact save when a company name is present (`onLeadCreated` → enqueue, often `processImmediately` for interactive creates).
2. **Primary external path: `cdp.customer_profile` INSERT** — Postgres `AFTER INSERT` trigger ensures a thin `crm.contact_profiles` overlay (if missing), upserts a **pending** `lead_enrichment_jobs` row, and `NOTIFY crm_lead_enrichment`. Covers MyAccount / campaign / Shopify / any CDP-only writer. Signal-only — never calls HTTP or the LLM.
3. **Secondary: `contact_profiles` INSERT** — same job upsert + NOTIFY (idempotent if CDP trigger already ran).
4. **Reconciler** — `POST /api/cron/lead-enrichment-reconcile` (and in-process sweep) finds recent CDP rows and CRM profiles missing a job row; creates thin overlays when needed.

**Bulk:** lakhs of CDP inserts → lakhs of cheap pending jobs immediately; CRM workers drain with bounded concurrency (`ENRICH_DRAIN_LIMIT`, `ENRICH_DRAIN_CONCURRENCY`). LISTEN wakes drain on notify (disable with `ENRICH_LISTEN_ENABLED=false`). Completion is paced; kickoff is immediate.

**Pipeline:**

1. Job row in `lead_enrichment_jobs` (idempotent per org + contact).
2. Prefer the LLM-backed Python agent pipeline (`ai-service`); fallback TypeScript
   DuckDuckGo + HTML parse remains an offline compatibility path.
3. **Fill blanks only** on Company (`domain`, `industry`, `employeeCount`), HQ location (`city`, `address`), Contact (`title` + company/location links).
4. Never overwrite user-populated fields.
5. Audit log with `source: lead_enrichment`.
6. Contact page listens via **SSE** (`/api/contacts/[id]/enrichment/events`) and refreshes once when the job finishes (no interval polling).

**UI:** `LeadEnrichmentStatusBadge` — pending / running / enriched / skipped / failed.

**Requirement:** person identity is written to `cdp.customer_profile` (+ `identity_keys`). The CDP enrich trigger creates the thin CRM overlay so list/detail work; writers do not need a separate CRM HTTP call for kickoff.

### 4.6 Activities & outreach

From detail / quick actions:

- Email (compose / connected send)
- Call (with confirm)
- Note, task, meeting, SMS
- Timeline merges contact activities + related deal activities

### 4.7 AI assist (separate from enrichment)

`AiAssistPanel` on detail: summary / next actions / drafts via OpenAI-compatible config. Heuristic fallback if no API key. **Does not** write firmographics.

---

## 5. RBAC & ownership

| Role | Contact access (typical) |
|---|---|
| admin / sales_manager | Org-wide; can assign owner |
| sales_rep / marketing | Own records (+ pool leads where applicable); can edit |
| finance | Org-wide read paths as configured; convert restricted |
| viewer | Read-only; no Configuration / limited mutations |

**Create ownership:**

- New **lead** contacts stay unowned (`null`) for all roles until score ≥ 40 or an explicit sales claim. Company/location owner is not copied onto the lead.
- Assigners creating non-lead → inherit location/company owner when available.
- Non-assigners creating non-lead → own what they create.

List and detail Owner show CRM contact owner only (not company owner). Unowned leads show as Unassigned / `—`.

---

## 6. Business-type gating

| Type | Contact UX notes |
|---|---|
| B2B | Company required path; BANT; convert lead → deal |
| B2C | Person-first; **no** company card / Finance; commerce orders |
| B2B2C | Company optional; prompt to link company when missing; sales + commerce |

Module intersection still applies via `backend/src/config/modules.ts`.

---

## 7. UI / UX

### 7.1 List (`/contact`)

**Composition:** filter bar + table (not a dashboard collage).

**Filters:** search, lifecycle stage, lead status, contact status (URL-synced).

**Columns (typical):** name (with pin), email, company (hidden on B2C), owner (admin), stage, updated.

**Interactions:**

- Row → detail
- Pin / unpin
- Infinite scroll / pagination
- Export
- Multi-select → merge wizard
- Empty state: clear “No contacts” + Create CTA

### 7.2 Create / edit form

**Sections (one job each):**

1. Person identity (name, email, phones, title, address)
2. Company (existing picker **or** new name + domain + industry + location)
3. CRM lifecycle / lead status / source / tags / status
4. BANT (when enabled)
5. Owner (assignable roles only; locked inherit for others)
6. Notes

**UX rules:**

- Duplicate gate before persist (no silent doubles).
- New company fields only when “Create new company” is selected.
- Prefill from company/location deep links.
- Validation errors inline; unique email surfaced clearly.
- After save → detail (create) or back to detail (edit).

### 7.3 Detail (`/contact/[id]`)

**First viewport hierarchy:**

1. Back link + name + lead-status pill
2. Enrichment status badge (if job exists)
3. Duplicate alert (if matches)
4. Primary actions: Convert (if eligible), View deals, New order (commerce), Edit, Delete
5. Quick actions: email / call / note / task / meeting / SMS

**Cards / sections:**

| Block | Content |
|---|---|
| Contact details | Email, phone, title, address, owner — clickable email/phone |
| Company details | Name, **domain**, industry, employees, owner, location (Prisma snapshot). Double-click card → company page. B2C shows “Consumer profile” instead. |
| CRM fields | Lifecycle, lead status, source, tags, BANT |
| Related deals / orders | When Sales / Commerce enabled |
| AI assist | Summaries / drafts |
| Activity timeline | Contact + deal activities; filters |

**Durable UX:**

- Confirm before delete and before call.
- Convert blocked until Qualified (explicit).
- Empty deals/orders captions with next-step hints.
- Deep links to company, location, deal, commerce.

### 7.4 Visual / interaction language

- Existing CRM design tokens (`text-primary`, `surface`, `border-default`, status pills).
- Lead-status pills use semantic tones (`contact-labels.ts`).
- Enrichment badge: amber (in progress), green (enriched), stone (skipped), red (failed).
- Prefer confirmations and backlinks over silent side effects.
- Enrichment refresh is **event-driven (SSE)**, not polling.

---

## 8. Key code map

| Area | Path |
|---|---|
| Pages | `frontend/src/pages/Contact*` |
| UI | `frontend/src/components/contacts/**` |
| Actions | `backend/src/service/contacts/contact-commands.ts` |
| CRUD / company resolve | `backend/src/dao/contacts/contact-service.ts` |
| Dedupe / merge | `backend/src/dao/contacts/contact-duplicate-service.ts`, `contact-merge-service.ts`, `inbound-lead-upsert.ts` |
| Company sync | `backend/src/dao/companies/sync-from-contacts.ts` |
| Enrichment | `backend/src/service/ai/lead-enrichment-*.ts` |
| Agent (Python) | `ai-service/app/agents/enrich_lead_agent.py` |
| Lifecycle helpers | `backend/src/lib/contact-lifecycle.ts` |
| Labels | `backend/src/lib/contact-labels.ts` |
| RBAC | `backend/src/service/auth/rbac.ts`, `ownership-scope.ts` |
| Modules matrix | `backend/src/config/modules.ts` |

---

## 9. Acceptance checklist (product)

- [ ] Create contact with new company name + domain + industry → Company details card shows domain/industry immediately.
- [ ] Strong duplicate email/phone → updates primary; no second active contact.
- [ ] Enrichment runs when company name present; badge updates; page refreshes once on completion.
- [ ] Enrichment never overwrites filled fields.
- [ ] B2C never shows company/finance contact paths.
- [ ] Sales rep only sees/edits own (and allowed pool) contacts.
- [ ] Convert lead requires Qualified and creates a deal (non-B2C).
- [ ] Delete and call actions require confirmation.

---

## 10. Out of scope / related

- Marketing MS owns campaigns; CRM receives leads via webhook (`/api/marketing/leads`) then same upsert + enrichment path.
- Finance invoices and B2B deal pipeline are separate modules; contact detail only deep-links into them.
- Analysis / LLM agents (own server model in env) are **not** part of contact enrichment today.
