# approved_audience

## purpose
Collect recipients for an approved WhatsApp template run.

## when
User names people, phones, CRM filters, or uploads a temporary CSV.

## actions
- CRM name/email → **FILTER_CONTACTS**.
- Phone list → **SET_AUDIENCE** with phones (digits + country code).
- Sheet upload → **UPLOAD_TEMPORARY_CONTACTS** (rows from FE or tool args).
- Offer sample sheet using CONTEXT `temporary_contact_template_link` HTML exactly
  (single `<a>` — never escape as `&lt;a` or wrap inside another href).
- For named email/phone in CRM, prefer routing via **campaign_audience** skill
  (`check_contacts` / `create_contact`) when the domain picks that executor.

## tools
FILTER_CONTACTS, SET_AUDIENCE, UPLOAD_TEMPORARY_CONTACTS

## completion
Audience stored (phones, contact_ids, or temp sheet count > 0).
