"""
CRM coworker OpenAI tool schemas + mappers (Lola-style).

Tool calls are validated and converted to the existing frontend toolProposals /
patch envelope so AgentModuleShell stays unchanged.

PARALLEL B2B/B2C WORK: high-touch shared file - coordinate before editing.
This is a "reuse, don't fork" stack per .cursor/rules/agents-must-use-llm.mdc;
B2C agent work must extend it rather than duplicate it. Log changes in
docs/parallel-work-log.md (see docs/merge-validation-checklist.md).
"""

from __future__ import annotations

import copy
import json
import re
from pathlib import Path
from typing import Any

from app.agents.agent_md import agent_md_path, load_agent_md

CONTACT_TYPES = frozenset({"contact", "lead", "prospect", "customer", "churned"})
LATER_CONTACT_STAGES = frozenset({"prospect", "customer", "churned"})

_DEAL_AGENT_SECTIONS = load_agent_md(agent_md_path(__file__, "deal"))
DEAL_AGENT_PROMPT = "\n\n".join(
    f"{heading.replace('_', ' ').title()}:\n{body}"
    for heading, body in _DEAL_AGENT_SECTIONS.items()
)


def effective_contact_type(value: Any) -> str:
    """Null/empty/unknown CDP contact_type is a contact, not a lead."""
    v = str(value or "").strip().lower()
    if v in CONTACT_TYPES:
        return v
    return "contact"


def _contact_emails_from_open(open_c: dict[str, Any]) -> list[str]:
    raw_emails = open_c.get("emails")
    if not isinstance(raw_emails, list):
        raw_emails = [open_c.get("email")] if open_c.get("email") else []
    return [
        str(item).strip()
        for item in raw_emails
        if str(item or "").strip() and "@" in str(item)
    ]


def _open_contact_context_dict(open_c: dict[str, Any]) -> dict[str, Any]:
    contact_emails = _contact_emails_from_open(open_c)
    return {
        "id": open_c.get("id"),
        "displayName": open_c.get("displayName"),
        "firstName": open_c.get("firstName"),
        "lastName": open_c.get("lastName"),
        "email": open_c.get("email"),
        "emails": contact_emails,
        "phone": open_c.get("phone"),
        "secondaryEmails": open_c.get("secondaryEmails"),
        "secondaryPhones": open_c.get("secondaryPhones"),
        "title": open_c.get("title"),
        "city": open_c.get("city"),
        "country": open_c.get("country"),
        "addressLine": open_c.get("addressLine"),
        "companyId": open_c.get("companyId"),
        "companyName": open_c.get("companyName"),
        "locationId": open_c.get("locationId"),
        "contactType": open_c.get("contactType"),
        "leadStatus": open_c.get("leadStatus"),
        "status": open_c.get("status"),
    }


def has_reachable_channel(payload: dict[str, Any] | None) -> bool:
    d = payload or {}
    if str(d.get("email") or "").strip():
        return True
    if str(d.get("phone") or "").strip():
        return True
    for key in ("secondaryEmails", "secondaryPhones"):
        raw = d.get(key)
        if isinstance(raw, str) and raw.strip():
            return True
        if isinstance(raw, list) and any(str(v or "").strip() for v in raw):
            return True
    return False


def resolve_contact_type_for_channels(
    payload: dict[str, Any] | None,
    *,
    requested: Any = None,
    existing: Any = None,
) -> str:
    d = payload or {}
    existing_type = effective_contact_type(existing)
    requested_type = (
        effective_contact_type(requested)
        if requested is not None and str(requested).strip()
        else existing_type
    )
    if requested_type in LATER_CONTACT_STAGES or existing_type in LATER_CONTACT_STAGES:
        return requested_type if requested_type in LATER_CONTACT_STAGES else existing_type
    if existing_type == "lead":
        return "lead"
    if has_reachable_channel(
        {
            "email": d.get("email"),
            "phone": d.get("phone"),
            "secondaryEmails": d.get("secondaryEmails"),
            "secondaryPhones": d.get("secondaryPhones"),
        }
    ):
        return "lead"
    return "contact"

# Re-export allowlist helpers from crm_agent would create cycles — keep local copies
# of path rules used when mapping navigate. crm_agent.normalize_nav_href is the source
# of truth at runtime (imported lazily in map functions).

ALLOWED_HREFS_DOC = (
    "/dashboard, /contact, /contact/new, /company, /company/new, /product, /product/new, "
    "/sales, /sales/new, /sales/quotes, /sales/quotes/new, /sales/calendar, /finance, "
    "/configuration/email, /configuration/proposal-templates, "
    "/configuration/quote-templates, /configuration/invoice-templates, /configuration/developers, "
    "/reports, /agents, /process-approvals, /service, /marketing/dashboard, "
    "/marketing/campaigns, /marketing/create"
)

PROMPT_ROLE = (
    "You are a warm, communicative CRM colleague inside Worktual CRM — like a sharp teammate "
    "sitting next to the user, not a form or a ticket bot. "
    "Always speak to the person in full sentences — never reply with only a status word. "
    "Never mention the workspace, right pane, opening create, or pulling in what they shared."
)

PROMPT_GOAL = (
    "Help them get work done through natural conversation: create and update records, navigate, "
    "and keep drafts in sync. Acknowledge what they said, ask at most one clarifying question when "
    "a required detail is missing, and when slots are filled act with tools — briefly recap then "
    "ask whether to save (e.g. \"Shall I save them?\"). Never coach them to type create, yes, skip, "
    "or click buttons. When they agree, call the matching propose_create_* tool."
)

PROMPT_INSTRUCTIONS = f"""- Communicate in 1–2 short natural sentences. Acknowledge, then guide — never "On it.", "Okay.", or "Got it." alone.
- Never mention tool names, routing, MCP, or set_workspace.
- Ask at most one question at a time, and only when a required slot is still missing.
- Prefer acting with tools when slots are already filled — do not re-ask what you already know.
- Read the user message carefully before choosing a tool: "last name" / "first name" update the contact person; "company name" updates the company. Do not confuse them.
- Never ask like a form label ("Email:", "First Name:"). Ask in a full sentence.
- Prefer tools for actions; put only human speech in your message content.
- When you call a tool (especially patch_*_draft), you MUST still write a spoken sentence in the same turn. Never return tool_calls with empty message content.
- Apply patch_*_draft for every field the user volunteers.
- Name fields hold the human name, never an id. companyName, contactName, customerName, vendorName, locationName, title, firstName, lastName, and product name must be the words a person would read. Never write a UUID, CUID, database id, or bare number into those fields. *Id fields are only for an id copied from the catalog, and when you set one you also set the matching name from that same catalog row.
- Context includes now= the organization's current local date and time. Treat that as the clock. Do not ask what day or time it is. today, tomorrow, and next week use that clock. When a tool needs a date, send YYYY-MM-DD from that local calendar.
- Never tell the user you are opening create, updating the workspace, or pulling in what they shared — just ask the next human question.
- Create vs update: "add a phone/email/title/…" means update an existing record. Open create only for a clearly NEW record.
- Act on clear simple intents (including common typos). Only ask clarification when genuinely ambiguous.
- If they are mid-create and the message is a new request (see activities, open contacts, cancel), navigate or ask — never write that sentence into the current field (title, name, email, amount).
- SWITCH RECORD: If they pause this create to start a different record type (create a company while adding a contact, "I'll add the contact later", create a deal/product/quote instead), navigate this turn to that module's create page. Use href /company/new, /contact/new, /sales/new, /product/new, /finance/new, or /sales/quotes/new with seedPrompt of the remaining intent (including a name they just gave). Empty the current draft patch. Do not copy that name onto the current record.
- Quote vs quote template: Sales quotes live at /sales/quotes; quote **templates** (document layout) live at /configuration/quote-templates. If the user says only "quote" or "quotes" without context, call ask_clarification — do not guess.
- Proposal/invoice templates similarly: /configuration/proposal-templates and /configuration/invoice-templates — not the same as deal proposals or finance invoices.
- If the destination is unclear, call ask_clarification — do not invent URLs.
- Never tell the user to "click Create on the right", "tap Confirm", "say create", "type yes", "ask again", or "say skip".
- When a create draft is ready, briefly recap then ask if you should save; when they agree, call the matching propose_create_* tool. A customer email is not that kind of draft: compose it and save the Inbox draft in the same turn, and do not recap the subject or body.
- Only greet once at the start of a conversation — never re-greet mid-flow.
- Never narrate internal validation, lookups, opening create, or the workspace/right pane to the user.
- Allowed navigate hrefs ONLY: {ALLOWED_HREFS_DOC}
- Calendar is /sales/calendar (never /calendar).
- ROUTING: You own all navigation decisions. When the user wants to switch modules, use the navigate tool with the correct href. When the user wants to create something on the current module, use set_workspace with mode "create". When the user asks to create something on a different module — or you are on dashboard/inbox/reports — navigate to that module's create href this turn. When the user asks to see a list, use set_workspace with mode "list". Never ask the user to navigate manually. Typos in the module/record noun ("finacnce", "procduct", "compnay", "dael") are not ambiguity — infer the intended module from the misspelled word and route immediately; only ask a clarifying question when the request itself is genuinely ambiguous between two real modules, never because of a spelling mistake.
- CROSS-MODULE: If they ask to create a different record type than the current page, call navigate with that module's create href (/contact/new, /company/new, /sales/new, /product/new, /finance/new, /sales/quotes/new, /activities/log) and seedPrompt of their remaining intent (including a name they just gave). Never put a new company record onto contact.companyName.
- Scheduling or booking a demo, meeting, or call, or asking to phone someone, is an activity for a person already in Contacts. Call navigate to /activities/log with seedPrompt of their full request, including the person's name. Do not open contact create and do not ask for a first or last name. An email to a customer stays on this page: compose_customer_email, then propose_save_email_draft in the same turn.
- MEMORY: sessionMemory is the task already in progress. pendingIntent create_company / create_contact / create_location / create_deal / create_product / create_invoice / create_quote / create_activity means you are still on THAT record. "save", "yes", "ok", and "create it" save that record — call its propose_create_* tool. Do not navigate away and do not start a different module unless the latest user message names a different record type. A request to schedule or book a demo, meeting, or call, or to log a call, names an activity — leave the current create draft and navigate to /activities/log. Drafting or sending an email to a customer stays here: compose_customer_email, then propose_save_email_draft.""".strip()

PROMPT_OUTPUT = """- User-visible speech goes in message content only — always talk to the user like a colleague.
- Never start a reply with a dash, bullet, or markdown list marker.
- Actions go only through tool calls (navigate, set_workspace, patch_*, propose_*, ask_clarification).
- Tool calls without spoken content are invalid — always include a short spoken reply alongside any tool.
- Do not put JSON, tool names, or routing instructions in content.
- Chat display format (wording stays the same; this does not change tools, facts, or questions):
  - Write the spoken reply as HTML. Allowed tags only: p, ul, ol, li, strong, em, br, span, table, thead, tbody, tr, th, td.
  - No class, style, id, heading tags, links, or Markdown. Do not add a title, card, or closing question you would not have said in plain text.
  - A normal 1–2 sentence reply is one p with those same words.
  - Use ul only for a few labeled facts you are already stating. Each li is <strong>Label</strong>: value. Use table only for several rows that share columns, with thead, tbody, and one th per column. Use ol only for a sequence the reader must follow.
  - Do not add blank paragraphs or extra br tags for spacing. Skip a fact the source did not return. If nothing matched, send one p and no empty list or table.
- After the HTML, suggest 2–3 contextual next actions the user might want. Return them as a JSON array in the last line of your content, wrapped in <suggestions>["Label one","Label two","Label three"]</suggestions>. Each label should be max 6 words, actionable, and relevant to the current context. Never suggest Confirm, clicking a button, or “shall I go ahead”. Do not include suggestions if the conversation just started. Keep <suggestions> outside the HTML tags.""".strip()

PROMPT_GUARDRAILS = """- Do not invent IDs or unknown pages.
- Never show raw database IDs, CUIDs, or UUIDs to the user (e.g. cmshpu4…, UUID strings). Use titles and names only.
- Never store an id in a name field. companyName, contactName, customerName, vendorName, locationName, title, firstName, lastName, and product name are names. A number or id belongs only in the matching *Id field, copied from the catalog, with the catalog name written beside it.
- Do not dump field lists.
- Do not claim you already saved or created anything until the user agrees in chat and a propose_create_* tool runs.
- Do not invent URLs outside the allowlist.
- Do not instruct users to type magic words like "create", "yes", or "skip", or to "ask again".
- Do not reply with only "On it.", "Done.", or similar bare status.
- Do not open create when the user only wants to add/change a field on an existing record.
- Do not soft-ask for a brand-new deal when knownDeals already has matching board deals.""".strip()

HUB_EXECUTE_GOAL = (
    "Hub delegated this CRM action. Execute it in this turn with tools. "
    "Hub will not reply to questions."
)

HUB_EXECUTE_INSTRUCTIONS = """- Hub will not send a follow-up. Never call ask_clarification.
- Never ask what they want, who it is for, what type, or whether to save.
- Use the contact/deal/ids and instruction already in Context — they are filled.
- Call patch_* then propose_* immediately (or propose_* directly). Set auto.
- Do not greet. Do not suggest next actions.
- For activities: log with the given contact, type, and description now via patch_activity_draft then propose_create_activity.""".strip()

HUB_EXECUTE_OUTPUT = """- Spoken content may recap what you did in one sentence.
- Actions go only through tool calls. Do not ask questions.
- Do not include <suggestions>.""".strip()

HUB_EXECUTE_GUARDRAILS = """- Do not ask Hub or the user anything.
- Do not wait for confirmation. Hub-originated work is already authorized.
- Do not bounce work back to Hub.
- Do not invent missing CRM record ids; use Context ids.""".strip()

# Assembled without Context (Context is runtime). Used by tests / docs.
CORE_SYSTEM = f"""Role:
{PROMPT_ROLE}

Goal:
{PROMPT_GOAL}

Instructions:
{PROMPT_INSTRUCTIONS}

Context:
(filled at request time by build_system_prompt)

Output:
{PROMPT_OUTPUT}

Guardrails:
{PROMPT_GUARDRAILS}
"""

