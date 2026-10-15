/** Column meaning for the reports spoke. Keys are `schema.table.column`. */

export const CRM_READS = new Set([
  "accounts.organizations.id",
  "accounts.organizations.business_type",
  "accounts.organizations.company_name",
  "accounts.organizations.industry_type",
  "accounts.setup_users.id",
  "accounts.setup_users.organization_id",
  "accounts.setup_users.work_email",
  "accounts.setup_users.first_name",
  "accounts.setup_users.last_name",
  "accounts.setup_users.status",
  "accounts.setup_users.password_hash",
  "accounts.setup_users.password_set_at",
  "accounts.setup_users.updated_at",
  "accounts.setup_roles.id",
  "accounts.setup_roles.name",
  "accounts.setup_user_product_access.user_id",
  "accounts.setup_user_product_access.product_id",
  "accounts.setup_user_product_access.role_id",
  "accounts.setup_user_product_access.organization_id",
  "accounts.auth_sessions.token",
  "accounts.auth_sessions.email",
  "accounts.auth_sessions.role",
  "accounts.auth_sessions.display_name",
  "accounts.auth_sessions.expires_at",
  "accounts.auth_sessions.user_id",
  "accounts.auth_sessions.presence_initialized_at",
  "accounts.auth_sessions.product_id",
  "accounts.mail_oauth_connections.account_email",
  "accounts.mail_oauth_connections.account_type",
  "accounts.mail_oauth_connections.expires_at",
  "accounts.mail_oauth_connections.needs_reauth",
  "accounts.mail_oauth_connections.access_token_encrypted",
  "accounts.mail_oauth_connections.refresh_token_encrypted",
  "accounts.a2a_spoke_clients.client_id",
  "accounts.a2a_spoke_clients.client_secret",
  "accounts.a2a_spoke_clients.organization_id",
  "accounts.a2a_spoke_clients.a2a_server_name",
  "cdp.customer_profile.cdp_id",
  "cdp.customer_profile.organization_id",
  "cdp.customer_profile.contact_type",
  "cdp.customer_profile.first_name",
  "cdp.customer_profile.last_name",
  "cdp.customer_profile.company",
  "cdp.customer_profile.city",
  "cdp.customer_profile.country",
  "cdp.customer_profile.region",
  "cdp.customer_profile.custom_fields",
  "cdp.customer_profile.created_at",
  "cdp.customer_profile.updated_at",
  "cdp.identity_keys.identity_id",
  "cdp.identity_keys.cdp_id",
  "cdp.identity_keys.organization_id",
  "cdp.identity_keys.key_type",
  "cdp.identity_keys.key_value",
  "cdp.identity_keys.source_system",
  "cdp.identity_keys.verified",
  "cdp.identity_keys.created_at",
]);

