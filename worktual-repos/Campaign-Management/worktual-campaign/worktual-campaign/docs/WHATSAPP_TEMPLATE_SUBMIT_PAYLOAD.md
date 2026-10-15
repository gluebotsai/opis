# WhatsApp Meta submit-approval payload (Campaign)

Reference: CCaaS `POST {SOCIAL_SERVICE_BASE_URL}/internal/v1/whatsapp/templates/submit-approval`  
Auth: `x-internal-service-key`, `Content-Type: application/json`

## Campaign storage model

| User / agent edits | Persisted on `campaign_channel_template.fields` | Sent on launch |
|--------------------|--------------------------------------------------|----------------|
| `body` with `{{first_name}}`, `{{campaign_url}}` | Same named tags + rebuilt `components[]` | Full submit JSON |

Launch and TS `updateTemplateFieldsDao` call `syncWhatsAppSubmitPayload` / `buildSubmitComponentsFromAgentFields` so `components` always match the current draft.

## Submit body (minimal)

```json
{
  "channelConfigId": "1063",
  "name": "worktual_daily_report",
  "language": "en",
  "category": "UTILITY",
  "allowCategoryChange": false,
  "components": [
    {
      "type": "BODY",
      "text": "Your report for {{1}} is ready. Open: {{2}}",
      "example": { "body_text": [["Customer", "https://example.com"]] }
    }
  ]
}
```

## Component rules

- **BODY** — required; `{{n}}` not at start/end of text; add `example.body_text` when variables present.
- **HEADER** — optional; `format` TEXT | IMAGE | …
- **FOOTER** — optional; no variables.
- **BUTTONS** — optional; 1–3 of `QUICK_REPLY` | `URL` (no `PHONE_NUMBER` in Campaign).

## Agents

- **Generation:** `agents/.../template_library/channels/whatsapp/agent.py` + `meta_rules.py`
- **Edit:** `agents/.../template_edit/whatsapp/agent.md` + `sanitize_whatsapp_fields` on save/modify

## UI

WhatsApp card preview shows literal `{{first_name}}` — not sample merge values.