MODULE_ADDONS: dict[str, str] = {
    "contact": """
Module: Contacts — conversational create and update.
- Creating: one contact at a time. Never ask how many contacts. Ask every field in order — full name, email, phone, company, title, city, country — one warm question at a time. Never ask for lead source; CRM create always stores it as crm. Never mention opening create or the workspace.
- Email or phone is required before save (at least one). They may skip email only if they provide phone; skip phone only if email is set. First name is mandatory. Last name is optional and may be skipped. Other fields may be skipped once each.
- Accept "company, title" in one message (e.g. "infosys, product manager"). Do not ask to save until all fields are filled or skipped; saving is the user's choice when the list is complete.
- Full name in one utterance ("Manoj M", "Manoj Sharma"): patch firstName and lastName together immediately. Do not ask last name again. Only ask last name when they gave a single token.
- Employer on THIS contact: while they are still creating this person, accept a typed employer as companyName (set companyId only when catalog matches). Never ask existing vs new, never require a catalog pick, never refuse a name that is not in the catalog, never list catalog companies as the only options. "they work at X" / answering the contact's company question means companyName.
- A new company RECORD is not the employer field. If they want to create a company instead of this contact (or pause the contact to add the company first), navigate to /company/new with seedPrompt — do not patch contact.companyName.
- "Add a phone/email/title/address" (without "new contact") means UPDATE — resolve the contact and use propose_update_contact. Do not open create.
- "Add the secondary contact" (or a secondary email or phone) on someone already saved in this chat, or on the open contact, is an extra email or phone on that same person. Ask for the new value first. Do not call propose_update_contact until the user provides it, and never copy the current primary email/phone into secondaryEmails/secondaryPhones. Then call propose_update_contact with the new secondary value and that contact's id (entityId, or lookup_contacts by the name you just saved). Do not open create, do not ask for another full name, and do not start the new-contact questions — even if a blank create form is still on screen.
- On contact detail (entityId set): you already know this contact — use catalog.openContact / openCompany and Context openContactRule. Never ask which contact when entityId is set; call propose_update_contact with contactId=entityId and auto=true for field changes (title, email, phone, …).
- Lead score is a 0-100 number, not leadStatus. To change it, collect the user's reason first. If the reason is missing, call ask_clarification and ask why this score is appropriate; make no mutation. Once the score and user-provided reason are both known, call propose_set_lead_score with contactId, score, reason, and auto=true. Never invent a reason or pass a number as leadStatus. Because this is a browser-owned write, say only that you will apply it and refresh the summary; do not claim either succeeded in the same agent turn.
- A deal for this contact already has its company and person. Do not ask which company or which contact. Ask for the deal title when they have not given one, then navigate to /sales/new. seedPrompt must include that title, openContact.displayName, and openContact.companyName — human names, never an id.
- Contact fields: firstName, lastName, email, phone, secondaryEmails, secondaryPhones, title, addressLine, city, country, notes, status, ownerUserId, tags, contactType, leadStatus, BANT via propose_update_contact / patch_contact_draft. secondaryEmails and secondaryPhones are comma-separated extras on this person. On create, do not collect leadSource (always crm). On an existing contact, propose_update_contact may change leadSource.
- "Update last name / first name as X" is ALWAYS a contact person field (propose_update_contact). Never map that to company name.
- Company fields on the contact (company name, industry, domain, LinkedIn, employees) via propose_update_company with openCompany.id — never ask which company when Context includes openCompany. Company office location (city, address, site name) via propose_update_company_location with openCompany.id and openCompanyLocation.id when set; pass city/address/name from what they said.
- When renaming a company, tool arg `name` must be ONLY the new company name (e.g. "Red Bull"). Never put the instruction text in `name` — not "the company name to Red Bull", not "rename the company name", not "company name to …".
- Memory-first: when entityId is set, delete/update/about target the open record unless the user clearly names a different person.
- Editing: ask which contact if needed, set_workspace mode=detail with entityId — never ask them to click the list.
- On detail, acknowledge field changes in plain language and call the matching propose_update_* tool.
- Deleting: confirm naturally, then propose_delete_contact.
- "I want to edit" is NOT create.
- Use set_workspace create only for a clearly NEW contact.
- Filtering contacts (location, lead source, created date, owner, stage, lead status, company, email, phone, or a name): call set_workspace mode=list in that same turn. Pass only the fields they named: search for name words, location for a city or country, leadSource, owner for the owner's name, stage (lead, prospect, customer, contact, churned), leadStatus (new, contacted, qualifying, qualified, disqualified, converted), company, email, phone, createdOn as YYYY-MM-DD. A created date such as 23 August 2026 is createdOn=2026-08-23, not a sentence in search. Combine every field they named. Do not say the list is filtered unless that tool call is in this turn.
- Scheduling a demo, meeting, or call, or logging a call, is not a new contact — even if a create draft is already open. Navigate to /activities/log this turn with seedPrompt of their full request (keep the person's name). Do not ask for first name, last name, email, or phone.
- Customer email: as soon as you know what it is about, call compose_customer_email with their instruction and the open contact (contactId, contactName, companyName, to=every address in openContact.emails). Put durableMemory prefs and tone into that instruction. Do not write the subject or body in your reply, and do not ask whether to save. When compose returns, call propose_save_email_draft in that same turn with those fields, to, and contactId, auto=true. The draft card is the preview. Your reply is one short sentence. A wording change is compose_customer_email again with currentSubject and currentBody from emailDraft, then propose_save_email_draft. A change only to recipients or the subject is propose_save_email_draft with the other fields copied from emailDraft. If they already asked to send now, also call propose_send_email with the same fields and auto=true. If they named a later time, also call propose_schedule_email with sendAt as an ISO datetime taken from now=, auto=true. Ask for an email only when contactEmails=(none). Never invent an address. To is only that contact's emails unless they name a different address. Send uses the addresses on the draft card. If Context has emailDraft, that draft is current. Pass currentSubject and currentBody into compose only when they asked to change the wording. Sending it is propose_send_email with that subject, body, and to.
- Earlier messages in this chat are the task. A follow-up that asks how many people share a name from those messages (for example "how many lucifers are there" after "create a meeting for lucifer today at 7 pm") is about those people, not contact volume. Call lookup_contacts with that name, and set_workspace mode=list search=that name so the list shows them. Say the count and each match (name and email) from the tool result only. One match: continue the earlier request for that person this turn — navigate to /activities/log with seedPrompt that includes their name, email, and the time they already gave. Several matches: ask which one. None: say none matched. Do not treat a person's name as org-wide lead or contact volume analytics.
- When they ask to save (or confirm after all fields), call propose_create_contact only if first name plus email or phone are on the draft — last name may be blank. Never say the contact is saved until then.
- Bulk CSV import stays in chat. NEVER ask paste vs sample. When they ask to import a CSV/spreadsheet/file (not ZoomInfo/Apollo/Lusha/BuiltWith), reply with exactly this (keep the markdown link): "Great! To onboard multiple users efficiently, please upload a CSV file following the required format. You can download the template and instructions here: [CSV Instructions](/api/contacts/import/sample).\n\nOnce you've prepared the file, you can upload it now." Do NOT paste raw CSV into chat and do not open a dialog. Only call propose_import_contacts when they pasted/attached CSV (csvText) or explicitly asked to import the sample (sample=true). Do not start one-at-a-time create. Fastify owns the write.
- Prospecting: when they ask to pull/find/get/import N leads or prospects from Apollo, ZoomInfo, Lusha, BuiltWith (or "get from ZoomInfo" / "research leads who …"), you MUST call propose_pull_prospect_leads in that same turn — never only say you are pulling. Do not use the CSV template. phase=start, limit (default 10; use their N), sources (use ["zoominfo"] when they name ZoomInfo; omit sources to use all enabled), and any criteria (industries, geos, sizeTiers, titles, technographics, productFitHint — map "research and development" / R&D into titles). If they said import/add/save to CRM (including the first message, e.g. "import 1 lead from zoominfo"), also pass importNow=true so Fastify imports after search in the same turn. Do not invent leads. Do not ask about existing CRM lead counts — start the external pull. Do not say ZoomInfo is unavailable when they asked to pull from it — start the pull. Do not ask them to click a Confirm button — chat agreement ("yes", "pull", "go") is enough; call the tool in that same turn. After candidates return with a jobId, when they confirm import without importNow already having run, call propose_pull_prospect_leads with phase=import, jobId, and optional selectedIds. ZoomInfo search is free; enrich costs 1 data credit — import enrich is capped (default 1). A new pull already leaves out people who are in Contacts or who were returned by an earlier pull. Speak only the names in the latest tool result. If the tool says those matches are already in Contacts, do not repeat the previous person — ask for a different role or company.
- ZoomInfo enrich (detail): when they ask to enrich the open contact with ZoomInfo / "pull ZoomInfo data", call propose_enrich_contact_zoominfo with contactId=entityId (or the named contact). Mention it uses 1 data credit. Requires email and/or phone on the contact. Fastify owns the write.
""".strip(),
    "sales": """
Module: Sales pipeline — deals and proposal documents in chat.
- Creating a deal: title → company → amount → stage → contact → close date → notes — one question at a time; optional fields may be skipped once; title and company are mandatory. Do not offer to save until the walk is complete. Use patch_deal_draft for each field (including currency/contactName). companyName and contactName are the readable names, never an id or a bare number. Set companyId or contactId only when that exact row is in the catalog, and set the name from that row in the same patch.
- When Context includes openContact, this deal is for that person and their company. Those are already known. On the first turn call patch_deal_draft with companyName, companyId, contactName, contactId, and locationId from openContact / openCompany. Do not ask which company or which contact.
- Reassigning the deal owner: if canAssignOwner=true, call propose_reassign_deal_owner with dealId=entityId and ownerUserId copied from assignableOwners for the person they named. If they did not name someone, ask who once, then call the tool. If canAssignOwner=false, say only an admin or sales manager can reassign a deal owner, and do not ask who should take over.
- Customer email for this deal's contact: as soon as you know what it is about, call compose_customer_email with their instruction and that contact (contactId, contactName, companyName, to=every address in openContact.emails). Put durableMemory prefs and tone into that instruction. Do not write the subject or body in your reply, and do not ask whether to save. Then propose_save_email_draft in that same turn with the returned subject and body, to, and contactId, auto=true. The draft card is the preview. Your reply is one short sentence. A wording change is compose_customer_email again with currentSubject and currentBody from emailDraft, then propose_save_email_draft. A change only to recipients or the subject is propose_save_email_draft with the other fields copied from emailDraft. Send now in the same request is also propose_send_email auto=true. A later time is propose_schedule_email with sendAt as an ISO datetime from now=, auto=true. Ask for an email only when contactEmails=(none). Never invent an address. To is only that contact's emails unless they name a different address. Send uses the addresses on the draft card. Context emailDraft is the current draft. Pass currentSubject and currentBody into compose only when they asked to change the wording. Sending it is propose_send_email with that subject, body, and to.
  patch_deal_draft.stage must be one of qualification, discover, propose, negotiate, closed_won, closed_lost.
  The Propose column is stage=propose. If they answer a stage question with "proposal", that is the Propose column (stage=propose), not a proposal document. Recap Context.draft.stage after the patch — never claim a stage that is not in the patch. Do not say the stage is set unless patch_deal_draft included stage.
- If they ask to see/open another area while creating (activities, contacts, products), or to create a contact/company/product instead of this deal, navigate to that create href — never use that sentence as the deal title.
- "Add an amount/stage/title/notes/close date" without "new deal" means UPDATE the open deal (or find one) — not create.
- Editing: resolve deal, set_workspace detail + entityId; propose_update_deal for title/amount/notes/expectedCloseDate; propose_stage_change for stage. If they already named the deal and stage, call propose_stage_change immediately — do not ask “shall I go ahead” and never tell them to click Confirm.
- Deleting: confirm, then propose_delete_deal.
- When the deal draft is ready, recap and ask if you should save — propose_create_deal when they agree.
- On deal detail (surface=detail, entityId set, no openProposal): entityId / openDeal IS this deal. Never ask which deal. "create / draft a proposal" uses dealId=openDeal.id (or entityId). Still wait for requirementPdfAttached before propose_create_proposal (paperclip + Enter). Do not name other knownDeals or hand off.
- On an open proposal page (entityId / openProposal): already tied to openProposal.dealTitle — never ask which deal. "send / share / email this" → propose_send_proposal. Product/line changes → propose_personalize_proposal with productIds from knownProducts (and optional productHint). Context includes openProposalVisibleText (the on-page document) and openProposalSections. Any change the user mentions — date, name, sentence, heading, add/remove a point, tone, table borders — MUST call a tool. Exact phrase/date/name swap → propose_patch_proposal_document_text with find copied verbatim from visible text. Table borders/gridlines → propose_patch_proposal_document_text with tableBorders true to add or false to remove. Rewrite/expand a heading or topic that matches openProposalSections → propose_rewrite_proposal_section (sectionKey from that list + instruction). Exact paste of a section heading/body → propose_patch_proposal_section. Full regenerate → propose_personalize_proposal. Do not ask them to name a heading if visible text already contains the mention. Never claim the document is updated without a tool. Logo/hero/footer image swap → propose_update_document_asset (assetId logo|footer|hero + imageUrl). Delete via propose_delete_proposal after a natural confirm.
- Proposals are deal *documents* (not quotes, not the propose stage). On deal detail use openDeal.id; otherwise knownDeals / sessionMemory.slots.dealId.
  **Requirement source:** wait for the user to attach a BRD (PDF, Word, or text) in the
  composer and press Enter.
  If Context has no requirementPdfAttached, do NOT call propose_create_proposal yet —
  ask them to attach the BRD with the paperclip and press Enter. Do not tell them
  to type the word generate.
  If Context includes requirementPdfAttached, call propose_create_proposal immediately
  (the user already sent the file). Do NOT ask which products. productHint may be
  the filename. Server-side extract uses the attached file plus meeting notes.
  A send with the file attached (even an empty message or “use this file”) means create now.
  Do not say the proposal is drafted until propose_create_proposal succeeds.
- Quotes on a deal are generated from a source, the same way a proposal is.
  Sources are an existing proposal on this deal (dealProposals) or a BRD
  attached with the paperclip. Do not open a product / plan / quantity form
  and do not call set_workspace create_quote, patch_quote_draft, or
  propose_create_quote until the user names one of those sources.
  If they say create/draft a quote and there is no requirementPdfAttached and
  they have not named a proposal, ask once: use one of the proposals in
  dealProposals (number and title), or attach a BRD and press Enter.
  If dealProposals is empty, say there is no proposal on this deal yet and
  ask for the BRD. If they ask what proposals exist, answer only from
  dealProposals — never say you have no list when that field is present.
  When they name a proposal, call propose_create_quote with dealId=openDeal.id
  and proposalId from dealProposals. When requirementPdfAttached is set and
  they are creating a quote, call propose_create_quote with dealId=openDeal.id
  and source=brd. Do not ask which product. Do not invent line items.
- Calendar: /sales/calendar. Quotes: /sales/quotes.
""".strip()
    + "\n\nDeal specialist contract (authoritative agent.md):\n"
    + DEAL_AGENT_PROMPT,
    "company": """
Module: Companies — conversational company + location.
- Creating: patch_company_draft with every required field the user already stated.
  Name and location name belong in the same patch when both are in the message.
  A city (Hyderabad, Mumbai, Bengaluru) is locationName — never copy it into locationAddress.
  Required before save: name + locationName. Address, location type, domain, industry,
  employee count, and LinkedIn are optional and must not block save.
- "Add a domain/industry/name/owner/channel" without "new company" means UPDATE — not create.
- Renaming: propose_update_company with `name` set to ONLY the new name (e.g. "Red Bull"). Never include "rename", "company name to", or other instruction wording in the name arg.
- If they pause this company to create a contact, deal, or other record instead, navigate to that create href — do not write that intent into the company name.
- Detail page create = add a location (patch_location_draft).
- Customer email: as soon as you know what it is about, call compose_customer_email with their instruction and the contact they named (contactId, contactName, companyName, to=every email stored on that contact). Put durableMemory prefs and tone into that instruction. Do not write the subject or body in your reply, and do not ask whether to save. Then propose_save_email_draft in that same turn with the returned subject and body, auto=true. The draft card is the preview. Your reply is one short sentence. A wording change is compose_customer_email again with currentSubject and currentBody from emailDraft, then propose_save_email_draft. A change only to recipients or the subject is propose_save_email_draft with the other fields copied from emailDraft. Send now in the same request is also propose_send_email auto=true. A later time is propose_schedule_email with sendAt as an ISO datetime from now=, auto=true. Ask for an email only when that contact's emails are empty. Never invent an address. To is only that contact's emails unless they name a different address. Send uses the addresses on the draft card. Context emailDraft is the current draft. Pass currentSubject and currentBody into compose only when they asked to change the wording. Sending it is propose_send_email with that subject, body, and to.
- Walk optional fields one at a time after the company exists. When name and locationName are both set — including on the turn that supplied the last one — call propose_create_company in that same turn. Do not ask "shall I save?" and do not list remaining optional fields.
- The save/create tool runs after you reply — it has not happened yet and can still fail (e.g. a company with that name already exists). Say "Saving **name** now" or "One sec, saving that" — never "is saved", "has been created", or any past-tense confirmation before the tool result is known.
- If a company you tried to save already exists, do not retry propose_create_company with the same name and do not claim you "opened" anything — the app handles the duplicate and opens the existing record. Just acknowledge briefly if asked.
""".strip(),
    "product": """
Module: Products — create and edit in chat; collect the same fields as the product form.
- Creating (one question at a time). Follow productWalk in Context for THIS org's
  businessType. Same catalog table; do not ask the other motion's fields.
  B2B: never ask or patch brand or stockOnHand.
  B2C: never ask or patch productType, billingType, billingFrequency, maxDiscountPercent,
  offers, or addons (those default to fixed / one-time).
  B2B2C: quote fields then brand then stockOnHand.
  Never mark ready after name alone (need name + sku). Never ask per-seat/per-usage billing.
- Apply patch_product_draft for every volunteered field (including offers/addons arrays
  only when this motion allows them).
  Keep the workspace draft in sync — patch every answer before asking the next field.
- "Add a price/sku" without "new product" means UPDATE — not create.
- On list or detail, propose_update_product for field changes; propose_delete_product after a natural confirm.
- If they pause this product to create a contact/company/deal instead, navigate to that create href — do not write that intent into the product name.
- NEVER ask "ready to save?" / "shall I save?" while guided fields remain.
  Keep asking the next field or accept skip. Name+SKU is enough for the *user* to
  say save — only then propose_create_product. After the full walk (or skip remaining), one short
  recap + save offer is OK.
""".strip(),
    "finance": """
Module: Finance / invoices — deal-first, form-parity collection.
- Creating: link a deal (required), then product + quantity (required for a real line — never invent
  a silent first-product qty 1). Ask issue/due dates, billing address, tax id, discount, currency,
  notes/payment terms when relevant. Use patch_invoice_draft for each field including productId,
  quantity, addonQuantities, issueDate, dueDate.
- On invoice detail (entityId / openInvoice): already tied to openInvoice.dealTitle — never ask which deal. "send / email this invoice" → propose_send_invoice. Draft/sent invoices can change line items (products, qty, discount) AND notes/payment terms via propose_update_invoice. Pass `lines` as one object per product from knownProducts (productId + quantity). Set discountPct to 0 when they say no discount. Never tell the user line items cannot be changed on a draft invoice. Paid invoices: notes/terms only. "mark paid" → propose_mark_invoice_paid. Delete via propose_delete_invoice after a natural confirm. Never start a new invoice draft or call patch_invoice_draft on detail.
- Field-only language on the list without "new invoice" → clarify which invoice or ask if they want to create one.
- Recap deal + product/qty (+ dates if set) then propose_create_invoice when they agree. Open create workspace if not already there.
""".strip(),
    "quotes": """
Module: Quotes — deal → product → qty in conversation.
- Creating: deal first (by title), then product / plan, then quantity/discount, then addonQuantities
  when the product is customizable. Optional notes/customer/company/vendor names.
- Speak about deals and products by name only — never paste IDs into chat.
- knownDeals / knownProducts list real catalog entries. When the user names a
  deal or product, call patch_quote_draft with the matching id from that list
  (closest fuzzy match is fine — do not demand an exact character-for-character
  title). Only ask_clarification when two catalog entries are equally plausible.
- Never invent a deal/product name that is not in knownDeals/knownProducts, and
  never claim a listed deal "isn't found".
- A sales **proposal** (document) is NOT a quote. If the user asks to create /
  draft a proposal, call navigate to /sales with their utterance as seedPrompt
  — do not start or continue a quote draft.
- On quote detail (entityId / openQuote): this quote is already tied to
  openQuote.dealTitle. Never ask which deal. "send / email this quote" →
  propose_send_quote with openQuote.id. Draft/sent quotes can change line items
  (products, qty, quote discount) AND notes/customer/company/vendor via
  propose_update_quote. Document sections (introduction, bank, terms, payment,
  delivery, …) live in openQuote.documentSections — use propose_update_quote with
  documentSections when the user gives exact text; use propose_rewrite_quote_section
  when they want AI rewrite/tone; use propose_update_document_asset for logo/hero/footer
  (assetId logo|footer|hero + imageUrl). Section headings = section title field.
  Pass `lines` as one object per product from knownProducts (productId + quantity).
  Set discountPct to 0 when they say no discount. Never tell the user line items
  cannot be changed on a draft quote. Accepted quotes: notes/names only. Delete
  via propose_delete_quote after a natural confirm. Never start a new quote draft
  or call patch_quote_draft on detail. When they confirm ("yes", "save it"), call
  the matching propose_* tool with auto — do not only reply that you are saving.
- Field-only language on the list without "new quote" → clarify or ask if they want to create one.
- When ready, recap (deal title + product) and ask to save → propose_create_quote.
""".strip(),
    "activities": """
Module: Activities — contact → type → subject → due → notes.
- When currentDraft.contactId, catalog.openContact, or openDeal.contactId is already set, that person is chosen — never say they are missing from CRM, never ask to create them, and never re-ask who the activity is for. Continue with type, subject, due, notes, or propose_create_activity when ready.
- "For this deal" / scheduling on a deal handoff: use openDeal.contactId (and openContact) via patch_activity_draft — do not search by name again.
- Logging without a chosen contact: ask who it is for once. Do NOT default type to note.
- "Schedule a demo/meeting/call for <name>" means that person should already be in Contacts. Match knownContacts or call lookup_contacts. Set type to meeting for a demo/meeting (call for a call). Do not navigate to /contact/new. Only if no contact is chosen and lookup_contacts returns nobody, say you could not find them and ask whether to create a contact — do not invent a contactId.
- After the contact: ask type only when they have not already named one. They can skip.
- Then subject (required). Due date and notes are optional — accept skip.
- Never treat "yes" as a subject while contact or type is still open.
- When contact + subject are ready and remaining optionals are filled or skipped, recap and ask to save → propose_create_activity.
- Schedule handoffs and seed prompts may include contact, type, subject, and due together — call patch_activity_draft once with every known field in that same turn.
""".strip(),
    "dashboard": """
Module: Dashboard coworker chat.
- Dashboard has no create form. Creating a contact, company, deal, product, quote,
  invoice/finance record, or activity MUST call navigate THIS turn to /contact/new,
  /company/new, /sales/new, /product/new, /sales/quotes/new, /finance/new, or
  /activities/log with seedPrompt of the user's message — even if the noun is
  misspelled ("procduct", "finacnce", "compnay", ...), infer the intended module
  from context and navigate; never ask a clarifying question about *what* they
  meant just because a word was misspelled. Do not interview for those fields
  on the dashboard.
- Greetings, thanks, and small talk: reply warmly in chat only — do NOT invent metrics or run reports.
- CRM metrics (pipeline, win rate, revenue, counts, how many, why / root-cause analytics): do NOT
  answer from memory or legacy semantic tools. The native coworker routes those to
  reports-analytics-agent (warehouse + knowledge graph). Navigate to /reports when they want the
  Reports module UI.
- Never use set_workspace on Dashboard.
""".strip(),
    "reports": """
Module: Reports / analytics chat.
- Metric, KPI, and analytical questions are handled by reports-analytics-agent (certified warehouse KPIs
  and KG templates). Summarize only grounded results; never expose SQL/Cypher.
- For greetings, thanks, help, or general chat: reply conversationally — do NOT invent numbers.
- Use navigate when they ask to open a Reports view in the UI.
""".strip(),
}

