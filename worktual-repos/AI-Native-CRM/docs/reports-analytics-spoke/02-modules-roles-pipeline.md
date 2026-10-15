# B2B modules, roles, and pipeline

This file is the access and pipeline reference for the reports domain agent. The SQL executor uses it to decide which rows a role may see. The knowledge-graph executor uses it to explain why a person sees one number and another person sees a different number.

The rules below are the ones enforced in `backend/src/config/modules.ts` and `backend/src/service/auth/ownership-scope.ts`. A report must not invent a Super Admin role or a permission the user can toggle per action. Those are not CRM roles.

## Business type

The tenant type lives on `accounts.organizations.business_type`. It is not a column on each deal.

| Value | Revenue path | Finance module |
| --- | --- | --- |
| `b2b` | Company and deal, then quote, then order, then invoice | Enabled |
| `b2c` | Contact, then Commerce orders | Never enabled |
| `b2b2c` | Both paths, shared contact and company ids | Enabled |

This spoke is the B2B reports agent. B2B queries include companies, deals, quotes, orders, invoices, and contracts. A B2C tenant must not be given finance metrics. Industry is `accounts.organizations.industry_type`. It selects a field pack. It is not a separate set of tables, and it must not change a lead score.

## Modules on a B2B tenant

These are the modules `MODULES_BY_BUSINESS_TYPE.b2b` enables. B2B does not enable Commerce. Communication is not in the B2B module list.

| Module | Route | What it is for |
| --- | --- | --- |
| Dashboard | `/dashboard` | Home numbers: pipeline, activity, and agent status. |
| Agents | `/agents` | Whether enrichment, scoring, summary, nurture, lifecycle, and assignment jobs are running. |
| Inbox | `/inbox` | Mail and other contact timeline items in inbox, sent, draft, or trash. |
| Contact | `/contact` | People. Name and email come from CDP. Owner and lead status come from `crm.contact_profiles`. |
| Company | `/company` | The B2B account. This is `crm.companies`, not a product-login account created after a win. |
| Marketing | `/marketing` | Campaign surface for marketing users. Campaigns are not the sales pipeline. |
| Sales | `/sales` | Opportunities, quotes, and the path to an order. |
| Activities | `/activities` | Tasks, calls, meetings, and emails the user must work. |
| Product | `/product` | The shared catalog in `inventory.products`, plus CRM offers, add-ons, and price books. |
| Finance | `/finance` | Invoices, approval, send, and payment. |
| Service | `/service` | A link to the Service product. Tickets are not stored in the CRM tables this spoke queries. |
| Reports | `/reports` | Present in the business-type list. Sidebar visibility is special and is described under Reports access. |
| Configuration | `/configuration/email` | Mail and calendar connection. Required for every role that has Inbox except viewer. |

## Roles

The CRM role is resolved from `accounts.setup_user_product_access` where `product_id` is `crm`, joined to `accounts.setup_roles.name`. Unknown names fall back to `sales_rep`. There is no CRM Super Admin.

| Role | Responsibility |
| --- | --- |
| `admin` | Runs the tenant. Can manage users, edit org settings, assign contact and deal owners, approve discounts, edit finance, and manage proposal and quote templates. Sees every record in the organization. |
| `sales_manager` | Runs the sales team. Sees every record in the organization. Can edit org settings, assign owners, approve discounts, and manage document templates. Does not manage users and does not edit finance settings the way an admin or finance user does. |
| `sales_rep` | Owns a book of contacts, companies, and deals. Creates and moves pipeline, logs activities, and sends quotes. Sees records they own, records they created, and companies in a franchise or store channel they own, including child companies. |
| `presales` | Same module list as a sales rep. Supports discovery, proposals, and meetings on the deals they own. Record visibility is owner-scoped, the same rule as a sales rep. Presales is not an org-wide role. |
| `marketing` | Runs campaigns and the marketing reports nav. Can see contacts and companies they own. Does not get Sales, Finance, Service, or Agents in the sidebar. |
| `finance` | Owns invoices: approve, send, and record payment. Sees records across the organization. Does not get Sales in the sidebar, but may open a deal from an invoice through a deep link. |
| `viewer` | Read-only. Same sales modules as a rep except Configuration, Agents, Finance, Marketing, Reports, and Service. Sees only their own records. Cannot connect a mailbox. |