export const DOCS = {
  "accounts.organizations.id":
    "Primary key of the tenant. Every CRM row's organization_id stores this bigint. Filter reports to the signed-in org's id.",
  "accounts.organizations.tenant_id":
    "Accounts platform tenant code (string). CRM tenancy uses id, not this field. Do not join CRM tables on tenant_id.",
  "accounts.organizations.company_name":
    "Display name of the Worktual customer (the seller org). Shown on quotes and invoices as the seller. Not the name of a crm.companies account.",
  "accounts.organizations.industry_type":
    "Industry string collected at signup. CRM maps it to a field pack (OrganizationVertical). It does not change lead scores or create industry-specific tables.",
  "accounts.organizations.business_type":
    "Motion for the tenant: b2b, b2c, or b2b2c (case may vary in the row). B2C must not receive finance metrics. Empty string means unset.",
  "accounts.organizations.contact_name":
    "Signup contact person at the tenant. Not a CRM contact and not used as deal owner.",
  "accounts.organizations.designation":
    "Job title of the signup contact. Accounts-owned; CRM does not report on it.",
  "accounts.organizations.work_email":
    "Signup work email for the tenant. Not the same as a rep's setup_users.work_email.",
  "accounts.organizations.admin_email":
    "Admin mailbox recorded at signup. Reports must not treat this as a sales-rep owner.",
  "accounts.organizations.tax_number":
    "Tax / GST identifier for the tenant. Accounts billing, not deal tax.",
  "accounts.organizations.billing_address":
    "Tenant billing address from signup. Not a crm.company_locations row.",
  "accounts.organizations.website_url":
    "Tenant website from signup.",
  "accounts.organizations.country":
    "Tenant country from signup.",
  "accounts.organizations.company_size":
    "Headcount band from signup. Not crm.companies.employee_count.",
  "accounts.organizations.mobile_country_code":
    "Dialing code of the signup mobile.",
  "accounts.organizations.mobile_number":
    "Signup mobile for the tenant admin.",
  "accounts.organizations.lifecycle_status":
    "Accounts lifecycle of the tenant (active, prospect, …). Not CRM lead_status.",
  "accounts.organizations.converted_at":
    "When Accounts marked the tenant converted. Not deal closed_at.",
  "accounts.organizations.created_at":
    "When the tenant row was created in Accounts.",
  "accounts.organizations.updated_at":
    "When any Accounts org field last changed.",
  "accounts.organizations.support_portal_slug":
    "Service portal URL slug. Service tickets are not in CRM tables.",
  "accounts.organizations.support_portal_enabled":
    "Whether the Service portal is on for this tenant.",
  "accounts.organizations.support_portal_welcome":
    "Welcome copy for the Service portal.",
  "accounts.organizations.reseller_id":
    "Parent reseller org if this tenant was created through a reseller. Not crm.companies.parent_company_id.",
  "accounts.organizations.source_lead_id":
    "Accounts lead that became this tenant. Not a CRM contact id.",
  "accounts.organizations.sip_domain_name":
    "CCaaS SIP domain for the tenant. Not used in sales KPIs.",
  "accounts.organizations.admin_email_enc":
    "Encrypted admin email. Never select in a report.",
  "accounts.organizations.work_email_enc":
    "Encrypted work email. Never select in a report.",
  "accounts.organizations.mobile_country_code_enc":
    "Encrypted mobile country code. Never select in a report.",
  "accounts.organizations.mobile_number_enc":
    "Encrypted mobile. Never select in a report.",
  "accounts.organizations.tax_number_enc":
    "Encrypted tax number. Never select in a report.",
  "accounts.organizations.billing_address_enc":
    "Encrypted billing address. Never select in a report.",

  "accounts.setup_users.id":
    "Primary key of the login user. CRM stores this on owner_user_id, created_by_user_id, and activity assignees. Join here to print the rep name.",
  "accounts.setup_users.organization_id":
    "Tenant this user belongs to. Must match the CRM organization_id filter.",
  "accounts.setup_users.employee_id":
    "HR / CCaaS employee code. CRM does not use this as owner id.",
  "accounts.setup_users.first_name":
    "Given name of the signed-in person. Concatenate with last_name for owner labels.",
  "accounts.setup_users.last_name":
    "Family name of the signed-in person.",
  "accounts.setup_users.work_email":
    "Login mailbox. Also used for meeting invites when no Google mailbox is connected. Compare case-insensitively.",
  "accounts.setup_users.mobile_number":
    "User mobile from Accounts. Not a CRM contact phone.",
  "accounts.setup_users.primary_language":
    "Preferred language for CCaaS / Accounts. Not a CRM locale setting.",
  "accounts.setup_users.secondary_language":
    "Secondary language on the user directory row.",
  "accounts.setup_users.location_id":
    "Accounts office location id. Not crm.company_locations.id.",
  "accounts.setup_users.status":
    "Directory status (active, …). Only active users should be assigned as owners.",
  "accounts.setup_users.created_at":
    "When the user was created in Accounts.",
  "accounts.setup_users.updated_at":
    "When the directory row last changed.",
  "accounts.setup_users.shift_types":
    "CCaaS shift labels (json). Not sales working hours in CRM.",
  "accounts.setup_users.password_hash":
    "Password verifier. Never select in a report.",
  "accounts.setup_users.invite_status":
    "Invite / activation state from Accounts (for example active).",
  "accounts.setup_users.password_set_at":
    "When the user last set a password. Null if never set.",
  "accounts.setup_users.invited_at":
    "When the Accounts invite was sent.",
  "accounts.setup_users.skills":
    "CCaaS skill tags. Not CRM product skills.",
  "accounts.setup_users.city":
    "User city on the directory row.",
  "accounts.setup_users.state":
    "User state / region on the directory row.",
  "accounts.setup_users.country":
    "User country on the directory row.",
  "accounts.setup_users.business_hours_id":
    "Accounts business-hours profile. CRM owner hours may also live in CRM helpers; do not invent a quota from this.",
  "accounts.setup_users.team_id":
    "CCaaS team. Not a CRM territory.",
  "accounts.setup_users.whatsapp_number":
    "WhatsApp number on the directory row.",
  "accounts.setup_users.handling_regions":
    "CCaaS routing regions (json array).",
  "accounts.setup_users.ext":
    "PBX extension.",
  "accounts.setup_users.sip_login_id":
    "SIP login for CCaaS. Not a report metric.",
  "accounts.setup_users.sip_password":
    "SIP password. Never select in a report.",
  "accounts.setup_users.sip_domain_name":
    "SIP domain for this user.",

  "accounts.setup_roles.id":
    "Primary key of the role. setup_user_product_access.role_id points here.",
  "accounts.setup_roles.name":
    "Role label CRM maps to admin, sales_manager, sales_rep, presales, marketing, finance, or viewer. Unknown names fall back to sales_rep.",
  "accounts.setup_roles.description":
    "Human description of the role in Accounts.",
  "accounts.setup_roles.accessible_products":
    "JSON list of Worktual products this role can open. CRM access still requires a product_id = crm grant.",
  "accounts.setup_roles.module_permission":
    "Legacy permission blob. CRM module gating uses backend modules.ts, not this column.",
  "accounts.setup_roles.module_permissions":
    "Newer permission JSON. CRM still resolves the spoke role from name, not from this JSON.",
  "accounts.setup_roles.can_view":
    "Accounts can-view flag. CRM record visibility uses canViewAllRecords / owner_user_id, not this bit.",
  "accounts.setup_roles.can_create":
    "Accounts can-create flag. Not a CRM KPI.",
  "accounts.setup_roles.can_edit":
    "Accounts can-edit flag.",
  "accounts.setup_roles.can_delete":
    "Accounts can-delete flag.",
  "accounts.setup_roles.can_export":
    "Accounts can-export flag.",
  "accounts.setup_roles.can_approve":
    "Accounts can-approve flag. Invoice approval in CRM uses invoice columns, not this bit.",
  "accounts.setup_roles.created_at":
    "When the role was created.",
  "accounts.setup_roles.updated_at":
    "When the role was last edited.",
  "accounts.setup_roles.product_id":
    "Product this role catalog row is for. CRM grants still go through setup_user_product_access.product_id = crm.",
  "accounts.setup_roles.organization_id":
    "Tenant that owns this role row when roles are per-org.",

  "accounts.setup_user_product_access.id":
    "Primary key of the grant row.",
  "accounts.setup_user_product_access.user_id":
    "setup_users.id receiving the grant.",
  "accounts.setup_user_product_access.product_id":
    "Worktual product. CRM reads only rows where this is crm.",
  "accounts.setup_user_product_access.role_id":
    "setup_roles.id. Join to get the role name.",
  "accounts.setup_user_product_access.organization_id":
    "Tenant of the grant.",
  "accounts.setup_user_product_access.created_at":
    "When the user was granted that product role.",

  "accounts.auth_sessions.token":
    "Session secret. Never return it from a report.",
  "accounts.auth_sessions.email":
    "Email the session was issued for.",
  "accounts.auth_sessions.role":
    "Role string stamped on the session at login.",
  "accounts.auth_sessions.display_name":
    "Display name cached on the session.",
  "accounts.auth_sessions.expires_at":
    "When the session dies. CRM treats expires_at > now() as live.",
  "accounts.auth_sessions.user_id":
    "setup_users.id of the signed-in person.",
  "accounts.auth_sessions.presence_initialized_at":
    "When presence was first marked for this session. Null until initialized.",
  "accounts.auth_sessions.product_id":
    "Product the session belongs to. CRM sessions use crm.",
  "accounts.auth_sessions.email_enc":
    "Encrypted email. Never select in a report.",

  "accounts.mail_oauth_connections.id":
    "Primary key of the shared mailbox OAuth row.",
  "accounts.mail_oauth_connections.account_id":
    "Accounts account id for the mailbox owner.",
  "accounts.mail_oauth_connections.account_type":
    "Provider kind (google, microsoft, …).",
  "accounts.mail_oauth_connections.mailbox_profile":
    "Which mailbox profile this connection is (user vs bot).",
  "accounts.mail_oauth_connections.account_email":
    "Connected mailbox address. A coverage report may count whether a rep has a row; do not dump tokens.",
  "accounts.mail_oauth_connections.account_name":
    "Display name of the connected mailbox.",
  "accounts.mail_oauth_connections.ms_tenant_id":
    "Microsoft tenant id when the provider is Microsoft.",
  "accounts.mail_oauth_connections.access_token_encrypted":
    "Encrypted access token. Never select in a report.",
  "accounts.mail_oauth_connections.refresh_token_encrypted":
    "Encrypted refresh token. Never select in a report.",
  "accounts.mail_oauth_connections.expires_at":
    "When the access token expires.",
  "accounts.mail_oauth_connections.scope":
    "OAuth scopes granted.",
  "accounts.mail_oauth_connections.needs_reauth":
    "True when the user must reconnect the mailbox.",
  "accounts.mail_oauth_connections.created_at":
    "When the connection was created.",
  "accounts.mail_oauth_connections.updated_at":
    "When tokens or metadata last changed.",

  "accounts.a2a_spoke_clients.id":
    "Primary key of the Hub spoke client row.",
  "accounts.a2a_spoke_clients.a2a_server_name":
    "Spoke name (worktual-crm, worktual-hub, …).",
  "accounts.a2a_spoke_clients.client_id":
    "OAuth client id the Hub uses. Do not print in a sales report.",
  "accounts.a2a_spoke_clients.client_secret":
    "Client secret. Never select in a report.",
  "accounts.a2a_spoke_clients.access_token":
    "Live Hub access token. Never select in a report.",
  "accounts.a2a_spoke_clients.access_expires_at":
    "When the Hub access token expires.",
  "accounts.a2a_spoke_clients.refresh_token":
    "Hub refresh token. Never select in a report.",
  "accounts.a2a_spoke_clients.refresh_expires_at":
    "When the refresh token expires.",
  "accounts.a2a_spoke_clients.skill_version":
    "Skill catalog version last registered with the Hub.",
  "accounts.a2a_spoke_clients.created_at":
    "When the spoke client was created.",
  "accounts.a2a_spoke_clients.updated_at":
    "When tokens or skill version last changed.",
  "accounts.a2a_spoke_clients.organization_id":
    "Tenant that owns this spoke client.",

  "cdp.customer_profile.cdp_id":
    "Primary key of the person. crm.contact_profiles.account_contact_id stores this text. Cast as text in joins.",
  "cdp.customer_profile.first_name":
    "Given name of the person. Contact list name comes from here, not from contact_profiles.",
  "cdp.customer_profile.last_name":
    "Family name of the person.",
  "cdp.customer_profile.gender":
    "Gender on the shared profile when CDP has it. CRM does not require it.",
  "cdp.customer_profile.date_of_birth":
    "Date of birth on the shared profile. Not a sales KPI.",
  "cdp.customer_profile.company":
    "Employer name denormalized on the CDP person. The CRM account link is contact_profiles.company_id → crm.companies.",
  "cdp.customer_profile.city":
    "City on the person profile.",
  "cdp.customer_profile.region":
    "Region / state on the person profile.",
  "cdp.customer_profile.country":
    "Country on the person profile.",
  "cdp.customer_profile.language":
    "Preferred language on the person.",
  "cdp.customer_profile.timezone":
    "Timezone on the person.",
  "cdp.customer_profile.acquisition_channel":
    "How CDP first acquired the person (for example web). Not crm lead source.",
  "cdp.customer_profile.acquisition_date":
    "CDP acquisition date.",
  "cdp.customer_profile.first_referrer":
    "First HTTP referrer CDP stored.",
  "cdp.customer_profile.first_seen_at":
    "First time CDP saw this person.",
  "cdp.customer_profile.last_seen_at":
    "Last time CDP saw this person.",
  "cdp.customer_profile.created_at":
    "When the CDP profile was inserted.",
  "cdp.customer_profile.updated_at":
    "When the CDP profile last changed.",
  "cdp.customer_profile.organization_id":
    "Tenant of the person. Must match CRM organization_id.",
  "cdp.customer_profile.custom_fields":
    "JSON bag. CRM reads title, industry, company_domain, and address_line. Do not invent other keys in SQL.",
  "cdp.customer_profile.tenant_id":
    "CDP tenant string (often default). CRM tenancy uses organization_id.",
  "cdp.customer_profile.preferences_json":
    "CDP preference document. Not CRM marketing opt-out (that is contact_profiles).",
  "cdp.customer_profile.consent_json":
    "CDP consent document.",
  "cdp.customer_profile.traits_json":
    "CDP traits document.",
  "cdp.customer_profile.contact_type":
    "CDP person class (contact, customer, churned, lead, …). CRM lead_status converted is aligned to customer/churned. Do not use this as the sales pipeline stage.",
  "cdp.customer_profile.primary_product":
    "Which Worktual product last wrote the profile (crm, webtracking, …). Filter CRM people via contact_profiles, not this alone.",
  "cdp.customer_profile.industry":
    "Industry on the person when CDP has a dedicated column. CRM also reads custom_fields.industry.",
  "cdp.customer_profile.blocked":
    "CDP block flag. Not CRM disqualified.",

  "cdp.identity_keys.identity_id":
    "Primary key of this email/phone key.",
  "cdp.identity_keys.cdp_id":
    "Person this key belongs to. ON DELETE CASCADE from customer_profile.",
  "cdp.identity_keys.key_type":
    "Kind of key. CRM writes email, phone, email_secondary, phone_secondary. Other systems may write cdp_id or others — do not invent types.",
  "cdp.identity_keys.key_value":
    "The email or phone (or other key). Emails are stored lowercased. Unique with (organization_id, key_type, key_value).",
  "cdp.identity_keys.source_system":
    "Who wrote the key (crm, cdp_core, …).",
  "cdp.identity_keys.confidence_score":
    "CDP confidence. CRM does not score leads from this.",
  "cdp.identity_keys.verified":
    "Whether CDP marked the key verified. CRM usually writes false on create.",
  "cdp.identity_keys.created_at":
    "When this key was inserted. CRM picks the oldest email key as primary.",
  "cdp.identity_keys.organization_id":
    "Tenant of the key.",
  "cdp.identity_keys.custom_fields":
    "JSON on the key. CRM does not depend on keys here.",

  "inventory.products.id":
    "Catalog product id. Quote, order, and invoice lines store this as product_id.",
  "inventory.products.organization_id":
    "Tenant that owns the catalog row.",
  "inventory.products.name":
    "Sellable product name shown on quotes and reports.",
  "inventory.products.tagline":
    "Short card line under the name.",
  "inventory.products.description":
    "Marketing / sales description.",
  "inventory.products.specifications":
    "Long specification text.",
  "inventory.products.image_url":
    "Primary image URL.",
  "inventory.products.gallery_urls":
    "Extra image URLs (json).",
  "inventory.products.product_url":
    "PDP or datasheet URL. Not an image.",
  "inventory.products.sku":
    "Stock keeping unit. Unique per org when set.",
  "inventory.products.brand":
    "Brand label for merchandising.",
  "inventory.products.subcategory":
    "Finer category than category.",
  "inventory.products.stock_on_hand":
    "Warehouse units. Null means not inventory-tracked (services, subscriptions).",
  "inventory.products.price":
    "List price on the catalog row. Commercial documents may override via price books and lines.",
  "inventory.products.max_discount_percent":
    "Discount above this percent on a quote line needs finance approval. Null means no cap.",
  "inventory.products.currency":
    "ISO currency of catalog price. Do not mix currencies in a sum.",
  "inventory.products.status":
    "draft, active, or archived. Revenue reports usually keep active plus historically sold ids.",
  "inventory.products.product_type":
    "fixed or customizable. Customizable products use add-ons.",
  "inventory.products.category":
    "Product category for grouping.",
  "inventory.products.tags":
    "Freeform / comma-separated tags.",
  "inventory.products.billing_type":
    "one_time or recurring. Recurring feeds ARR-style metrics only when contracts/invoices say so.",
  "inventory.products.billing_frequency":
    "monthly, quarterly, or annual when recurring.",
  "inventory.products.unit_of_measure":
    "How the product is sold: per_seat, per_agent, per_ticket, or flat.",
  "inventory.products.pricing_tiers":
    "Legacy volume tiers on the product. Prefer add-on tiers for customizable products.",
  "inventory.products.custom_attributes":
    "Non-price industry labels. Not used in quote math.",
  "inventory.products.created_at":
    "When the catalog row was created.",
  "inventory.products.updated_at":
    "When the catalog row last changed.",

  "crm.companies.name":
    "Name of the B2B account the team sells to. Not the seller tenant name (that is accounts.organizations.company_name).",
  "crm.companies.domain":
    "Company website host (example.com). Used for enrichment and matching, not as the primary key.",
  "crm.companies.industry":
    "Industry label on this account. Independent of accounts.organizations.industry_type.",
  "crm.companies.employee_count":
    "Headcount stored on the account. Null if unknown.",
  "crm.companies.linkedin_url":
    "LinkedIn URL for the company page.",
  "crm.companies.logo_url":
    "Logo image URL for UI.",
  "crm.companies.channel_role":
    "standard, franchise, owned_store, or brand_hq. Owner-scoped reps also see children of franchise / owned_store / brand_hq companies they own.",
  "crm.companies.parent_company_id":
    "Parent crm.companies.id for brand → store hierarchy. Null on a standalone account.",
  "crm.companies.expansion_signal":
    "HITL expansion flag from the matcher agent. The agent does not create deals.",
  "crm.companies.expansion_reason":
    "Why the expansion signal was set.",
  "crm.companies.expansion_draft":
    "Draft talking points for a human to send. Not an outbound email log.",
  "crm.companies.expansion_last_run_at":
    "When the expansion matcher last ran on this company.",
  "crm.companies.collection_risk_level":
    "HITL collection-risk band from invoice history. The agent does not block the account.",
  "crm.companies.collection_risk_reason":
    "Why that risk band was set.",
  "crm.companies.collection_risk_last_run_at":
    "When collection-risk last ran.",

  "crm.company_locations.name":
    "Site name (HQ, city office, plant).",
  "crm.company_locations.type":
    "hq or branch.",
  "crm.company_locations.address":
    "Street address of the site.",
  "crm.company_locations.city":
    "City of the site.",
  "crm.company_locations.industry":
    "Industry override for this site when it differs from the company.",
  "crm.company_locations.employee_count":
    "Headcount at this site.",

  "crm.contact_profiles.account_contact_id":
    "cdp.customer_profile.cdp_id. Always join CDP for name and email.",
  "crm.contact_profiles.lead_status":
    "Sales lifecycle: new, contacted, qualified, disqualified, converted.",
  "crm.contact_profiles.crm_status":
    "Soft-delete of the overlay. Current contacts are crm_status = active. This is not CDP is_active (CDP has none).",
  "crm.contact_profiles.lead_source":
    "How this lead entered CRM (import, inbound, prospect pull, …).",
  "crm.contact_profiles.disqualify_reason":
    "Why the lead was disqualified. Group by the stored code.",
  "crm.contact_profiles.bant_budget":
    "BANT: budget confirmed.",
  "crm.contact_profiles.bant_authority":
    "BANT: authority confirmed.",
  "crm.contact_profiles.bant_need":
    "BANT: need confirmed.",
  "crm.contact_profiles.bant_timeline":
    "BANT: timeline confirmed.",
  "crm.contact_profiles.converted_deal_id":
    "Deal created when this lead converted. Null if not converted.",
  "crm.contact_profiles.marketing_opt_out":
    "Durable marketing suppression. Nurture must not send when true.",
  "crm.contact_profiles.marketing_opt_out_at":
    "When marketing opt-out was set.",
  "crm.contact_profiles.notes":
    "Free text on the overlay. Do not parse into a KPI.",
  "crm.contact_profiles.tags":
    "CRM tags on the contact.",
  "crm.contact_profiles.custom_attributes":
    "Vertical pack field values. Never stored as new CDP columns.",
  "crm.contact_profiles.is_pinned":
    "UI pin on the contact list.",
  "crm.contact_profiles.assignment_reason":
    "Why the assignment agent picked this owner.",
  "crm.contact_profiles.sla_deadline":
    "When the assigned owner should first act.",
  "crm.contact_profiles.assigned_at":
    "When the current owner was assigned.",
  "crm.contact_profiles.assignment_escalated":
    "True after assignment SLA escalation.",
  "crm.contact_profiles.nurture_status":
    "Nurture overlay state written by the nurture agent.",
  "crm.contact_profiles.nurture_sequence_step":
    "Step index in the nurture sequence.",
  "crm.contact_profiles.flagged_for_review":
    "Lifecycle agent needs a human because evidence is ambiguous or stalled.",
  "crm.contact_profiles.flag_reason":
    "Why the contact was flagged.",

  "crm.deals.title":
    "Opportunity name shown on the pipeline.",
  "crm.deals.stage":
    "qualification, discover, propose, negotiate, closed_won, or closed_lost. There is no per-deal probability column; use stage weights from the KPI catalog.",
  "crm.deals.amount":
    "Deal value. Open-stage sum is pipeline. closed_won sum in period is won revenue.",
  "crm.deals.contact_id":
    "Optional cdp.customer_profile.cdp_id of the person on the deal (not contact_profiles.id).",
  "crm.deals.contact_name":
    "Denormalized person name at last save. Prefer CDP for current name.",
  "crm.deals.contact_email":
    "Denormalized email at last save. Prefer identity_keys for current email.",
  "crm.deals.notes":
    "Free text. Do not parse into won reason or stage history.",
  "crm.deals.lost_reason":
    "Why the deal was lost. Null on open and won deals.",
  "crm.deals.expected_close_date":
    "Rep's expected close. Slippage compares this to today on open deals.",
  "crm.deals.closed_at":
    "When the deal was marked won or lost. Period metrics use coalesce(closed_at, created_at).",
  "crm.deals.forecast_category":
    "Forecast auditor category overlay. Does not change stage.",
  "crm.deals.forecast_confidence_percent":
    "Auditor confidence 0–100. Not the stage weight.",
  "crm.deals.forecast_flagged":
    "True when the auditor flagged the deal.",
  "crm.deals.forecast_reason":
    "Why the auditor flagged it.",

  "crm.quotes.status":
    "draft, sent, accepted, rejected, or void.",
  "crm.quotes.total":
    "Quote header total. Do not add this to line totals in the same sum.",
  "crm.invoices.status":
    "draft, sent, paid, void, or overdue.",
  "crm.invoices.due_at":
    "When payment is due. Overdue invoices use this plus status.",
  "crm.invoices.paid_at":
    "When the invoice was marked paid. Null if unpaid.",
};