# Shared block imported by draft agents so native + draft tone stay aligned.
CONVERSATIONAL_SHARED = f"""Conversational rules (all modules):
- {PROMPT_ROLE}
- Ask at most ONE clarifying question, and only when a required slot is missing.
- Prefer tools when slots are filled — never coach "say create", "type yes", "say skip", "click Create", or "ask again".
- On contact create: honor sessionMemory.pendingAsk (contact_phone, contact_company, …) and
  sessionMemory.slots.skippedOptional — never re-ask a skipped optional field.
- Sound like a helpful colleague: warm, clear, briefly human. Not a form wizard or ticket bot.
- Always acknowledge what they just said in plain language, then ask the next useful question or confirm the action.
- Vary your wording — do not repeat the same "Got it — X. What's X's Y?" pattern every turn.
- Never phrase requests as form labels. Correct: "Could you share their email?" Incorrect: "Email:".
- If they volunteer several fields at once, accept them all and only ask for what's still missing.
- Create vs update: field-only language means UPDATE; create only for a clearly NEW record.
- When the draft is ready, short recap then "Shall I save…?" — never magic words. Write that recap in plain words, for example Name: Pooja, Email: ada@acme.com. Never use markdown asterisks.
- Never mention opening create, the workspace, the right pane, or "pulling in" what they shared.
- Never show database IDs to the user. Keep replies to 1–2 short spoken sentences.
- Guardrails:
{PROMPT_GUARDRAILS}
""".strip()


# Coworker tool schemas live in app.mcp.catalog (in-process FastMCP). Do not redefine them here.

IN_SHELL_MODULES = frozenset(
    {"contact", "sales", "company", "product", "finance", "quotes", "activities"}
)

# Modules that use the native-tools LLM path (all AgentModuleShell modules).
NATIVE_MODULES = frozenset(
    {
        "contact",
        "sales",
        "company",
        "product",
        "finance",
        "quotes",
        "activities",
        "dashboard",
        "inbox",
        "reports",
        "agents",
        "commerce",
        "service",
        "configuration",
        "marketing",
        "process-approvals",
    }
)

SEO_PATH_ADDON = """
Module: Marketing → Digital Marketing — Keywords, Content, Social Media.
- Keyword metrics: call seo_research_keywords (Semrush for the seed when configured; LLM related terms and fallback). Never invent extra volumes in chat.
- Content: seo_save_generated_content requires keywordQueryId from that research. body.blog.markdown required.
- Social: call seo_repurpose_social with contentId (captions written inside the tool if posts omitted). Gemini images. No Semrush. Do not ask for a keyword seed.
- Schedule/publish: seo_schedule_post / seo_publish_post. LinkedIn is the member Posts API (MyAccounts scopes openid, profile, w_member_social). Missing tokens → connect/reauth, still save.
- After tools, reply in chat. Point to Keywords | Content | Social Media on the right.
""".strip()


def _load_agent_md(folder: str) -> str:
    path = Path(__file__).resolve().parent / folder / "agent.md"
    try:
        text = path.read_text(encoding="utf-8").strip()
    except OSError:
        return ""
    return text or ""


def is_hub_execute(ctx: dict[str, Any] | None) -> bool:
    from app.a2a.payload import is_hub_execute as _hub

    return _hub(ctx)


def _requirement_pdf_attached(ctx: dict[str, Any] | None) -> bool:
    """True when chat context carries an attached requirement file."""
    from app.agents.deal_coworker_agent import _requirement_pdf_name

    return bool(_requirement_pdf_name(ctx if isinstance(ctx, dict) else None))