`canViewAllRecords` is true only for `admin`, `sales_manager`, and `finance`. Everyone else is filtered to `owner_user_id` of the signed-in user. If the session user id is missing, the scope is the sentinel `0`, which matches nothing. A report must fail closed. It must not widen to the whole organization.

Channel scope adds companies, not a bypass of the tenant. When a non-org-wide user owns a company whose `channel_role` is `franchise`, `owned_store`, or `brand_hq`, they also see that company and its direct children. `standard` companies do not expand this way.

## Who can open which module

The sidebar is the intersection of the B2B module list and the role list. `admin` and `sales_manager` start from every B2B module. One extra rule then removes Reports for every role except `marketing`.

| Module | admin | sales_manager | sales_rep | presales | marketing | finance | viewer |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Dashboard | yes | yes | yes | yes | yes | yes | yes |
| Agents | yes | yes | no | no | no | no | no |
| Inbox | yes | yes | yes | yes | yes | yes | yes |
| Contact | yes | yes | yes | yes | yes | yes | yes |
| Company | yes | yes | yes | yes | yes | yes | yes |
| Marketing | yes | yes | no | no | yes | no | no |
| Sales | yes | yes | yes | yes | no | no | yes |
| Activities | yes | yes | yes | yes | yes | no | yes |
| Product | yes | yes | yes | yes | yes | no | yes |
| Finance | yes | yes | no | no | no | yes | no |
| Service | yes | yes | yes | yes | no | no | no |
| Reports sidebar | no | no | no | no | yes | no | no |
| Configuration | yes | yes | yes | yes | yes | yes | no |

Deep links open a route without putting it in the sidebar:

| Role | Extra route | Why |
| --- | --- | --- |
| finance | Sales | An invoice row must be able to open the deal it came from. |
| sales_rep, sales_manager, presales | Finance | An accepted quote must be able to open the invoice Finance is approving. |

`admin` already has both modules in the sidebar, so admin has no extra deep link.

## Reports access for this spoke

The marketing sidebar item labelled Reports is the campaign reports entry. It is not, by itself, permission to read every sales KPI. The new reports domain agent still has to enforce data rights:

- Pipeline, activity, and win-rate questions follow Sales access plus record scope. Admin and sales manager see the organization. Sales rep, presales, and viewer see their own book. Viewer is read-only.
- Invoice, collection, and contract questions follow Finance access. Admin and finance see the organization. A sales role may see the invoice reached from a quote they can already open.
- Campaign and SEO questions follow Marketing access and stay on marketing tables. They are not added into pipeline.
- Marketing does not receive org-wide deal amounts just because the Reports sidebar item is visible to them.
- Agents job counts are an admin and sales-manager operations view.

## Company types

`crm.companies.channel_role` says what kind of account the company is inside the tenant.

| Value | Meaning |
| --- | --- |
| `standard` | A normal customer or prospect account. No automatic child-company visibility. |
| `franchise` | A franchise account. The owner of this company can also see its child companies. |
| `owned_store` | A store the brand owns. Same child visibility as franchise. |
| `brand_hq` | The brand headquarters row. Same child visibility. Child rows point at it through `parent_company_id`. |

`parent_company_id` is the hierarchy. A store's parent is the brand. Reports that say "for this brand" include the parent and the companies whose parent is that id. Deleting a parent is restricted while children exist.

A company also has an owner (`owner_user_id`), a lifecycle status, and locations. A location is `hq` or `branch`. Deals require a company and a location.

## Contact and lead path

The person is `cdp.customer_profile`. The CRM state is `crm.contact_profiles`.

`lead_status` values the product writes:

