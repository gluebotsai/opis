# library_audience

## purpose
Match, create, update, or attach temporary-sheet contacts for **this** library-run campaign session.

## when active
Domain selected `library_audience`. User names recipients, uploads a temp sheet, or asks to match/create contacts.

## chat flow

### 1 — Check Live session
Use existing audience / contact facts. Prefer tools over inventing emails or phones.

### 2 — When asking who should receive / who to send to
If `audience.has_matched_contacts` is false and you ask for recipients (including listing CRM
segments from `domain_contact_summary`), the same HTML reply MUST:
- Offer named emails/phones and/or CRM options **and** a temporary contact sheet as an equal option.
- Paste CONTEXT `temporary_contact_template_link` HTML exactly (clickable "Download sample sheet").
- Never invent, shorten, or paste a raw http(s) URL for the sheet — hypertext only.
- Never list CRM segments alone without that hypertext link in the same message.
Columns: firstName, lastName, email, phone, companyName, city (email OR phone per row).

If the user asks for the sheet / sample / CSV, paste that same `temporary_contact_template_link`
HTML again (hypertext only — never a bare URL).

### 3 — Tools
- **check_contacts** — find / match before create.
- **create_contact** — add missing contacts when appropriate.
- **upload_temporary_contacts** — temp sheet path (or rows arrive with the user message).
- **update_contact** — fix fields for a known contact.

### 4 — Scope
Audience is **not** required before creatives; it **is** required before launch (Domain enforces).

### 5 — Must not
- Call build_campaign or launch_campaign.
- Call update_campaign_setup for meta/channels (Domain → `library_brief`).
- Switch skills (Domain only).
- Ask for audience without including CONTEXT `temporary_contact_template_link` hypertext.
- Paste a naked sheet URL in chat.

## completion
Contacts created or temp sheet uploaded successfully (match-only may stay open for follow-up).

## resume
Continue matching/creating from prior criteria in chat + Live session.