def build_system_prompt(mod: str, surface: str, ctx: dict[str, Any]) -> str:
    """Assemble the coworker system prompt in fixed section order.

    Role → Goal → Instructions → Context → Output → Guardrails
    """
    hub = is_hub_execute(ctx)
    pathname = str(ctx.get("pathname") or "")
    if hub:
        addon = (
            "Hub execute mode: complete the delegated skill with tools this turn. "
            "Never ask a clarifying question."
        )
    elif "/marketing/seo" in pathname:
        addon = _load_agent_md("seo-content-generator") or SEO_PATH_ADDON
    elif mod in MODULE_ADDONS:
        addon = MODULE_ADDONS[mod].strip()
    elif mod in IN_SHELL_MODULES:
        addon = "Help the user navigate or create in the right module."
    else:
        addon = (
            "This page has no in-shell create. Use navigate to open the right "
            "module, or ask_clarification if unsure. Never call set_workspace."
        )

    from app.agents.org_clock import local_now_line

    context_lines = [
        f"- module={mod or 'crm'}",
        f"- surface={surface or 'list'}",
        f"- pathname={ctx.get('pathname') or ''}",
        f"- entityId={ctx.get('entityId') or ''}",
        local_now_line(ctx),
        "- nameRule=Fill every name, title, and label with the human name. "
        "Never put an id, UUID, CUID, or bare number in companyName, contactName, "
        "customerName, vendorName, locationName, title, firstName, lastName, or a "
        "product name. *Id fields are catalog ids only, and each one is paired with "
        "that row's name.",
    ]
    if hub:
        context_lines.append("- source=hub")
        context_lines.append("- hubExecute=true (Hub will not reply; execute now)")
        if ctx.get("skillId"):
            context_lines.append(f"- skillId={ctx.get('skillId')}")
    cat_early = ctx.get("catalog") if isinstance(ctx.get("catalog"), dict) else {}
    business_type = str(
        ctx.get("businessType")
        or ctx.get("business_type")
        or (cat_early.get("businessType") if isinstance(cat_early, dict) else "")
        or ""
    ).strip()
    if business_type:
        context_lines.append(f"- businessType={business_type}")
    if (mod or "") == "product":
        from app.agents.draft_conversation import product_walk_instruction

        context_lines.append(
            f"- productWalk={product_walk_instruction(business_type)}"
        )
    # Resolved once, outside the currentDraft block below, so an empty/fresh
    # draft (e.g. a brand-new quote before any field is set) still gets a
    # real catalog to search — otherwise the model has no way to turn "the
    # yaswanth deal" or "crm ticketing" into a real id and either guesses one
    # (silently wrong) or never patches it at all.
    deals = ctx.get("deals") if isinstance(ctx.get("deals"), list) else []
    if not deals:
        cat = ctx.get("catalog")
        if isinstance(cat, dict) and isinstance(cat.get("deals"), list):
            deals = cat["deals"]
    products = ctx.get("products") if isinstance(ctx.get("products"), list) else []
    if not products:
        cat = ctx.get("catalog")
        if isinstance(cat, dict) and isinstance(cat.get("products"), list):
            products = cat["products"]
    contacts = ctx.get("contacts") if isinstance(ctx.get("contacts"), list) else []
    if not contacts:
        cat = ctx.get("catalog")
        if isinstance(cat, dict) and isinstance(cat.get("contacts"), list):
            contacts = cat["contacts"]
    cat_for_ctx = ctx.get("catalog") if isinstance(ctx.get("catalog"), dict) else {}
    open_contact_ctx = (
        cat_for_ctx.get("openContact")
        if isinstance(cat_for_ctx.get("openContact"), dict)
        else None
    )

    draft = ctx.get("draft")
    if isinstance(draft, dict) and draft:
        # Prefer human labels in the prompt; keep ids only for tool patches.
        labeled = dict(draft)
        deal_id = str(labeled.get("dealId") or "").strip()
        if deal_id:
            match = next(
                (
                    d
                    for d in deals
                    if isinstance(d, dict) and str(d.get("id")) == deal_id
                ),
                None,
            )
            if match and (match.get("title") or match.get("name")):
                labeled["dealTitle"] = match.get("title") or match.get("name")
        product_id = str(labeled.get("productId") or "").strip()
        if product_id:
            match = next(
                (
                    p
                    for p in products
                    if isinstance(p, dict) and str(p.get("id")) == product_id
                ),
                None,
            )
            if match and match.get("name"):
                labeled["productName"] = match["name"]
        contact_id = str(labeled.get("contactId") or "").strip()
        if contact_id:
            contact_match = None
            if isinstance(open_contact_ctx, dict) and str(
                open_contact_ctx.get("id") or ""
            ).strip() == contact_id:
                contact_match = open_contact_ctx
            if not contact_match:
                contact_match = next(
                    (
                        c
                        for c in contacts
                        if isinstance(c, dict) and str(c.get("id")) == contact_id
                    ),
                    None,
                )
            if contact_match:
                labeled["contactName"] = (
                    contact_match.get("displayName")
                    or contact_match.get("contactName")
                    or contact_match.get("name")
                )
                if contact_match.get("email"):
                    labeled["contactEmail"] = contact_match.get("email")
        context_lines.append(
            f"- currentDraft={json.dumps(labeled, default=str)[:1500]}"
        )
        context_lines.append(
            "- speakRule=Use titles and names in chat and in every name field. "
            "Never paste raw id values to the user or into a name field."
        )
    stm = ctx.get("sessionMemory")
    if isinstance(stm, dict) and (
        stm.get("pendingIntent")
        or stm.get("pendingAsk")
        or (stm.get("slots") or {})
        or (stm.get("lastEntities") or {})
    ):
        context_lines.append(
            f"- sessionMemory={json.dumps(stm, default=str)[:800]}"
        )
        context_lines.append(
            "- memoryRule=sessionMemory is the live task. save/yes/ok saves that "
            "pendingIntent. Do not open another module unless the latest message "
            "names a different record."
        )
        slots = stm.get("slots") if isinstance(stm.get("slots"), dict) else {}
        email_draft = slots.get("emailDraft") if isinstance(slots, dict) else None
        if isinstance(email_draft, dict) and email_draft.get("subject"):
            context_lines.append(
                "- emailDraft="
                + json.dumps(
                    {
                        "draftId": email_draft.get("draftId"),
                        "to": email_draft.get("to"),
                        "subject": email_draft.get("subject"),
                        "body": email_draft.get("body"),
                        "contactId": email_draft.get("contactId"),
                        "scheduleId": email_draft.get("scheduleId"),
                        "sendAt": email_draft.get("sendAt"),
                        "status": email_draft.get("status"),
                    },
                    default=str,
                )[:2500]
            )
            context_lines.append(
                "- emailDraftRule=This draft is already saved in Inbox and shown as a card. "
                "Do not paste the subject or body in your reply. "
                "Their latest message is the only change. Copy subject, body, and to "
                "except for the part they asked to change. "
                "Sending is propose_send_email with these fields. Do not compose for a send. "
                "A later time is propose_schedule_email. "
                "A wording change is compose_customer_email with currentSubject and "
                "currentBody from this draft, then propose_save_email_draft with draftId. "
                "A change to recipients or the subject is propose_save_email_draft "
                "with the other fields copied. Pass to as an array of email addresses, "
                "one address per item."
            )
    companies = ctx.get("companies")
    if isinstance(companies, list) and companies:
        from app.agents.deal_draft_agent import human_name

        names = [
            str(c.get("name"))
            for c in companies[:30]
            if isinstance(c, dict) and human_name(str(c.get("name") or ""))
        ]
        if names:
            context_lines.append(f"- knownCompanies={', '.join(names)[:800]}")

    if mod in ("quotes", "sales"):
        if deals:
            deal_lines = [
                f"{d.get('title') or d.get('name')}"
                f"{(' / ' + str(d['companyName'])) if d.get('companyName') else ''}"
                f"{(' / ' + str(d['contactName'])) if d.get('contactName') else ''}"
                f" => id:{d.get('id')}"
                for d in deals[:40]
                if isinstance(d, dict) and d.get("id") and (d.get("title") or d.get("name"))
            ]
            if deal_lines:
                context_lines.append(
                    f"- knownDeals (title/company/contact => id)={' | '.join(deal_lines)[:2400]}"
                )
        if products:
            product_lines = [
                f"{p.get('name')}"
                f"{' (sku ' + str(p['sku']) + ')' if p.get('sku') else ''}"
                f" => id:{p.get('id')}"
                for p in products[:40]
                if isinstance(p, dict) and p.get("id") and p.get("name")
            ]
            if product_lines:
                context_lines.append(
                    f"- knownProducts (name => id)={' | '.join(product_lines)[:2000]}"
                )
        pdf_att = ctx.get("requirementPdfAttached")
        if isinstance(pdf_att, dict) and (
            str(pdf_att.get("name") or "").strip() or pdf_att.get("attached")
        ):
            pdf_name = str(pdf_att.get("name") or "requirement.pdf").strip()
            context_lines.append(
                f"- requirementPdfAttached={{name:{pdf_name}}} "
                "(requirement file already in chat — call propose_create_proposal "
                "now; do not ask which products; do not claim you cannot read the file)"
            )
        elif pdf_att is True:
            context_lines.append(
                "- requirementPdfAttached=true "
                "(requirement file already in chat — call propose_create_proposal "
                "now; do not ask which products; do not claim you cannot read the file)"
            )
        elif mod == "sales" and (surface or "") != "detail":
            context_lines.append(
                "- requirementPdfAttached=missing "
                "(no BRD in chat — do NOT call propose_create_proposal; ask them "
                "to attach the BRD with the paperclip and press Enter)"
            )
        elif mod == "sales" and (surface or "") == "detail" and not isinstance(
            (ctx.get("catalog") or {}).get("openProposal"), dict
        ):
            context_lines.append(
                "- requirementPdfAttached=missing "
                "(no BRD in chat — do NOT call propose_create_proposal; ask them "
                "to attach the BRD with the paperclip and press Enter)"
            )
        if mod == "quotes" and (surface or "") == "create":
            context_lines.append(
                "- idRule=patch_quote_draft dealId/productId must be one of the ids "
                "listed above, copied exactly. Never invent an id. If nothing in "
                "knownDeals/knownProducts matches well, call ask_clarification "
                "instead of patching a guess."
            )
        if mod == "quotes" and (surface or "") == "detail":
            cat = ctx.get("catalog") if isinstance(ctx.get("catalog"), dict) else {}
            open_quote = cat.get("openQuote") if isinstance(cat, dict) else None
            if isinstance(open_quote, dict) and open_quote.get("id"):
                context_lines.append(
                    "- openQuote="
                    + json.dumps(
                        {
                            "id": open_quote.get("id"),
                            "number": open_quote.get("number"),
                            "dealTitle": open_quote.get("dealTitle"),
                            "status": open_quote.get("status"),
                        },
                        default=str,
                    )[:500]
                )
            context_lines.append(
                "- openQuoteRule=Already linked to openQuote.dealTitle. "
                "Never ask which deal. Send → propose_send_quote; "
                "edit lines → propose_update_quote. Do not patch_quote_draft."
            )
        cat_for_contact = (
            ctx.get("catalog") if isinstance(ctx.get("catalog"), dict) else {}
        )
        open_for_deal = (
            cat_for_contact.get("openContact")
            if isinstance(cat_for_contact, dict)
            else None
        )
        if (
            mod == "sales"
            and isinstance(open_for_deal, dict)
            and open_for_deal.get("id")
        ):
            open_company = (
                cat_for_contact.get("openCompany")
                if isinstance(cat_for_contact, dict)
                else None
            )
            context_lines.append(
                "- openContact="
                + json.dumps(
                    {
                        "id": open_for_deal.get("id"),
                        "displayName": open_for_deal.get("displayName"),
                        "contactName": open_for_deal.get("displayName"),
                        "companyName": open_for_deal.get("companyName"),
                        "companyId": open_for_deal.get("companyId"),
                        "email": open_for_deal.get("email"),
                        "emails": open_for_deal.get("emails"),
                        "locationId": open_for_deal.get("locationId"),
                    },
                    default=str,
                )[:800]
            )
            if isinstance(open_company, dict) and open_company.get("name"):
                context_lines.append(
                    "- openCompany="
                    + json.dumps(
                        {
                            "id": open_company.get("id"),
                            "name": open_company.get("name"),
                        },
                        default=str,
                    )[:300]
                )
            context_lines.append(
                "- openContactRule=This deal is for the contact already open. "
                "Company and contact are known. Call patch_deal_draft with "
                "companyName, companyId, contactName, contactId, and locationId "
                "from openContact and openCompany. Do not ask which company or "
                "which contact."
            )
        if mod == "sales" and (surface or "") == "detail":
            cat = ctx.get("catalog") if isinstance(ctx.get("catalog"), dict) else {}
            open_prop = cat.get("openProposal") if isinstance(cat, dict) else None
            open_deal = cat.get("openDeal") if isinstance(cat, dict) else None
            if isinstance(open_prop, dict) and open_prop.get("id"):
                context_lines.append(
                    "- openProposal="
                    + json.dumps(
                        {
                            "id": open_prop.get("id"),
                            "number": open_prop.get("number"),
                            "dealTitle": open_prop.get("dealTitle"),
                            "dealId": open_prop.get("dealId"),
                            "status": open_prop.get("status"),
                        },
                        default=str,
                    )[:500]
                )
                sections = open_prop.get("sections")
                if isinstance(sections, list) and sections:
                    slim = [
                        {
                            "key": item.get("key"),
                            "title": item.get("title"),
                        }
                        for item in sections[:16]
                        if isinstance(item, dict)
                    ]
                    if slim:
                        context_lines.append(
                            "- openProposalSections="
                            + json.dumps(slim, default=str)[:2000]
                        )
                visible = str(open_prop.get("visibleText") or "").strip()
                if visible:
                    context_lines.append(
                        "- openProposalVisibleText=" + visible[:10000]
                    )
                context_lines.append(
                    "- openProposalRule=Already linked to openProposal.dealTitle. "
                    "Never ask which deal. Send/share → propose_send_proposal; "
                    "product update → propose_personalize_proposal with productIds."
                )
                context_lines.append(
                    "- openProposalEditRule="
                    "Visible document is openProposalVisibleText. Any change the user "
                    "mentions MUST call a tool now. Phrase/date/name/sentence swap → "
                    "propose_patch_proposal_document_text with find copied verbatim from "
                    "visible text (expand abbreviated dates to the on-page format). "
                    "Rewrite/expand/tone of a heading or topic in openProposalSections → "
                    "propose_rewrite_proposal_section with that sectionKey and the user's "
                    "instruction. Bold/italic: wrap the on-page word with <strong> or <em> "
                    "in replace — never markdown asterisks like **Fincity**. "
                    "Add bullets/numbering: reformat the existing section body only — do not "
                    "regenerate or replace the content. Use opening prose, '## Title Case' "
                    "subheads, and '- ' bullets — never ALL-CAPS shout lines as paragraphs. "
                    "Add table borders/gridlines → propose_patch_proposal_document_text with "
                    "tableBorders true. Remove/clear table borders → the same tool with "
                    "tableBorders false. Never add borders when the user asked to remove them. "
                    "Do not ask them to name a heading if visible text already "
                    "contains the mention. Never claim the document is updated without a tool."
                )
            else:
                entity = str(ctx.get("entityId") or "").strip()
                if not (
                    isinstance(open_deal, dict) and str(open_deal.get("id") or "").strip()
                ):
                    match = next(
                        (
                            d
                            for d in deals
                            if isinstance(d, dict) and str(d.get("id") or "") == entity
                        ),
                        None,
                    )
                    open_deal = match if isinstance(match, dict) else (
                        {"id": entity} if entity else None
                    )
                if isinstance(open_deal, dict) and open_deal.get("id"):
                    context_lines.append(
                        "- openDeal="
                        + json.dumps(
                            {
                                "id": open_deal.get("id"),
                                "title": open_deal.get("title") or open_deal.get("name"),
                                "stage": open_deal.get("stage"),
                                "companyName": open_deal.get("companyName"),
                                "contactName": open_deal.get("contactName"),
                            },
                            default=str,
                        )[:500]
                    )
                context_lines.append(
                    "- openDealRule=This page is the open deal (entityId / openDeal). "
                    "Never ask which deal. Create/draft proposal uses dealId=openDeal.id "
                    "(or entityId). Wait for requirementPdfAttached before "
                    "propose_create_proposal; then call it with that dealId. "
                    "Create/draft a quote only from dealProposals (proposalId) or an "
                    "attached BRD (source=brd). Do not open a product form first."
                )
                deal_props = cat.get("dealProposals") if isinstance(cat, dict) else None
                if isinstance(deal_props, list):
                    slim_props = [
                        {
                            "id": item.get("id"),
                            "number": item.get("number"),
                            "title": item.get("title"),
                            "status": item.get("status"),
                        }
                        for item in deal_props[:12]
                        if isinstance(item, dict) and item.get("id")
                    ]
                    context_lines.append(
                        "- dealProposals="
                        + json.dumps(slim_props, default=str)[:2000]
                    )
        if mod == "sales":
            owners = (
                cat_for_contact.get("assignableUsers")
                if isinstance(cat_for_contact, dict)
                else None
            )
            can_assign = (
                cat_for_contact.get("canAssignOwner")
                if isinstance(cat_for_contact, dict)
                else None
            )
            if can_assign is True and isinstance(owners, list) and owners:
                owner_lines = [
                    f"{u.get('label')} => id:{u.get('id')}"
                    for u in owners[:40]
                    if isinstance(u, dict) and u.get("id") and u.get("label")
                ]
                if owner_lines:
                    context_lines.append(
                        "- assignableOwners (name => id)="
                        + " | ".join(owner_lines)[:2000]
                    )
                context_lines.append("- canAssignOwner=true")
                context_lines.append(
                    "- ownerRule=Reassign the open deal with "
                    "propose_reassign_deal_owner (dealId=entityId, ownerUserId from "
                    "assignableOwners). If they did not name the new owner, ask who "
                    "once, then call the tool. Do not say you cannot change the owner."
                )
            elif can_assign is False:
                context_lines.append("- canAssignOwner=false")
                context_lines.append(
                    "- ownerRule=Only an admin or sales manager can reassign a deal "
                    "owner. Say that. Do not ask who should take over."
                )
    if mod == "contact" and (surface or "") == "detail":
        cat = ctx.get("catalog") if isinstance(ctx.get("catalog"), dict) else {}
        open_c = cat.get("openContact") if isinstance(cat, dict) else None
        open_co = cat.get("openCompany") if isinstance(cat, dict) else None
        open_loc = (
            cat.get("openCompanyLocation") if isinstance(cat, dict) else None
        )
        eid = str(ctx.get("entityId") or "").strip()
        if isinstance(open_c, dict) and open_c.get("id"):
            contact_emails = _contact_emails_from_open(open_c)
            context_lines.append(
                "- openContact="
                + json.dumps(_open_contact_context_dict(open_c), default=str)[:1400]
            )
            context_lines.append(
                "- contactEmails="
                + (", ".join(contact_emails) if contact_emails else "(none)")
            )
            context_lines.append(
                "- contactEmailRule=These are the To addresses on this contact. "
                "When contactEmails lists an address, use it and do not ask for one. "
                "Ask for an email only when contactEmails=(none)."
            )
        elif eid:
            context_lines.append(f"- openContactId={eid}")
        if isinstance(open_co, dict) and open_co.get("id"):
            context_lines.append(
                "- openCompany="
                + json.dumps(
                    {
                        "id": open_co.get("id"),
                        "name": open_co.get("name"),
                        "domain": open_co.get("domain"),
                        "industry": open_co.get("industry"),
                        "employeeCount": open_co.get("employeeCount"),
                        "linkedinUrl": open_co.get("linkedinUrl"),
                    },
                    default=str,
                )[:600]
            )
        if isinstance(open_loc, dict) and open_loc.get("id"):
            context_lines.append(
                "- openCompanyLocation="
                + json.dumps(
                    {
                        "id": open_loc.get("id"),
                        "name": open_loc.get("name"),
                        "city": open_loc.get("city"),
                        "address": open_loc.get("address"),
                        "type": open_loc.get("type"),
                    },
                    default=str,
                )[:400]
            )
        context_lines.append(
            "- openContactRule=This workspace IS this person (entityId). "
            "Person fields (title, email, phone, city on the person, …) → "
            "propose_update_contact with contactId=entityId (or openContact.id), "
            "auto=true. Do NOT ask which contact when entityId is set."
        )
        context_lines.append(
            "- openCompanyRule=Their employer is openCompany when present. "
            "Never ask which company when openCompany.id is set. "
            "Company profile (name, domain, industry, …) → propose_update_company "
            "with companyId=openCompany.id, auto=true. "
            "Company office / location (city, address, site name) → "
            "propose_update_company_location with companyId=openCompany.id, "
            "locationId=openCompanyLocation.id when present, and the new "
            "city/address/name, auto=true. If openCompanyLocation is missing, "
            "still call propose_update_company_location with companyId and city."
        )
    if mod == "finance" and (surface or "") == "detail":
        cat = ctx.get("catalog") if isinstance(ctx.get("catalog"), dict) else {}
        open_inv = cat.get("openInvoice") if isinstance(cat, dict) else None
        if isinstance(open_inv, dict) and open_inv.get("id"):
            context_lines.append(
                "- openInvoice="
                + json.dumps(
                    {
                        "id": open_inv.get("id"),
                        "number": open_inv.get("number"),
                        "dealTitle": open_inv.get("dealTitle"),
                        "status": open_inv.get("status"),
                    },
                    default=str,
                )[:500]
            )
        context_lines.append(
            "- openInvoiceRule=Already linked to openInvoice.dealTitle. "
            "Never ask which deal. Send → propose_send_invoice; "
            "edit lines → propose_update_invoice. Do not patch_invoice_draft."
        )
    if mod == "sales" and (surface or "") == "detail":
        cat = ctx.get("catalog") if isinstance(ctx.get("catalog"), dict) else {}
        open_prop = cat.get("openProposal") if isinstance(cat, dict) else None
        open_deal = cat.get("openDeal") if isinstance(cat, dict) else None
        if isinstance(open_prop, dict) and open_prop.get("id"):
            context_lines.append(
                "- openProposal="
                + json.dumps(
                    {
                        "id": open_prop.get("id"),
                        "number": open_prop.get("number"),
                        "dealTitle": open_prop.get("dealTitle"),
                        "dealId": open_prop.get("dealId"),
                        "status": open_prop.get("status"),
                    },
                    default=str,
                )[:500]
            )
            sections = open_prop.get("sections")
            if isinstance(sections, list) and sections:
                slim = [
                    {
                        "key": item.get("key"),
                        "title": item.get("title"),
                    }
                    for item in sections[:16]
                    if isinstance(item, dict)
                ]
                if slim:
                    context_lines.append(
                        "- openProposalSections="
                        + json.dumps(slim, default=str)[:2000]
                    )
            visible = str(open_prop.get("visibleText") or "").strip()
            if visible:
                context_lines.append(
                    "- openProposalVisibleText=" + visible[:10000]
                )
            context_lines.append(
                "- openProposalRule=Already linked to openProposal.dealTitle. "
                "Never ask which deal. Send/share → propose_send_proposal; "
                "product update → propose_personalize_proposal with productIds."
            )
            context_lines.append(
                "- openProposalEditRule="
                "Visible document is openProposalVisibleText. Any change the user "
                "mentions MUST call a tool now. Phrase/date/name/sentence swap → "
                "propose_patch_proposal_document_text with find copied verbatim from "
                "visible text (expand abbreviated dates to the on-page format). "
                "Rewrite/expand/tone of a heading or topic in openProposalSections → "
                "propose_rewrite_proposal_section with that sectionKey and the user's "
                "instruction. Bold/italic: wrap the on-page word with <strong> or <em> "
                "in replace — never markdown asterisks like **Fincity**. "
                "Add bullets/numbering: reformat the existing section body only — do not "
                "regenerate or replace the content. Use opening prose, '## Title Case' "
                "subheads, and '- ' bullets — never ALL-CAPS shout lines as paragraphs. "
                "Add table borders/gridlines → propose_patch_proposal_document_text with "
                "tableBorders true. Remove/clear table borders → the same tool with "
                "tableBorders false. Never add borders when the user asked to remove them. "
                "Do not ask them to name a heading if visible text already "
                "contains the mention. Never claim the document is updated without a tool."
            )
        else:
            entity = str(ctx.get("entityId") or "").strip()
            if not (
                isinstance(open_deal, dict) and str(open_deal.get("id") or "").strip()
            ):
                match = next(
                    (
                        d
                        for d in deals
                        if isinstance(d, dict) and str(d.get("id") or "") == entity
                    ),
                    None,
                )
                open_deal = match if isinstance(match, dict) else (
                    {"id": entity} if entity else None
                )
            if isinstance(open_deal, dict) and open_deal.get("id"):
                context_lines.append(
                    "- openDeal="
                    + json.dumps(
                        {
                            "id": open_deal.get("id"),
                            "title": open_deal.get("title") or open_deal.get("name"),
                            "stage": open_deal.get("stage"),
                            "companyName": open_deal.get("companyName"),
                            "contactName": open_deal.get("contactName"),
                        },
                        default=str,
                    )[:500]
                )
            context_lines.append(
                "- openDealRule=This page is the open deal (entityId / openDeal). "
                "Never ask which deal. Create/draft proposal uses dealId=openDeal.id "
                "(or entityId). Wait for requirementPdfAttached before "
                "propose_create_proposal; then call it with that dealId."
            )
    if mod == "sales":
        if (surface or "") == "detail" and not isinstance(
            (
                (ctx.get("catalog") if isinstance(ctx.get("catalog"), dict) else {})
                or {}
            ).get("openProposal"),
            dict,
        ):
            context_lines.append(
                "- idRule=propose_create_proposal dealId MUST be openDeal.id / "
                "entityId. productIds from knownProducts. Never ask which deal."
            )
        else:
            context_lines.append(
                "- idRule=propose_create_proposal dealId/productIds must come from "
                "knownDeals/knownProducts. Prefer sessionMemory.slots.dealId when set."
            )

    if mod == "product" and products:
        product_lines = [
            f"{p.get('name')}"
            f"{' (sku ' + str(p['sku']) + ')' if p.get('sku') else ''}"
            f" => id:{p.get('id')}"
            for p in products[:40]
            if isinstance(p, dict) and p.get("id") and p.get("name")
        ]
        if product_lines:
            context_lines.append(
                f"- knownProducts (name => id)={' | '.join(product_lines)[:2000]}"
            )

    if mod == "activities":
        if contacts:
            contact_lines = [
                f"{c.get('displayName') or c.get('name')}"
                f"{(' / ' + str(c['email'])) if c.get('email') else ''}"
                f" => id:{c.get('id')}"
                for c in contacts[:60]
                if isinstance(c, dict) and c.get("id")
                and (c.get("displayName") or c.get("name"))
            ]
            if contact_lines:
                context_lines.append(
                    "- knownContacts (name/email => id)="
                    + " | ".join(contact_lines)[:2400]
                )
            context_lines.append(
                "- idRule=patch_activity_draft contactId must be copied from "
                "knownContacts, openContact.id, or openDeal.contactId — never invented."
            )
        open_c_act = (
            cat_for_ctx.get("openContact")
            if isinstance(cat_for_ctx.get("openContact"), dict)
            else None
        )
        open_deal_act = (
            cat_for_ctx.get("openDeal")
            if isinstance(cat_for_ctx.get("openDeal"), dict)
            else None
        )
        if isinstance(open_c_act, dict) and open_c_act.get("id"):
            context_lines.append(
                "- openContact="
                + json.dumps(
                    {
                        "id": open_c_act.get("id"),
                        "displayName": open_c_act.get("displayName"),
                        "email": open_c_act.get("email"),
                        "companyName": open_c_act.get("companyName"),
                    },
                    default=str,
                )[:800]
            )
            context_lines.append(
                "- activityContactRule=This activity is for openContact. "
                "Do not say they are missing from CRM. patch_activity_draft "
                "contactId=openContact.id if not already in currentDraft."
            )
        elif isinstance(draft, dict) and str(draft.get("contactId") or "").strip():
            context_lines.append(
                "- activityContactRule=currentDraft.contactId is already set "
                "(see contactName in currentDraft). Do not re-match by name, "
                "do not ask to create a contact, and do not say they are not in CRM."
            )
        if isinstance(open_deal_act, dict) and open_deal_act.get("id"):
            context_lines.append(
                "- openDeal="
                + json.dumps(
                    {
                        "id": open_deal_act.get("id"),
                        "title": open_deal_act.get("title"),
                        "contactName": open_deal_act.get("contactName"),
                        "contactId": open_deal_act.get("contactId"),
                        "companyName": open_deal_act.get("companyName"),
                    },
                    default=str,
                )[:600]
            )
            context_lines.append(
                "- openDealRule=When they say this deal or schedule for the deal, "
                "use openDeal.contactId for the activity contact — do not ask who."
            )

    durable = ctx.get("durableMemory")
    if not isinstance(durable, dict):
        cat = ctx.get("catalog")
        if isinstance(cat, dict) and isinstance(cat.get("durableMemory"), dict):
            durable = cat["durableMemory"]
    if isinstance(durable, dict) and durable:
        context_lines.append(
            f"- durableMemory={json.dumps(durable, default=str)[:1200]}"
        )
        context_lines.append(
            "- durableMemoryRule=Respect prefs/open asks; use remember_memory / "
            "clear_memory MCP tools to persist or forget (confirmed)."
        )

    goal = HUB_EXECUTE_GOAL if hub else PROMPT_GOAL
    instructions = (
        f"{HUB_EXECUTE_INSTRUCTIONS}\n\n{addon}" if hub else f"{PROMPT_INSTRUCTIONS}\n\n{addon}"
    )
    output = HUB_EXECUTE_OUTPUT if hub else PROMPT_OUTPUT
    guardrails = HUB_EXECUTE_GUARDRAILS if hub else PROMPT_GUARDRAILS
    return "\n\n".join(
        [
            f"Role:\n{PROMPT_ROLE}",
            f"Goal:\n{goal}",
            f"Instructions:\n{instructions}",
            "Context:\n" + "\n".join(context_lines),
            f"Output:\n{output}",
            f"Guardrails:\n{guardrails}",
        ]
    )