const CRM_COLUMN = {
  id: (table) =>
    `Primary key of ${table}. Other tables store this value when they point at this record. Not a quote number or invoice number unless this table is that document.`,
  organization_id: () =>
    "Tenant id, equal to accounts.organizations.id. Filter every report to the signed-in organization first.",
  created_at: () =>
    "When this row was inserted. Use for “created this week/month”. It does not move on later edits.",
  updated_at: () =>
    "When this row last changed. Use for freshness, not for won/lost time (use closed_at or paid_at for those events).",
  owner_user_id: () =>
    "accounts.setup_users.id of the owner. Reps are scoped to this column. Join setup_users for the name.",
  created_by_user_id: () =>
    "accounts.setup_users.id of the creator. Can differ from the current owner.",
  company_id: () =>
    "crm.companies.id for the B2B account on this row. Join companies for the account name.",
  contact_id: () =>
    "CRM contact overlay id (crm.contact_profiles.id) when this row is tied to a person.",
  deal_id: () =>
    "crm.deals.id this commercial or activity row belongs to.",
  product_id: () =>
    "inventory.products.id. Join products for name, sku, and billing type.",
  location_id: () =>
    "crm.company_locations.id when this row is tied to a site.",
  name: (table) =>
    `Display name stored on ${table}.`,
  amount: (table) =>
    `Money amount on this ${table} row. Keep sums inside one currency. Null is 0 only when the KPI catalog says so.`,
  currency: () =>
    "ISO currency code for money on this row. Never add two currencies together.",
  status: (table) =>
    `Lifecycle status of this ${table} row. Filter only with documented enum or varchar codes.`,
  stage: () =>
    "Deal pipeline stage: qualification, discover, propose, negotiate, closed_won, closed_lost.",
};

export function describeColumn(table, column, dataType) {
  const key = `${table}.${column}`;
  if (DOCS[key]) return DOCS[key];
  if (CRM_COLUMN[column]) return CRM_COLUMN[column](table);
  if (column.endsWith("_at")) {
    return `Timestamp on ${table} for the “${column.replace(/_at$/, "").replaceAll("_", " ")}” event. Null means that event has not happened.`;
  }
  if (column.endsWith("_id") && column !== "organization_id") {
    return `Identifier stored on ${table}. Join the table that owns this id. Do not treat it as a display label.`;
  }
  if (column.endsWith("_enc") || /token|secret|password|hash/i.test(column)) {
    return `Sensitive field on ${table}. Never select it in a report.`;
  }
  return `Value of ${column} on ${table} (${dataType}). Use it only for the fact this table stores — not as a substitute for a missing official metric column.`;
}

export function usageTag(table, column) {
  if (!table.startsWith("accounts.") && !table.startsWith("cdp.")) return "";
  return CRM_READS.has(`${table}.${column}`)
    ? "CRM reads this."
    : "Present on the shared table. CRM does not select it today; do not invent a KPI from it.";
}