| Value | Meaning |
| --- | --- |
| `new` | In the CRM and not yet worked into a later status. |
| `contacted` | The team has reached the person. |
| `qualified` | The person is a sales-ready lead. |
| `disqualified` | The person is out of the sales path. `disqualify_reason` stores the short reason code. |
| `converted` | The lead has a deal, or CDP `contact_type` is `customer` or `churned`. |

`crm_status` `active` means the CRM overlay is live. Contact lists and contact counts use `active` unless the question asks for removed overlays.

CDP `contact_type` is the shared person kind. The values this CRM branches on are `contact`, `customer`, and `churned`. Customer and churned are aligned to lead status `converted`. Other identity facts, including email and phone, live in `cdp.identity_keys` with `key_type` of `email`, `phone`, `email_secondary`, or `phone_secondary`.

BANT on the overlay is four independent flags: `bant_budget`, `bant_authority`, `bant_need`, `bant_timeline`. Each is true, false, or null. Null means not captured.

A converted lead points at `converted_deal_id`. That join is how a report walks from a person to the opportunity.

## Deal pipeline

`crm.deals.stage` is the current stage. The product does not store a stage-history table, a per-deal probability column, or a won-reason column.

| Stage | In open pipeline | Stage weight used as probability |
| --- | --- | --- |
| `qualification` | yes | 0.10 |
| `discover` | yes | 0.25 |
| `propose` | yes | 0.50 |
| `negotiate` | yes | 0.75 |
| `closed_won` | no | 1 |
| `closed_lost` | no | 0 |

Open pipeline is qualification, discover, propose, and negotiate. Won revenue uses `closed_won`. Lost revenue uses `closed_lost` and groups `lost_reason` when the question is why.

`expected_close_date` is the date the rep expects to close. `closed_at` is when it actually closed. `amount` null is treated as 0 in dashboard sums. `forecast_category` and the other forecast columns are an auditor overlay. They do not change stage or amount.

There is one pipeline. The product does not yet have multiple pipelines, a Demo stage, a POC stage, or a Pricing stage.

## Commercial path

B2B money moves in this order.

1. A proposal (`crm.proposals`) is optional. Status is `draft`, `shared`, `accepted`, or `declined`.
2. A quote (`crm.quotes`) is the priced offer. Status is `draft`, `sent`, `accepted`, `rejected`, or `void`. Only a sent quote can be accepted.
3. Accepting a quote creates a sales order (`crm.sales_orders`) with a number such as `SO-10042`. Order status is `draft`, `confirmed`, `fulfilled`, or `cancelled`. The accept path creates it as confirmed and copies the lines.
4. If the order has a company, a draft invoice is created for Finance. Invoice `status` is `draft`, `sent`, `paid`, `void`, or `overdue`. Invoice `approval_status` is a separate varchar. The finance path uses `drafting`, `pending_approval`, and `approved`. Customer send happens after finance approval, not at quote accept.
5. A contract (`crm.contracts`) is the term agreement. Status is `active`, `expired`, or `cancelled`. `arr` is the annual recurring amount stored on the contract. Billing rows live in `crm.contract_billing_schedules` with status `scheduled`, `generated`, or `cancelled`.

Payment method on an invoice is `offline`, `manual`, `stripe`, or `razorpay`. Billing kind is `standard`, `setup`, `subscription_start`, `renewal`, `amendment`, `adjustment`, or `credit`.

Product `billing_type` is `one_time` or `recurring`. That is catalog billing, not a repeating activity.

## Activity types

Deal and contact timelines use `call`, `meeting`, `email`, `sms`, `note`, and `task`. Task status on a contact activity is `open`, `in_progress`, or `completed`. Overdue is derived from the due date. It is not a stored status. Inbox folder is `inbox`, `sent`, `draft`, or `trash`. Email direction is `outbound` or `inbound`.

A scheduled calendar item is `crm.appointments`. A logged timeline row is `crm.deal_activities` or `crm.contact_activities`. One meeting can have both.