def filter_product_openai_tools(
    tools: list[dict[str, Any]],
    business_type: str | None,
) -> list[dict[str, Any]]:
    """Drop motion-wrong properties from product patch/update tool schemas."""
    from app.agents.draft_conversation import product_forbidden_patch_keys

    drop = product_forbidden_patch_keys(business_type)
    if not drop:
        return tools
    names = {"patch_product_draft", "propose_update_product"}
    out: list[dict[str, Any]] = []
    for tool in tools:
        fn = (tool.get("function") if isinstance(tool, dict) else None) or {}
        name = str(fn.get("name") or "")
        if name not in names:
            out.append(tool)
            continue
        cloned = copy.deepcopy(tool)
        params = (cloned.get("function") or {}).get("parameters") or {}
        props = params.get("properties")
        if isinstance(props, dict):
            for key in drop:
                props.pop(key, None)
        desc = str((cloned.get("function") or {}).get("description") or "")
        if drop:
            cloned["function"]["description"] = (
                desc.split(" Collect form fields")[0]
                + " Do not collect "
                + ", ".join(sorted(drop))
                + " for this business type."
            )[:500]
        out.append(cloned)
    return out


# UI captions on the draft card. They are not model turns; leaving them in
# history makes the next reply copy the caption and skip the email tools.
_EMAIL_CARD_CAPTIONS = frozenset(
    {
        "Draft saved. It stays in Inbox Drafts.",
        "Updated draft.",
        "Updated draft. It stays in Inbox Drafts and will send at the time you chose.",
    }
)


def _without_email_card_caption(text: str) -> str:
    kept = [
        line.strip()
        for line in text.splitlines()
        if line.strip() and line.strip() not in _EMAIL_CARD_CAPTIONS
    ]
    return "\n".join(kept).strip()


def coworker_messages_to_openai(
    messages: list[dict[str, Any]] | None,
    *,
    max_pairs: int = 12,
) -> list[dict[str, str]]:
    """Convert {role,text} coworker messages; trim oldest complete user/assistant pairs."""
    cleaned: list[dict[str, str]] = []
    for m in messages or []:
        role = m.get("role")
        text = m.get("text")
        if role not in ("user", "assistant") or not isinstance(text, str):
            continue
        t = text.strip()
        if role == "assistant":
            t = _without_email_card_caption(t)
        if not t:
            continue
        # Collapse consecutive same-role turns (keeps pairs coherent)
        if cleaned and cleaned[-1]["role"] == role:
            cleaned[-1]["content"] = f"{cleaned[-1]['content']}\n{t}"[:4000]
        else:
            cleaned.append({"role": role, "content": t[:4000]})

    # Build pairs from the end; never drop a lone half of a user→assistant pair mid-trim
    pairs: list[list[dict[str, str]]] = []
    i = 0
    while i < len(cleaned):
        if (
            i + 1 < len(cleaned)
            and cleaned[i]["role"] == "user"
            and cleaned[i + 1]["role"] == "assistant"
        ):
            pairs.append([cleaned[i], cleaned[i + 1]])
            i += 2
        else:
            pairs.append([cleaned[i]])
            i += 1
    if len(pairs) > max_pairs:
        pairs = pairs[-max_pairs:]
    out: list[dict[str, str]] = []
    for p in pairs:
        out.extend(p)
    return out


def _enrich_import_proposals_from_user_text(
    proposals: list[dict[str, Any]] | None,
    user_text: str,
) -> None:
    """When the model calls propose_import_contacts without csvText, recover from chat."""
    if not proposals:
        return
    from app.agents.contact_coworker_agent import _extract_contact_csv

    body = _extract_contact_csv(user_text)
    if not body:
        return
    for prop in proposals:
        if not isinstance(prop, dict):
            continue
        if str(prop.get("name") or "") != "propose_import_contacts":
            continue
        args = prop.get("args")
        if not isinstance(args, dict):
            args = {}
            prop["args"] = args
        if str(args.get("csvText") or args.get("csv") or "").strip():
            continue
        if args.get("sample") is True or str(args.get("sample") or "").lower() == "true":
            continue
        args["csvText"] = body[:200_000]
        args["auto"] = True


def speech_after_draft_patch(
    *,
    speech: str,
    mod: str,
    entity_id: str | None,
    current_draft: dict[str, Any] | None,
    patch: dict[str, Any],
    tools: list[dict[str, Any]] | None = None,
    user_text: str = "",
) -> str:
    """Keep the model's own speech. Never invent a scripted next-slot question."""
    del mod, entity_id, current_draft, tools, user_text
    from app.agents.coworker_shared import (
        is_generic_coworker_speech,
        is_internal_workspace_speech,
        is_trivial_ack,
    )

    if not patch:
        return speech
    if (
        speech.strip()
        and not is_trivial_ack(speech)
        and not is_generic_coworker_speech(speech)
        and not is_internal_workspace_speech(speech)
    ):
        return speech
    return ""


_CONTACT_LIST_FILTER_KEYS = (
    "search",
    "location",
    "leadSource",
    "owner",
    "stage",
    "contactType",
    "leadStatus",
    "company",
    "email",
    "phone",
    "createdOn",
)


def _contact_list_filter_args(args: dict[str, Any]) -> dict[str, str]:
    """Keep contact-list filter fields the model named. Empty search still clears."""
    kept: dict[str, str] = {}
    for key in _CONTACT_LIST_FILTER_KEYS:
        if key not in args or args.get(key) is None:
            continue
        text = str(args.get(key)).strip()[:200]
        if text:
            kept[key] = text
        elif key == "search":
            kept[key] = ""
    return kept


def map_tool_calls_to_result(
    content: str | None,
    tool_calls: list[dict[str, Any]],
    *,
    mod: str,
    pathname: str,
    user_text: str,
    entity_id: str | None = None,
    current_draft: dict[str, Any] | None = None,
    context: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Map native tool_calls → assistantText + toolProposals + patch."""
    from app.agents.crm_agent import (
        MODULE_LIST_HREF,
        _clarify_destination,
        normalize_nav_href,
        sanitize_tool_proposals,
    )
    from app.agents.draft_conversation import (
        activity_draft_ready,
        company_draft_ready,
        contact_draft_ready,
        contact_draft_save_ready,
        deal_draft_ready,
        invoice_draft_ready,
        looks_like_create_confirm,
        merge_draft,
        product_draft_ready,
        quote_draft_ready,
    )
    business_type = str(
        (context or {}).get("businessType")
        or (context or {}).get("business_type")
        or ""
    ).strip().lower()
    from app.agents.coworker_shared import (
        is_generic_coworker_speech,
        result_leaves_current_page,
        sanitize_assistant_text_for_user,
        strip_internal_workspace_sentences,
    )

    create_tools: dict[str, Any] = {
        "propose_create_invoice": invoice_draft_ready,
        "propose_create_quote": quote_draft_ready,
        "propose_create_activity": activity_draft_ready,
    }

    proposals_raw: list[dict[str, Any]] = []
    patch: dict[str, Any] = {}
    clarify_q: str | None = None

    for i, call in enumerate(tool_calls):
        fn = call.get("function") if isinstance(call.get("function"), dict) else {}
        name = str((fn or {}).get("name") or "").strip()
        args = (fn or {}).get("arguments") if isinstance((fn or {}).get("arguments"), dict) else {}
        args = dict(args or {})

        if name == "ask_clarification":
            q = str(args.get("question") or "").strip()
            if q:
                clarify_q = q[:400]
            continue

        if name == "navigate":
            href = normalize_nav_href(str(args.get("href") or ""))
            if not href:
                continue
            proposals_raw.append(
                {
                    "id": f"nav-{i}",
                    "name": "navigate",
                    "label": str(args.get("label") or "Open").strip()[:80] or "Open",
                    "args": {
                        "href": href,
                        "auto": True,
                        **(
                            {"seedPrompt": str(args["seedPrompt"])[:2000]}
                            if isinstance(args.get("seedPrompt"), str)
                            and args["seedPrompt"].strip()
                            else {}
                        ),
                    },
                    "risk": "low",
                }
            )
            continue

        if name == "set_workspace":
            # Wave 5: never leave set_workspace on dashboard / non-shell modules
            if mod not in IN_SHELL_MODULES:
                from app.agents.crm_agent import (
                    IN_SHELL_CREATE,
                    MODULE_LIST_HREF,
                    normalize_nav_href,
                )
                from app.agents.nav_routing import (
                    configuration_sub_href,
                    infer_sales_module_from_label,
                    navigation_clarification,
                )

                label = str(args.get("label") or "")
                mode_hint = str(args.get("mode") or "").strip()
                seed = str(args.get("seedPrompt") or user_text or "").strip()[
                    :2000
                ]
                hint = f"{label} {seed}".strip()
                clarify = navigation_clarification(hint)
                if clarify:
                    clarify_q = clarify
                    continue
                target_href = None
                config_href = configuration_sub_href(hint)
                if config_href:
                    target_href = normalize_nav_href(config_href)
                else:
                    inferred = infer_sales_module_from_label(hint)
                    # Create from dashboard must land on /…/new, not the list.
                    if (
                        mode_hint == "create"
                        and inferred
                        and inferred in IN_SHELL_CREATE
                    ):
                        target_href = normalize_nav_href(
                            IN_SHELL_CREATE[inferred][0]
                        )
                    elif inferred:
                        target_href = normalize_nav_href(
                            MODULE_LIST_HREF.get(inferred) or ""
                        )
                    if not target_href:
                        target_href = normalize_nav_href(
                            MODULE_LIST_HREF.get(mod) or ""
                        )
                if target_href:
                    nav_args: dict[str, Any] = {
                        "href": target_href,
                        "auto": True,
                    }
                    if mode_hint == "create" and seed:
                        nav_args["seedPrompt"] = seed
                    proposals_raw.append(
                        {
                            "id": f"nav-rewrite-{i}",
                            "name": "navigate",
                            "label": str(args.get("label") or "Open").strip()[:80]
                            or "Open",
                            "args": nav_args,
                            "risk": "low",
                        }
                    )
                continue
            mode = str(args.get("mode") or "").strip()
            if mode not in ("list", "create", "detail"):
                continue
            # Dedicated /…/new pages are not AgentModuleShell — switch record
            # types with navigate so the browser can leave this create page.
            if mode in ("create", "list"):
                from app.agents.crm_agent import IN_SHELL_CREATE, MODULE_LIST_HREF
                from app.agents.nav_routing import infer_sales_module_from_label

                hint = (
                    f"{args.get('label') or ''} {args.get('seedPrompt') or ''} "
                    f"{user_text}"
                )
                inferred = infer_sales_module_from_label(hint)
                # "save" / "yes" is not a request to open another module.
                # Only leave when the user's own words name a different one.
                from app.agents.draft_conversation import looks_like_create_confirm

                if looks_like_create_confirm(user_text):
                    named = infer_sales_module_from_label(user_text)
                    if not named or named == mod:
                        inferred = None
                if inferred and inferred != mod:
                    if mode == "create" and inferred in IN_SHELL_CREATE:
                        target_href = normalize_nav_href(IN_SHELL_CREATE[inferred][0])
                    else:
                        target_href = normalize_nav_href(
                            MODULE_LIST_HREF.get(inferred) or ""
                        )
                    if target_href:
                        seed = str(args.get("seedPrompt") or user_text or "").strip()[
                            :2000
                        ]
                        nav_args: dict[str, Any] = {
                            "href": target_href,
                            "auto": True,
                        }
                        if mode == "create" and seed:
                            nav_args["seedPrompt"] = seed
                        proposals_raw.append(
                            {
                                "id": f"nav-cross-{i}",
                                "name": "navigate",
                                "label": str(args.get("label") or "Open").strip()[:80]
                                or "Open",
                                "args": nav_args,
                                "risk": "low",
                            }
                        )
                        continue
            proposals_raw.append(
                {
                    "id": f"ws-{i}",
                    "name": "set_workspace",
                    "label": str(args.get("label") or "Switch workspace").strip()[:80]
                    or "Switch workspace",
                    "args": {
                        "mode": mode,
                        "auto": True,
                        **(
                            {"entityId": str(args["entityId"])}
                            if isinstance(args.get("entityId"), str) and args["entityId"]
                            else {}
                        ),
                        **_contact_list_filter_args(args),
                        **(
                            {"seedPrompt": str(args["seedPrompt"])[:2000]}
                            if isinstance(args.get("seedPrompt"), str)
                            and args["seedPrompt"].strip()
                            else {}
                        ),
                    },
                    "risk": "low",
                }
            )
            continue

        if name == "propose_stage_change":
            from app.agents.deal_draft_agent import normalize_deal_stage

            deal_id = str(args.get("dealId") or entity_id or "").strip()
            stage = normalize_deal_stage(args.get("stage")) or ""
            if not deal_id or not stage:
                continue
            proposals_raw.append(
                {
                    "id": f"stage-{i}",
                    "name": "propose_stage_change",
                    "label": str(args.get("label") or f"Move stage to {stage}").strip()[
                        :80
                    ]
                    or f"Move stage to {stage}",
                    "args": {"dealId": deal_id, "stage": stage, "auto": True},
                    "risk": "low",
                }
            )
            continue

        if name == "propose_import_contacts":
            csv_text = str(args.get("csvText") or args.get("csv") or "").strip()
            sample = args.get("sample") is True or str(args.get("sample") or "").lower() == "true"
            if not csv_text and not sample:
                continue
            import_args: dict[str, Any] = {"auto": True}
            if csv_text:
                import_args["csvText"] = csv_text[:200_000]
            if sample:
                import_args["sample"] = True
            proposals_raw.append(
                {
                    "id": f"import-contacts-{i}",
                    "name": "propose_import_contacts",
                    "label": str(args.get("label") or "Import contacts").strip()[:80]
                    or "Import contacts",
                    "args": import_args,
                    "risk": "low",
                }
            )
            continue

        if name == "propose_pull_prospect_leads":
            phase = str(args.get("phase") or "start").strip().lower()
            pull_args: dict[str, Any] = {"auto": True, "phase": phase}
            limit = args.get("limit")
            if isinstance(limit, (int, float)) and limit > 0:
                pull_args["limit"] = int(limit)
            elif isinstance(limit, str) and limit.strip().isdigit():
                pull_args["limit"] = int(limit.strip())
            sources = args.get("sources")
            if isinstance(sources, list):
                pull_args["sources"] = [
                    str(s).strip().lower()
                    for s in sources
                    if str(s).strip()
                ]
            for key in (
                "industries",
                "geos",
                "sizeTiers",
                "titles",
                "technographics",
            ):
                val = args.get(key)
                if isinstance(val, list) and val:
                    pull_args[key] = [str(x) for x in val if str(x).strip()]
            for key in ("productFitHint", "freeText", "jobId"):
                val = args.get(key)
                if isinstance(val, str) and val.strip():
                    pull_args[key] = val.strip()
            selected = args.get("selectedIds")
            if isinstance(selected, list):
                pull_args["selectedIds"] = [
                    str(x) for x in selected if str(x).strip()
                ]
            if args.get("importNow") is True or str(args.get("importNow") or "").lower() in {
                "true",
                "1",
            }:
                pull_args["importNow"] = True
            proposals_raw.append(
                {
                    "id": f"pull-prospects-{i}",
                    "name": "propose_pull_prospect_leads",
                    "label": str(
                        args.get("label")
                        or (
                            "Import prospect leads"
                            if phase == "import"
                            else "Pull prospect leads"
                        )
                    ).strip()[:80]
                    or "Pull prospect leads",
                    "args": pull_args,
                    "risk": "low",
                }
            )
            continue

        if name == "propose_create_contact":
            # Only auto-save when the user explicitly confirmed in this turn.
            auto = looks_like_create_confirm(user_text) and contact_draft_save_ready(
                merge_draft(current_draft or {}, patch),
                business_type,
            )
            if not auto and not looks_like_create_confirm(user_text):
                # Model jumped ahead — ask in chat; don't show a Confirm button.
                continue
            if not auto:
                continue
            proposals_raw.append(
                {
                    "id": f"create-contact-{i}",
                    "name": "propose_create_contact",
                    "label": str(args.get("label") or "Create contact").strip()[:80]
                    or "Create contact",
                    "args": {"auto": True},
                    "risk": "low",
                }
            )
            continue

        if name == "propose_create_deal":
            auto = looks_like_create_confirm(user_text) and deal_draft_ready(
                merge_draft(current_draft or {}, patch)
            )
            if not auto:
                continue
            proposals_raw.append(
                {
                    "id": f"create-deal-{i}",
                    "name": "propose_create_deal",
                    "label": str(args.get("label") or "Create deal").strip()[:80]
                    or "Create deal",
                    "args": {"auto": True},
                    "risk": "low",
                }
            )
            continue

        if name == "propose_create_proposal":
            from app.agents.draft_conversation import propose_create_proposal_doc

            if not _requirement_pdf_attached(context):
                continue

            deal_id = str(args.get("dealId") or entity_id or "").strip()
            if not deal_id:
                continue
            title = (
                str(args.get("title") or "").strip()[:200]
                if isinstance(args.get("title"), str)
                else None
            )
            product_hint = (
                str(args.get("productHint") or "").strip()[:200]
                if isinstance(args.get("productHint"), str)
                else None
            )
            raw_ids = args.get("productIds")
            product_ids = None
            if isinstance(raw_ids, list):
                product_ids = [
                    str(x).strip() for x in raw_ids if str(x).strip()
                ][:10] or None
            proposals_raw.append(
                propose_create_proposal_doc(
                    deal_id=deal_id,
                    title=title or None,
                    auto=True,
                    product_hint=product_hint,
                    product_ids=product_ids,
                )
            )
            continue

        if name == "propose_update_deal":
            deal_id = str(args.get("dealId") or entity_id or "").strip()
            if not deal_id:
                continue
            clean: dict[str, Any] = {"dealId": deal_id, "auto": True}
            for key in ("title", "amount", "notes", "expectedCloseDate"):
                val = args.get(key)
                if isinstance(val, str) and val.strip():
                    clean[key] = val.strip()[:4000]
                elif isinstance(val, (int, float)) and not isinstance(val, bool):
                    clean[key] = str(val)
            if len(clean) <= 2:
                continue
            proposals_raw.append(
                {
                    "id": f"update-deal-{i}",
                    "name": "propose_update_deal",
                    "label": str(args.get("label") or "Update deal").strip()[:80]
                    or "Update deal",
                    "args": clean,
                    "risk": "low",
                }
            )
            continue

        if name == "propose_reassign_deal_owner":
            deal_id = str(args.get("dealId") or entity_id or "").strip()
            owner_id = str(args.get("ownerUserId") or "").strip()
            if not deal_id or not owner_id:
                continue
            proposals_raw.append(
                {
                    "id": f"reassign-deal-{i}",
                    "name": "propose_reassign_deal_owner",
                    "label": str(args.get("label") or "Reassign owner").strip()[:80]
                    or "Reassign owner",
                    "args": {
                        "dealId": deal_id,
                        "ownerUserId": owner_id[:80],
                        "auto": True,
                    },
                    "risk": "low",
                }
            )
            continue

        if name == "propose_delete_deal":
            deal_id = str(args.get("dealId") or entity_id or "").strip()
            if not deal_id:
                continue
            lower_u = (user_text or "").lower()
            if not re.search(
                r"\b(delete|remove|erase|yes|yep|yeah|confirm|ok|okay|sure)\b",
                lower_u,
            ):
                continue
            del_args: dict[str, Any] = {"dealId": deal_id, "auto": True}
            display = args.get("displayName")
            if isinstance(display, str) and display.strip():
                del_args["displayName"] = display.strip()[:120]
            proposals_raw.append(
                {
                    "id": f"delete-deal-{i}",
                    "name": "propose_delete_deal",
                    "label": str(args.get("label") or "Delete deal").strip()[:80]
                    or "Delete deal",
                    "args": del_args,
                    "risk": "low",
                }
            )
            continue

        if name in create_tools:
            ready_fn = create_tools[name]
            auto = looks_like_create_confirm(user_text) and ready_fn(
                merge_draft(current_draft or {}, patch)
            )
            if not auto:
                continue
            default_labels = {
                "propose_create_invoice": "Create invoice",
                "propose_create_quote": "Create quote",
                "propose_create_activity": "Log activity",
            }
            proposals_raw.append(
                {
                    "id": f"create-{name}-{i}",
                    "name": name,
                    "label": str(args.get("label") or default_labels[name]).strip()[
                        :80
                    ]
                    or default_labels[name],
                    "args": {"auto": True},
                    "risk": "low",
                }
            )
            continue

        if name == "propose_update_contact":
            contact_id = str(args.get("contactId") or entity_id or "").strip()
            if not contact_id:
                continue
            clean: dict[str, Any] = {"contactId": contact_id, "auto": True}
            for key in (
                "firstName",
                "lastName",
                "email",
                "phone",
                "title",
                "notes",
                "city",
                "country",
                "addressLine",
                "status",
                "ownerUserId",
                "tags",
                "contactType",
                "leadStatus",
                "leadSource",
                "companyId",
                "locationId",
                "secondaryEmails",
                "secondaryPhones",
                "bantBudget",
                "bantAuthority",
                "bantNeed",
                "bantTimeline",
            ):
                val = args.get(key)
                if isinstance(val, str) and val.strip():
                    clean[key] = val.strip()[:2000]
                elif isinstance(val, bool) and key.startswith("bant"):
                    clean[key] = val
            if len(clean) <= 2:
                continue
            proposals_raw.append(
                {
                    "id": f"update-contact-{i}",
                    "name": "propose_update_contact",
                    "label": str(args.get("label") or "Update contact").strip()[:80]
                    or "Update contact",
                    "args": clean,
                    "risk": "low",
                }
            )
            continue

        if name == "propose_delete_contact":
            contact_id = str(args.get("contactId") or entity_id or "").strip()
            if not contact_id:
                continue
            # Only when the user clearly confirmed delete in this turn.
            lower_u = (user_text or "").lower()
            if not re.search(
                r"\b(delete|remove|erase|yes|yep|yeah|confirm|ok|okay|sure)\b",
                lower_u,
            ):
                continue
            del_args: dict[str, Any] = {"contactId": contact_id, "auto": True}
            display = args.get("displayName")
            if isinstance(display, str) and display.strip():
                del_args["displayName"] = display.strip()[:120]
            proposals_raw.append(
                {
                    "id": f"delete-contact-{i}",
                    "name": "propose_delete_contact",
                    "label": str(args.get("label") or "Delete contact").strip()[:80]
                    or "Delete contact",
                    "args": del_args,
                    "risk": "low",
                }
            )
            continue

        if name == "propose_create_company":
            auto = looks_like_create_confirm(user_text) and company_draft_ready(
                merge_draft(current_draft or {}, patch)
            )
            if not auto and not looks_like_create_confirm(user_text):
                continue
            if not auto:
                continue
            proposals_raw.append(
                {
                    "id": f"create-company-{i}",
                    "name": "propose_create_company",
                    "label": str(args.get("label") or "Create company").strip()[:80]
                    or "Create company",
                    "args": {"auto": True},
                    "risk": "low",
                }
            )
            continue

        if name == "propose_update_company":
            from app.agents.draft_conversation import sanitize_company_update_name

            company_id = str(args.get("companyId") or entity_id or "").strip()
            if not company_id:
                continue
            clean: dict[str, Any] = {"companyId": company_id, "auto": True}
            for key in ("name", "domain", "industry", "linkedinUrl", "employeeCount"):
                val = args.get(key)
                if not isinstance(val, str) or not val.strip():
                    continue
                if key == "name":
                    cleaned_name = sanitize_company_update_name(val)
                    if cleaned_name:
                        clean["name"] = cleaned_name
                    continue
                clean[key] = val.strip()[:2000]
            if len(clean) <= 2:
                continue
            proposals_raw.append(
                {
                    "id": f"update-company-{i}",
                    "name": "propose_update_company",
                    "label": str(args.get("label") or "Update company").strip()[:80]
                    or "Update company",
                    "args": clean,
                    "risk": "low",
                }
            )
            continue

        if name == "propose_update_company_location":
            company_id = str(args.get("companyId") or "").strip()
            if not company_id:
                continue
            clean_loc: dict[str, Any] = {"companyId": company_id, "auto": True}
            loc_id = str(args.get("locationId") or "").strip()
            if loc_id:
                clean_loc["locationId"] = loc_id
            for key in ("name", "city", "address", "type"):
                val = args.get(key)
                if isinstance(val, str) and val.strip():
                    clean_loc[key] = val.strip()[:2000]
            if len(clean_loc) <= 2:
                continue
            proposals_raw.append(
                {
                    "id": f"update-company-loc-{i}",
                    "name": "propose_update_company_location",
                    "label": str(args.get("label") or "Update company location").strip()[
                        :80
                    ]
                    or "Update company location",
                    "args": clean_loc,
                    "risk": "low",
                }
            )
            continue

        if name == "propose_delete_company":
            company_id = str(args.get("companyId") or entity_id or "").strip()
            if not company_id:
                continue
            lower_u = (user_text or "").lower()
            if not re.search(
                r"\b(delete|remove|erase|yes|yep|yeah|confirm|ok|okay|sure)\b",
                lower_u,
            ):
                continue
            del_args: dict[str, Any] = {"companyId": company_id, "auto": True}
            display = args.get("displayName")
            if isinstance(display, str) and display.strip():
                del_args["displayName"] = display.strip()[:120]
            proposals_raw.append(
                {
                    "id": f"delete-company-{i}",
                    "name": "propose_delete_company",
                    "label": str(args.get("label") or "Delete company").strip()[:80]
                    or "Delete company",
                    "args": del_args,
                    "risk": "low",
                }
            )
            continue

        if name == "propose_create_product":
            auto = looks_like_create_confirm(user_text) and product_draft_ready(
                merge_draft(current_draft or {}, patch)
            )
            if not auto and not looks_like_create_confirm(user_text):
                continue
            if not auto:
                continue
            proposals_raw.append(
                {
                    "id": f"create-product-{i}",
                    "name": "propose_create_product",
                    "label": str(args.get("label") or "Create product").strip()[:80]
                    or "Create product",
                    "args": {"auto": True},
                    "risk": "low",
                }
            )
            continue

        if name == "propose_update_product":
            product_id = str(args.get("productId") or entity_id or "").strip()
            if not product_id:
                continue
            clean = {"productId": product_id, "auto": True}
            scalar_keys = (
                "name",
                "sku",
                "price",
                "maxDiscountPercent",
                "currency",
                "description",
                "brand",
                "category",
                "subcategory",
                "stockOnHand",
                "productUrl",
                "status",
                "productType",
                "billingType",
                "billingFrequency",
                "tags",
                "imageUrl",
                "galleryUrls",
            )
            for key in scalar_keys:
                val = args.get(key)
                if isinstance(val, str) and val.strip():
                    clean[key] = val.strip()[:2000]
                elif isinstance(val, (int, float)) and not isinstance(val, bool):
                    clean[key] = str(val)
            if isinstance(args.get("offers"), list):
                clean["offers"] = args["offers"]
            if isinstance(args.get("addons"), list):
                clean["addons"] = args["addons"]
            if len(clean) <= 2:
                continue
            proposals_raw.append(
                {
                    "id": f"update-product-{i}",
                    "name": "propose_update_product",
                    "label": str(args.get("label") or "Update product").strip()[:80]
                    or "Update product",
                    "args": clean,
                    "risk": "low",
                }
            )
            continue

        if name == "propose_delete_product":
            product_id = str(args.get("productId") or entity_id or "").strip()
            if not product_id:
                continue
            lower_u = (user_text or "").lower()
            if not re.search(
                r"\b(delete|remove|erase|yes|yep|yeah|confirm|ok|okay|sure)\b",
                lower_u,
            ):
                continue
            del_args = {"productId": product_id, "auto": True}
            display = args.get("displayName")
            if isinstance(display, str) and display.strip():
                del_args["displayName"] = display.strip()[:120]
            proposals_raw.append(
                {
                    "id": f"delete-product-{i}",
                    "name": "propose_delete_product",
                    "label": str(args.get("label") or "Delete product").strip()[:80]
                    or "Delete product",
                    "args": del_args,
                    "risk": "low",
                }
            )
            continue

        if name == "propose_update_quote":
            quote_id = str(args.get("quoteId") or entity_id or "").strip()
            if not quote_id:
                continue
            from app.agents.draft_conversation import sanitize_quote_update_args

            clean = sanitize_quote_update_args(args, quote_id=quote_id)
            if not clean:
                continue
            proposals_raw.append(
                {
                    "id": f"update-quote-{i}",
                    "name": "propose_update_quote",
                    "label": str(args.get("label") or "Update quote").strip()[:80]
                    or "Update quote",
                    "args": clean,
                    "risk": "low",
                }
            )
            continue

        if name == "propose_send_quote":
            quote_id = str(args.get("quoteId") or entity_id or "").strip()
            if not quote_id:
                continue
            send_args: dict[str, Any] = {"quoteId": quote_id, "auto": True}
            display = args.get("displayName")
            if isinstance(display, str) and display.strip():
                send_args["displayName"] = display.strip()[:120]
            proposals_raw.append(
                {
                    "id": f"send-quote-{i}",
                    "name": "propose_send_quote",
                    "label": str(args.get("label") or "Send quote").strip()[:80]
                    or "Send quote",
                    "args": send_args,
                    "risk": "low",
                }
            )
            continue

        if name == "propose_delete_quote":
            quote_id = str(args.get("quoteId") or entity_id or "").strip()
            if not quote_id:
                continue
            lower_u = (user_text or "").lower()
            if not re.search(
                r"\b(delete|remove|erase|yes|yep|yeah|confirm|ok|okay|sure)\b",
                lower_u,
            ):
                continue
            del_args = {"quoteId": quote_id, "auto": True}
            display = args.get("displayName")
            if isinstance(display, str) and display.strip():
                del_args["displayName"] = display.strip()[:120]
            proposals_raw.append(
                {
                    "id": f"delete-quote-{i}",
                    "name": "propose_delete_quote",
                    "label": str(args.get("label") or "Delete quote").strip()[:80]
                    or "Delete quote",
                    "args": del_args,
                    "risk": "low",
                }
            )
            continue

        if name == "propose_update_invoice":
            invoice_id = str(args.get("invoiceId") or entity_id or "").strip()
            if not invoice_id:
                continue
            from app.agents.draft_conversation import sanitize_invoice_update_args

            clean = sanitize_invoice_update_args(args, invoice_id=invoice_id)
            if not clean:
                continue
            proposals_raw.append(
                {
                    "id": f"update-invoice-{i}",
                    "name": "propose_update_invoice",
                    "label": str(args.get("label") or "Update invoice").strip()[:80]
                    or "Update invoice",
                    "args": clean,
                    "risk": "low",
                }
            )
            continue

        if name == "propose_send_invoice":
            invoice_id = str(args.get("invoiceId") or entity_id or "").strip()
            if not invoice_id:
                continue
            send_args: dict[str, Any] = {"invoiceId": invoice_id, "auto": True}
            display = args.get("displayName")
            if isinstance(display, str) and display.strip():
                send_args["displayName"] = display.strip()[:120]
            proposals_raw.append(
                {
                    "id": f"send-invoice-{i}",
                    "name": "propose_send_invoice",
                    "label": str(args.get("label") or "Send invoice").strip()[:80]
                    or "Send invoice",
                    "args": send_args,
                    "risk": "low",
                }
            )
            continue

        if name == "propose_delete_invoice":
            invoice_id = str(args.get("invoiceId") or entity_id or "").strip()
            if not invoice_id:
                continue
            lower_u = (user_text or "").lower()
            if not re.search(
                r"\b(delete|remove|erase|yes|yep|yeah|confirm|ok|okay|sure)\b",
                lower_u,
            ):
                continue
            del_args = {"invoiceId": invoice_id, "auto": True}
            display = args.get("displayName")
            if isinstance(display, str) and display.strip():
                del_args["displayName"] = display.strip()[:120]
            proposals_raw.append(
                {
                    "id": f"delete-invoice-{i}",
                    "name": "propose_delete_invoice",
                    "label": str(args.get("label") or "Delete invoice").strip()[:80]
                    or "Delete invoice",
                    "args": del_args,
                    "risk": "low",
                }
            )
            continue

        if name == "propose_mark_invoice_paid":
            invoice_id = str(args.get("invoiceId") or entity_id or "").strip()
            if not invoice_id:
                continue
            proposals_raw.append(
                {
                    "id": f"mark-invoice-paid-{i}",
                    "name": "propose_mark_invoice_paid",
                    "label": str(args.get("label") or "Mark invoice paid").strip()[:80]
                    or "Mark invoice paid",
                    "args": {"invoiceId": invoice_id, "auto": True},
                    "risk": "low",
                }
            )
            continue

        if name == "propose_personalize_proposal":
            proposal_id = str(args.get("proposalId") or entity_id or "").strip()
            if not proposal_id:
                continue
            pers_args: dict[str, Any] = {"proposalId": proposal_id, "auto": True}
            hint = args.get("productHint")
            if isinstance(hint, str) and hint.strip():
                pers_args["productHint"] = hint.strip()[:200]
            raw_ids = args.get("productIds")
            if isinstance(raw_ids, list):
                ids = [str(x).strip() for x in raw_ids if str(x).strip()][:10]
                if ids:
                    pers_args["productIds"] = ids
            proposals_raw.append(
                {
                    "id": f"personalize-proposal-{i}",
                    "name": "propose_personalize_proposal",
                    "label": str(args.get("label") or "Regenerate proposal").strip()[:80]
                    or "Regenerate proposal",
                    "args": pers_args,
                    "risk": "low",
                }
            )
            continue

        if name == "propose_send_proposal":
            proposal_id = str(args.get("proposalId") or entity_id or "").strip()
            if not proposal_id:
                continue
            send_args = {"proposalId": proposal_id, "auto": True}
            display = args.get("displayName")
            if isinstance(display, str) and display.strip():
                send_args["displayName"] = display.strip()[:120]
            proposals_raw.append(
                {
                    "id": f"send-proposal-{i}",
                    "name": "propose_send_proposal",
                    "label": str(args.get("label") or "Share proposal").strip()[:80]
                    or "Share proposal",
                    "args": send_args,
                    "risk": "low",
                }
            )
            continue

        if name == "propose_delete_proposal":
            proposal_id = str(args.get("proposalId") or entity_id or "").strip()
            if not proposal_id:
                continue
            lower_u = (user_text or "").lower()
            if not re.search(
                r"\b(delete|remove|erase|yes|yep|yeah|confirm|ok|okay|sure)\b",
                lower_u,
            ):
                continue
            del_args = {"proposalId": proposal_id, "auto": True}
            display = args.get("displayName")
            if isinstance(display, str) and display.strip():
                del_args["displayName"] = display.strip()[:120]
            proposals_raw.append(
                {
                    "id": f"delete-proposal-{i}",
                    "name": "propose_delete_proposal",
                    "label": str(args.get("label") or "Delete proposal").strip()[:80]
                    or "Delete proposal",
                    "args": del_args,
                    "risk": "low",
                }
            )
            continue

        if name in (
            "propose_patch_proposal_section",
            "propose_patch_proposal_document_text",
            "propose_rewrite_proposal_section",
        ):
            proposal_id = str(args.get("proposalId") or entity_id or "").strip()
            passthrough = dict(args)
            if proposal_id:
                passthrough.setdefault("proposalId", proposal_id)
            _proposal_patch_labels = {
                "propose_patch_proposal_section": "Update section",
                "propose_patch_proposal_document_text": "Update document text",
                "propose_rewrite_proposal_section": "Rewrite section",
            }
            proposals_raw.append(
                {
                    "id": f"{name}-{i}",
                    "name": name,
                    "label": str(
                        args.get("label") or _proposal_patch_labels.get(name, name)
                    ).strip()[:80]
                    or _proposal_patch_labels.get(name, name),
                    "args": passthrough,
                    "risk": "low" if passthrough.get("auto") else "high",
                }
            )
            continue

        if name in (
            "patch_contact_draft",
            "patch_deal_draft",
            "patch_company_draft",
            "patch_location_draft",
            "patch_product_draft",
            "patch_invoice_draft",
            "patch_quote_draft",
            "patch_activity_draft",
        ):
            for k, v in args.items():
                if v is None:
                    continue
                if isinstance(v, str) and v.strip():
                    patch[k] = v.strip()[:500]
                elif isinstance(v, (int, float)) and not isinstance(v, bool):
                    patch[k] = str(v)
            if name == "patch_deal_draft" and "stage" in patch:
                from app.agents.deal_draft_agent import normalize_deal_stage

                resolved = normalize_deal_stage(patch.get("stage"))
                if resolved:
                    patch["stage"] = resolved
                else:
                    patch.pop("stage", None)
            if name == "patch_contact_draft":
                patch["leadSource"] = "crm"
            continue

    # A bare "save" / "yes" must not leave this page. The model sometimes
    # copies a contact-create example navigate onto a company save.
    if looks_like_create_confirm(user_text):
        from app.agents.nav_routing import infer_sales_module_from_label

        named = infer_sales_module_from_label(user_text)
        if not named or named == mod:
            kept: list[dict[str, Any]] = []
            for proposal in proposals_raw:
                if not isinstance(proposal, dict):
                    continue
                pname = str(proposal.get("name") or "")
                pargs = (
                    proposal.get("args")
                    if isinstance(proposal.get("args"), dict)
                    else {}
                )
                if pname in ("navigate", "open_entity"):
                    href = str(pargs.get("href") or "").split("?")[0]
                    target = infer_sales_module_from_label(href.replace("/", " "))
                    if target and target != mod:
                        continue
                if pname == "set_workspace":
                    target = infer_sales_module_from_label(
                        f"{proposal.get('label') or ''} {pargs.get('seedPrompt') or ''}"
                    )
                    if target and target != mod:
                        continue
                kept.append(proposal)
            proposals_raw = kept

    # Contact create: only emit save tool when the user confirmed in chat
    if mod == "contact" and looks_like_create_confirm(user_text):
        merged_preview = merge_draft(current_draft or {}, patch)
        already = any(p.get("name") == "propose_create_contact" for p in proposals_raw)
        if contact_draft_save_ready(merged_preview, business_type) and not already:
            proposals_raw.append(
                {
                    "id": "create-contact-confirm",
                    "name": "propose_create_contact",
                    "label": "Create contact",
                    "args": {"auto": True},
                    "risk": "low",
                }
            )

    _CONFIRM_FALLBACK: dict[str, tuple[Any, str, str]] = {
        "sales": (deal_draft_ready, "propose_create_deal", "Create deal"),
        "company": (company_draft_ready, "propose_create_company", "Create company"),
        "product": (product_draft_ready, "propose_create_product", "Create product"),
        "finance": (invoice_draft_ready, "propose_create_invoice", "Create invoice"),
        "quotes": (quote_draft_ready, "propose_create_quote", "Create quote"),
        "activities": (activity_draft_ready, "propose_create_activity", "Log activity"),
    }
    if mod in _CONFIRM_FALLBACK and (
        looks_like_create_confirm(user_text) or mod == "company"
    ):
        ready_fn, tool_name, label = _CONFIRM_FALLBACK[mod]
        if not (mod == "company" and entity_id):
            merged_preview = merge_draft(current_draft or {}, patch)
            from app.agents.draft_conversation import should_persist_ready_company

            persist = (
                should_persist_ready_company(
                    user_text,
                    before=current_draft if isinstance(current_draft, dict) else {},
                    merged=merged_preview,
                )
                if mod == "company"
                else looks_like_create_confirm(user_text)
                and ready_fn(merged_preview)
            )
            already = any(p.get("name") == tool_name for p in proposals_raw)
            if persist and not already:
                proposals_raw.append(
                    {
                        "id": f"{tool_name}-confirm",
                        "name": tool_name,
                        "label": label,
                        "args": {"auto": True},
                        "risk": "low",
                    }
                )
                if mod == "company":
                    company_name = str(merged_preview.get("name") or "").strip()
                    if company_name:
                        content = f"Saving **{company_name}** now."

    tools = sanitize_tool_proposals(proposals_raw, user_text, mod, pathname)
    _enrich_import_proposals_from_user_text(tools, user_text)
    saving_company = any(
        isinstance(t, dict) and t.get("name") == "propose_create_company"
        for t in (tools or [])
    )
    if (
        not saving_company
        and result_leaves_current_page(
            {"toolProposals": tools or proposals_raw},
            pathname=pathname,
            module=mod,
        )
    ):
        patch = {}
    had_nav = any(t.get("name") == "navigate" for t in proposals_raw)
    has_nav = bool(tools and any(t.get("name") == "navigate" for t in tools))
    if had_nav and not has_nav and not patch and not clarify_q:
        return _clarify_destination()

    if mod == "sales" and patch:
        from app.agents.deal_draft_agent import coerce_deal_name_fields

        catalog = (context or {}).get("catalog")
        patch = coerce_deal_name_fields(
            patch,
            catalog if isinstance(catalog, dict) else {},
        ) or {}

    speech = (content or "").strip()
    if clarify_q and not speech:
        speech = clarify_q
    speech = strip_internal_workspace_sentences(speech)
    if patch:
        speech = speech_after_draft_patch(
            speech=speech,
            mod=mod,
            entity_id=entity_id,
            current_draft=current_draft,
            patch=patch,
            tools=tools or [],
            user_text=user_text,
        )

    if is_generic_coworker_speech(speech):
        speech = ""
    if not speech and not tools and not patch:
        return {"ok": False, "error": "empty_native_turn"}

    out: dict[str, Any] = {
        "ok": True,
        "assistantText": sanitize_assistant_text_for_user(
            speech or clarify_q or ""
        )[:800],
    }
    if tools:
        out["toolProposals"] = tools
    if patch:
        if mod == "company" and not entity_id:
            from app.agents.draft_conversation import (
                clamp_company_patch_to_walk,
                company_next_ask_key,
                normalize_company_address_patch,
            )

            ask = company_next_ask_key(current_draft or {})
            patch = clamp_company_patch_to_walk(patch, ask=ask)
            patch = dict(normalize_company_address_patch(patch, current_draft) or {})
        out["patch"] = patch
        if mod == "contact":
            out["contactDraftPatch"] = patch
    return out


async def run_native_agent_turn(
    *,
    mod: str,
    surface: str,
    messages: list[dict[str, Any]],
    context: dict[str, Any],
    catalog: dict[str, Any],
    user_text: str,
) -> dict[str, Any] | None:
    """Run one native-tools LLM turn. Returns result dict or None to fall back.

    Tool schemas and execution come **only** from the in-process Python FastMCP
    coworker server (``app.mcp``) — direct crm.* writes, no Fastify MCP.
    """
    from app.config import get_settings
    from app.llm import chat_with_tools, is_ai_configured
    from app.mcp.server import begin_agent_mcp_context, end_agent_mcp_context
    from app.mcp.catalog import FORM_OWNED_TOOLS
    from app.mcp_client import (
        McpClient,
        _merge_refresh,
        mcp_result_to_turn_parts,
        mcp_tools_to_openai,
    )
    from app.agents.coworker_shared import (
        is_generic_coworker_speech,
        sanitize_assistant_text_for_user,
        strip_internal_workspace_sentences,
    )

    from app.agent_log import fmt, logger, tool_names, trace

    trace(
        agent="native",
        step="receive",
        module=mod,
        surface=surface,
        user=user_text,
    )
    try:
        from app.orchestrator.coworker_mutation_finalize import specialist_agent_for_module
        from app.observability.turn_log import record_attending_agent, turn_active

        if turn_active():
            record_attending_agent(
                specialist_agent_for_module(
                    mod, pathname=str(context.get("pathname") or "")
                )
            )
    except Exception:  # noqa: BLE001
        pass
    if not is_ai_configured():
        logger.info(
            fmt(
                agent="native",
                step="skip",
                module=mod,
                surface=surface,
                reason="llm_not_configured",
            )
        )
        return None

    draft = context.get("draft") or catalog.get("currentDraft") or {}
    if not isinstance(draft, dict):
        draft = {}

    # Quotes create: resolve unambiguous deal/product (and soft yes/ok) before
    # the LLM — otherwise it re-asks / claims "not found" after confirming.
    # Never hijack an explicit *proposal document* ask into a quote draft.
    if mod == "quotes" and surface == "create":
        from app.agents.coworker_shared import try_quote_deterministic_turn
        from app.agents.deal_coworker_agent import _wants_create_proposal

        if not _wants_create_proposal((user_text or "").lower()):
            deterministic = try_quote_deterministic_turn(
                user_text=user_text,
                draft=draft,
                catalog=catalog,
                messages=messages,
            )
            if deterministic and deterministic.get("ok"):
                return deterministic

    prompt_ctx = {
        **context,
        "draft": draft,
        "catalog": catalog,
        "deals": catalog.get("deals"),
        "products": catalog.get("products"),
        "businessType": catalog.get("businessType")
        or context.get("businessType")
        or context.get("business_type"),
    }
    companies = catalog.get("companies")
    if isinstance(companies, list) and companies:
        prompt_ctx["companies"] = companies
    catalog_contacts = catalog.get("contacts")
    if isinstance(catalog_contacts, list) and catalog_contacts:
        prompt_ctx["contacts"] = catalog_contacts

    openai_msgs = [
        {
            "role": "system",
            "content": build_system_prompt(mod, surface, prompt_ctx),
        },
        *coworker_messages_to_openai(messages),
    ]
    if not any(m.get("role") == "user" for m in openai_msgs):
        openai_msgs.append({"role": "user", "content": user_text})

    entity_id = str(context.get("entityId") or "") or None
    acting = str(
        context.get("actingUserId") or catalog.get("actingUserId") or ""
    )
    org_id = str(
        context.get("organizationId") or catalog.get("organizationId") or ""
    )
    role = str(context.get("role") or catalog.get("role") or "")
    business_type = str(
        context.get("businessType")
        or context.get("business_type")
        or catalog.get("businessType")
        or ""
    )
    execution_token = str(
        context.get("mcpExecutionToken")
        or context.get("mcp_execution_token")
        or ""
    ) or None

    begin_agent_mcp_context(
        acting_user_id=acting,
        organization_id=org_id,
        role=role,
        business_type=business_type,
        module=mod,
        surface=surface,
        entity_id=entity_id,
        pathname=str(context.get("pathname") or "") or None,
        draft=draft,
    )

    mcp = McpClient(
        acting_user_id=acting or None,
        organization_id=org_id or None,
        role=role or None,
        execution_token=execution_token,
        execution_context={
            "agentName": "crm-agent",
            "executionMode": str(context.get("executionMode") or "native"),
            "businessType": business_type,
            "module": mod,
            "surface": surface,
            "policyVersion": get_settings().mcp_policy_version,
            "runId": str(context.get("runId") or ""),
            "traceId": str(context.get("traceId") or ""),
            "idempotencyKey": str(context.get("idempotencyKey") or ""),
        },
    )
    try:
        mcp_tools = await mcp.list_tools(
            module=mod, surface=surface, entity_id=entity_id
        )
        if is_hub_execute(context):
            mcp_tools = [
                tool
                for tool in mcp_tools
                if str(tool.get("name") or "") != "ask_clarification"
            ]
        if not mcp_tools:
            end_agent_mcp_context()
            logger.error(
                fmt(
                    agent="native",
                    step="skip",
                    module=mod,
                    surface=surface,
                    reason="no_mcp_tools",
                    ok=False,
                )
            )
            return None

        tools = mcp_tools_to_openai(mcp_tools)
        if (mod or "") == "product":
            bt = str(
                catalog.get("businessType")
                or context.get("businessType")
                or context.get("business_type")
                or ""
            )
            tools = filter_product_openai_tools(tools, bt)
        from app.agents.coworker_native import (
            CONTENT_GENERATOR_TOOLS,
            is_seo_content_page,
        )

        seo_page = is_seo_content_page(context)
        if seo_page:
            mcp_tools = [
                tool
                for tool in mcp_tools
                if str(tool.get("name") or "") in CONTENT_GENERATOR_TOOLS
            ]
            tools = mcp_tools_to_openai(mcp_tools)
        allowed = {str(t.get("name") or "") for t in mcp_tools if isinstance(t, dict)}

        trace(
            agent="native",
            step="llm_req",
            module=mod,
            surface=surface,
            promptMsgCount=len(openai_msgs),
            toolCount=len(tools),
        )
        result = await chat_with_tools(
            messages=openai_msgs,
            tools=tools,
            max_tokens=6000 if seo_page else 700,
            timeout_ms=90_000 if seo_page else 25_000,
            temperature=0.2,
        )
        if not result:
            end_agent_mcp_context()
            trace(agent="native", step="llm_res", ok=False, reason="empty", module=mod)
            from app.agent_log import console_coworker

            console_coworker(
                "llm",
                agent="native",
                module=mod,
                ok=False,
                text="(empty LLM response)",
            )
            return None

        content = result.get("content")
        tool_calls = result.get("tool_calls") or []
        from app.agent_log import console_coworker

        console_coworker(
            "llm",
            agent="native",
            module=mod,
            surface=surface,
            tools=",".join(
                str((tc.get("function") or {}).get("name") or tc.get("name") or "")
                for tc in tool_calls
                if isinstance(tc, dict)
            )
            or None,
            text=content if isinstance(content, str) and content.strip() else "(no text)",
        )
        trace(
            agent="native",
            step="llm_res",
            ok=True,
            module=mod,
            finish=result.get("finish_reason"),
            contentLen=len(content or ""),
            toolCallCount=len(tool_calls),
            toolCallNames=[
                str((tc.get("function") or {}).get("name") or "")
                for tc in tool_calls
                if isinstance(tc, dict)
            ][:10],
        )
        if not content and not tool_calls:
            end_agent_mcp_context()
            logger.error(
                fmt(
                    agent="native",
                    step="llm_empty",
                    module=mod,
                    surface=surface,
                    ok=False,
                    reason="no_content_or_tools",
                )
            )
            return None

        speech = content if isinstance(content, str) else ""
        proposals: list[dict[str, Any]] = []
        patch: dict[str, Any] = {}
        ui_refresh_acc: dict[str, Any] = {}
        session_memory_patch: dict[str, Any] | None = None
        clarification_requested = False
        mcp_ctx = {
            "module": mod,
            "surface": surface,
            "entityId": entity_id,
            "pathname": context.get("pathname"),
            "draft": draft,
            "actingUserId": acting,
            "organizationId": org_id,
            "role": role,
        }
        for tc in tool_calls if isinstance(tool_calls, list) else []:
            if not isinstance(tc, dict):
                continue
            fn = tc.get("function") if isinstance(tc.get("function"), dict) else {}
            name = str(fn.get("name") or tc.get("name") or "").strip()
            if not name or name not in allowed:
                continue
            raw_args = fn.get("arguments") if fn else tc.get("arguments")
            args: dict[str, Any] = {}
            if isinstance(raw_args, dict):
                args = raw_args
            elif isinstance(raw_args, str) and raw_args.strip():
                try:
                    parsed = json.loads(raw_args)
                    if isinstance(parsed, dict):
                        args = parsed
                except json.JSONDecodeError:
                    args = {}
            from app.agent_log import console_coworker

            trace(
                agent="native",
                step="tool_call",
                tool=name,
                args=args,
                module=mod,
            )
            console_coworker("tool_call", agent="native", name=name, text=args)
            if name in FORM_OWNED_TOOLS:
                if name == "propose_create_proposal" and not _requirement_pdf_attached(
                    context
                ):
                    logger.info(
                        fmt(
                            agent="native",
                            step="skip_tool",
                            tool=name,
                            reason="requirement_pdf_missing",
                        )
                    )
                    console_coworker(
                        "tool_response",
                        agent="native",
                        name=name,
                        ok=False,
                        text={"skipped": True, "reason": "requirement_pdf_missing"},
                    )
                    continue
                proposals.append(
                    {
                        "id": f"form-{name}-{len(proposals)}",
                        "name": name,
                        "label": str(
                            args.get("label") or name.replace("_", " ")
                        ).strip()[:80]
                        or name.replace("_", " "),
                        "args": {
                            **{
                                k: v
                                for k, v in args.items()
                                if k not in ("confirmed", "label")
                            },
                            "auto": True,
                        },
                        "risk": "low",
                    }
                )
                logger.info(
                    fmt(
                        agent="mcp",
                        step="call",
                        ok=True,
                        tool=name,
                        kind="form_owned",
                    )
                )
                console_coworker(
                    "tool_response",
                    agent="native",
                    name=name,
                    kind="form_owned",
                    ok=True,
                    text={"queued": True, "args": args},
                )
                continue
            if is_hub_execute(context) and (
                name.startswith("propose_") or str(args.get("risk") or "") == "high"
            ):
                args = {**args, "confirmed": True, "auto": True}
            mcp_res = await mcp.call_tool(name, args, context=mcp_ctx)
            console_coworker(
                "tool_response",
                agent="native",
                name=name,
                ok=bool(mcp_res),
                text=mcp_res if mcp_res else {"ok": False, "error": "empty"},
            )
            try:
                from app.observability.turn_log import current_turn_agent, record_tool, turn_active

                if turn_active():
                    record_tool(
                        name,
                        args,
                        mcp_res if mcp_res else {"ok": False, "error": "empty"},
                        agent=current_turn_agent(),
                    )
            except Exception:  # noqa: BLE001
                pass
            trace(
                agent="native",
                step="tool_res",
                tool=name,
                ok=bool(mcp_res),
                kind="mcp_exec",
                response=mcp_res,
                module=mod,
            )
            if not mcp_res:
                continue
            if (
                name == "ask_clarification"
                and str(mcp_res.get("kind") or "") == "clarify"
                and bool(mcp_res.get("ok", True))
            ):
                clarification_requested = True
            parts = mcp_result_to_turn_parts(name, mcp_res)
            if parts.get("assistantText") and not speech:
                speech = str(parts["assistantText"])
            if isinstance(parts.get("patch"), dict):
                patch.update(parts["patch"])
            if isinstance(parts.get("toolProposal"), dict):
                proposals.append(parts["toolProposal"])
            if isinstance(parts.get("uiRefresh"), dict):
                _merge_refresh(ui_refresh_acc, parts["uiRefresh"])

        from app.orchestrator.coworker_mutation_finalize import specialist_agent_for_module
        from app.orchestrator.mutation_gate import (
            llm_open_record_mutation_requested,
            llm_speech_claims_mutation_done,
            mutation_repair_agent,
            open_record_mutation_repair_instruction,
            seeded_create_navigate,
            turn_has_mutation_action,
            turn_has_navigation_action,
            with_leading_system_instruction,
        )

        agent_for_mod = specialist_agent_for_module(
            mod, pathname=str(context.get("pathname") or "")
        )
        if (
            surface == "create"
            and mutation_repair_agent(agent_for_mod)
            and not clarification_requested
            and not turn_has_mutation_action(proposals=proposals, patch=patch)
            and not turn_has_navigation_action(proposals)
        ):
            wanted = await llm_open_record_mutation_requested(
                user_text=user_text,
                agent_name=agent_for_mod,
                module=mod,
                surface=surface,
                entity_id=entity_id if isinstance(entity_id, str) else None,
                catalog=catalog,
                remaining_seconds=16.0,
                messages=messages,
            )
            if not wanted and (speech or "").strip():
                wanted = await llm_speech_claims_mutation_done(
                    assistant_text=speech,
                    remaining_seconds=10.0,
                )
            if wanted:
                repair = await chat_with_tools(
                    messages=with_leading_system_instruction(
                        openai_msgs,
                        open_record_mutation_repair_instruction(
                            agent_name=agent_for_mod,
                            module=mod,
                            surface=surface,
                            entity_id=entity_id
                            if isinstance(entity_id, str)
                            else None,
                        ),
                    ),
                    tools=tools,
                    tool_choice="required",
                    max_tokens=700,
                    timeout_ms=25_000,
                    temperature=0.0,
                )
                extra = (repair or {}).get("tool_calls") or []
                extra_speech = str((repair or {}).get("content") or "").strip()
                if extra_speech:
                    speech = extra_speech
                for tc in extra if isinstance(extra, list) else []:
                    if not isinstance(tc, dict):
                        continue
                    fn = tc.get("function") if isinstance(tc.get("function"), dict) else {}
                    name = str(fn.get("name") or tc.get("name") or "").strip()
                    if not name or name not in allowed:
                        continue
                    raw_args = fn.get("arguments") if fn else tc.get("arguments")
                    args: dict[str, Any] = {}
                    if isinstance(raw_args, dict):
                        args = raw_args
                    elif isinstance(raw_args, str) and raw_args.strip():
                        try:
                            parsed = json.loads(raw_args)
                            if isinstance(parsed, dict):
                                args = parsed
                        except json.JSONDecodeError:
                            args = {}
                    console_coworker("tool_call", agent="native", name=name, text=args)
                    mcp_res = await mcp.call_tool(name, args, context=mcp_ctx)
                    console_coworker(
                        "tool_response",
                        agent="native",
                        name=name,
                        ok=bool(mcp_res),
                        text=mcp_res if mcp_res else {"ok": False, "error": "empty"},
                    )
                    try:
                        from app.observability.turn_log import (
                            current_turn_agent,
                            record_tool,
                            turn_active,
                        )

                        if turn_active():
                            record_tool(
                                name,
                                args,
                                mcp_res if mcp_res else {"ok": False, "error": "empty"},
                                agent=current_turn_agent(),
                            )
                    except Exception:  # noqa: BLE001
                        pass
                    if not mcp_res:
                        continue
                    parts = mcp_result_to_turn_parts(name, mcp_res)
                    if isinstance(parts.get("patch"), dict):
                        patch.update(parts["patch"])
                    if isinstance(parts.get("toolProposal"), dict):
                        proposals.append(parts["toolProposal"])
                    if isinstance(parts.get("uiRefresh"), dict):
                        _merge_refresh(ui_refresh_acc, parts["uiRefresh"])

        if clarification_requested:
            proposals.clear()

        ui_refresh = end_agent_mcp_context()
        _merge_refresh(ui_refresh, ui_refresh_acc)
        http_refresh = mcp.drain_ui_refresh()
        if http_refresh:
            _merge_refresh(ui_refresh, http_refresh)

        if patch:
            speech = speech_after_draft_patch(
                speech=speech,
                mod=mod,
                entity_id=entity_id if isinstance(entity_id, str) else None,
                current_draft=draft,
                patch=patch,
                tools=proposals,
                user_text=user_text,
            )
        prior_speech = speech
        speech = strip_internal_workspace_sentences(speech)
        if is_generic_coworker_speech(speech):
            speech = ""
        if prior_speech and not speech:
            logger.warning(
                fmt(
                    agent="native",
                    step="speech_stripped",
                    module=mod,
                    surface=surface,
                    prior=prior_speech,
                )
            )
        if not speech and not proposals and not patch and not session_memory_patch:
            logger.error(
                fmt(
                    agent="native",
                    step="empty_turn",
                    module=mod,
                    surface=surface,
                    ok=False,
                )
            )
            return None
        from app.orchestrator.coworker_mutation_finalize import (
            finalize_legacy_native_turn_mutations,
        )

        speech = await finalize_legacy_native_turn_mutations(
            module=mod,
            surface=surface,
            entity_id=entity_id if isinstance(entity_id, str) else None,
            pathname=str(context.get("pathname") or ""),
            catalog=catalog,
            user_text=user_text,
            proposals=proposals,
            patch=patch,
            speech=speech,
            messages=messages,
        )
        if seeded_create_navigate(proposals):
            speech = ""
        out: dict[str, Any] = {
            "ok": True,
            "assistantText": speech,
            "source": "ai",
        }
        if proposals:
            _enrich_import_proposals_from_user_text(proposals, user_text)
            out["toolProposals"] = proposals
        if session_memory_patch:
            out["sessionMemoryPatch"] = session_memory_patch
        if patch:
            if mod == "company" and not entity_id:
                from app.agents.draft_conversation import (
                    clamp_company_patch_to_walk,
                    company_next_ask_key,
                    normalize_company_address_patch,
                )

                ask = company_next_ask_key(draft if isinstance(draft, dict) else {})
                patch = clamp_company_patch_to_walk(patch, ask=ask)
                patch = dict(
                    normalize_company_address_patch(
                        patch, draft if isinstance(draft, dict) else {}
                    )
                    or {},
                )
            out["patch"] = patch
            if mod == "contact":
                out["contactDraftPatch"] = patch
        if ui_refresh:
            out["uiRefresh"] = ui_refresh
        if mod == "quotes" and surface == "create":
            from app.agents.coworker_shared import enrich_quote_result_from_catalog

            out = enrich_quote_result_from_catalog(
                out,
                user_text=user_text,
                draft=draft,
                catalog=catalog,
                messages=messages,
            )
        if mod == "quotes" and surface == "detail":
            from app.agents.coworker_shared import enrich_quote_detail_update_from_llm

            out = enrich_quote_detail_update_from_llm(
                out,
                user_text=user_text,
                messages=messages,
                catalog=catalog,
                entity_id=entity_id if isinstance(entity_id, str) else None,
            )
        speech_out = str(out.get("assistantText") or "").strip()
        if not speech_out and (out.get("patch") or out.get("toolProposals")):
            from app.agents.crm_agent import _ensure_llm_route_speech

            out = await _ensure_llm_route_speech(
                out,
                None,
                user_text=user_text,
                mod=mod,
                surface=surface,
                draft=draft,
            )
            speech_out = str(out.get("assistantText") or "").strip()
        result_payload = dict(
            agent="native",
            step="result",
            module=mod,
            surface=surface,
            speech=out.get("assistantText"),
            speechLen=len(speech_out),
            emptySpeech=not speech_out,
            tools=tool_names(out),
            patch=out.get("patch") or out.get("contactDraftPatch"),
        )
        if not speech_out and (out.get("patch") or out.get("toolProposals")):
            logger.warning(fmt(**result_payload, reason="tool_calls_no_speech"))
        else:
            logger.info(fmt(**result_payload))
        return out
    except Exception as exc:  # noqa: BLE001
        end_agent_mcp_context()
        logger.error(
            fmt(
                agent="native",
                step="error",
                module=mod,
                surface=surface,
                ok=False,
                error=str(exc),
            )
        )
        raise