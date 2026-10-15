# WhatsApp template presets (v1 scope)

**Audience:** My Account team  
**Scope:** Three presets only — report, admin agent-attention alert, task due reminder (shared for agent and admin).

**Related:** [WHATSAPP_UTILITY_TEMPLATE_FLOW.md](./WHATSAPP_UTILITY_TEMPLATE_FLOW.md) · [WHATSAPP_TEMPLATE_API.md](./WHATSAPP_TEMPLATE_API.md)

---

## Rules

| Rule | Detail |
|------|--------|
| Category | `UTILITY` |
| Language | `en` (submit and send must match) |
| Template name | `^[a-z0-9_]+$` |
| Status DB | `accounts.whatsapp_template_submissions` |
| Send API | `POST {CCAAS_BASE}/internal/v1/whatsapp/templates` |
| `to` | E.164 digits, no `+` (e.g. `919150911820`) |

---

## Can agent + admin share one task template?

**Yes.** Same approved template, different recipient and parameter values at send time.

| Send to | `to` | How `{{1}}` is filled |
|---------|------|------------------------|
| **Agent** | Agent mobile on file | Task title (e.g. `Call back Raj - refund`) |
| **Admin** | Admin / supervisor mobile | `Agent Bharathi: Call back Raj - refund` |

Same body, same `{{2}}` date, `{{3}}` time, `{{4}}` link — only routing and wording of `{{1}}` change. No need for two Meta templates.

CCaaS tasks live in `ccass.agent_tasks` (`apps/cc-core/src/services/agent-tasks.ts`). Reminder job picks assignee phone for agent; optional admin copy uses org admin numbers when task is overdue or escalated.

---

## Preset summary

| # | `preset_key` | `template_name` | Recipient |
|---|--------------|-----------------|-----------|
| 1 | `reports` | `scheduled_report_pdf_v1` | Admin |
| 2 | `supervisor_agent_attention` | `supervisor_agent_attention_v1` | Admin |
| 3 | `task_due_reminder` | `task_due_reminder_v1` | Agent **or** admin (same template) |

Replace legacy approved templates: `weekly_performance_report`, `task_due_reminder_v4` (text-only, no PDF header).

---

## 1. Scheduled report (any report — PDF in header)

**One template for all report types.** Works for daily, weekly, monthly, hourly, or any custom schedule name the admin sets in CCaaS.

| At send time | Source | Example |
|--------------|--------|---------|
| PDF file | Header `DOCUMENT` | Actual run PDF (HTTPS URL) |
| `{{1}}` body | `scheduled_reports.name` | `Daily performance report` |
| `{{2}}` body | Report period label | `24 Aug 2026` / `August 2026` / `9:00 AM - 10:00 AM` |

Email may still attach the same PDF; WhatsApp delivers the **same file** via document header.

**Trigger:** Any `scheduled_report_runs` success (or manual Send now).  
**CCaaS:** `report-runner.ts` after PDF saved to disk.

### Submit for Meta approval

My Account must upload a **sample PDF** to Meta (Resumable Upload API) first and put the returned handle in `header_handle`.

```json
{
  "channelConfigId": "<channel_config_id>",
  "name": "scheduled_report_pdf_v1",
  "language": "en",
  "category": "UTILITY",
  "components": [
    {
      "type": "HEADER",
      "format": "DOCUMENT",
      "example": {
        "header_handle": ["<META_SAMPLE_PDF_HANDLE>"]
      }
    },
    {
      "type": "BODY",
      "text": "Report {{1}} for {{2}} is attached."
    }
  ]
}
```

| Part | Fixed at approval | Dynamic at send |
|------|-------------------|-----------------|
| Header | Format = `DOCUMENT` | PDF URL for this run |
| Body `{{1}}` | Placeholder | Schedule name (any label) |
| Body `{{2}}` | Placeholder | Period for this run |

### Send (after `APPROVED`)

```json
{
  "channelConfigId": "<channel_config_id>",
  "to": "919150911820",
  "templateName": "scheduled_report_pdf_v1",
  "languageCode": "en",
  "components": [
    {
      "type": "header",
      "parameters": [
        {
          "type": "document",
          "document": {
            "link": "https://app.example.com/api/v1/reports/runs/<runId>/pdf?token=<signed-token>"
          }
        }
      ]
    },
    {
      "type": "body",
      "parameters": [
        { "type": "text", "text": "Daily performance report" },
        { "type": "text", "text": "24 Aug 2026" }
      ]
    }
  ]
}
```

**PDF URL rules:**

- Public HTTPS (or signed URL Meta can fetch)
- Same PDF bytes as email attachment / `scheduled-reports` storage
- Suggested filename in storage: `{scheduleName}-{period}.pdf` (display name may depend on Meta / client)

**Examples of `{{1}}` / `{{2}}` (same template):**

| Schedule name (`{{1}}`) | Period (`{{2}}`) |
|---------------------------|------------------|
| Daily performance report | 24 Aug 2026 |
| Monthly performance report | August 2026 |
| Hourly performance report | 9:00 AM - 10:00 AM |
| ZIFO queue summary | Week ending 24 Aug 2026 |

No separate Meta templates per cadence — only the parameter values change.

---

## 2. Admin alert — agent needs attention

**Trigger:** Agent Not Ready ~10+ min with no active work (`agent_not_ready_escalated` in monitoring).  
**CCaaS:** `apps/cc-core/src/services/monitoring.ts`

**Submit:**

```json
{
  "channelConfigId": "<channel_config_id>",
  "name": "supervisor_agent_attention_v1",
  "language": "en",
  "category": "UTILITY",
  "components": [
    {
      "type": "BODY",
      "text": "Agent {{1}} needs attention: Not Ready for {{2}} with no active conversations. Open: {{3}}"
    }
  ]
}
```

| Var | Example |
|-----|---------|
| `{{1}}` | Agent name |
| `{{2}}` | `12 minutes` |
| `{{3}}` | Live Monitoring deep link (`focusAgentId`) |

**Send:** same `templateName` / `languageCode`; fill body parameters; `to` = admin supervisor mobile.

---

## 3. Task due reminder (agent + admin)

**Trigger:** Task due soon or overdue (`ccass.agent_tasks`).  
**One template** for both audiences — see table above.

**Submit:**

```json
{
  "channelConfigId": "<channel_config_id>",
  "name": "task_due_reminder_v1",
  "language": "en",
  "category": "UTILITY",
  "components": [
    {
      "type": "BODY",
      "text": "Reminder: {{1}} is due on {{2}} at {{3}}. Open: {{4}}"
    }
  ]
}
```

| Var | Agent example | Admin example |
|-----|---------------|---------------|
| `{{1}}` | `Call back Raj - refund` | `Agent Bharathi: Call back Raj - refund` |
| `{{2}}` | `26 Aug 2026` | same |
| `{{3}}` | `3:00 PM` | same |
| `{{4}}` | `/agent/tasks` link | `/admin/...` or monitoring task link |

**Send (agent):**

```json
{
  "channelConfigId": "<channel_config_id>",
  "to": "<agent_mobile>",
  "templateName": "task_due_reminder_v1",
  "languageCode": "en",
  "components": [
    {
      "type": "body",
      "parameters": [
        { "type": "text", "text": "Call back Raj - refund" },
        { "type": "text", "text": "26 Aug 2026" },
        { "type": "text", "text": "3:00 PM" },
        { "type": "text", "text": "https://app.example.com/agent/tasks" }
      ]
    }
  ]
}
```

**Send (admin):** same payload shape; change `to`, prefix `{{1}}` with agent name, use admin task/monitoring URL.

---

## My Account checklist

- [ ] Upload sample PDF to Meta before submit (`header_handle` for DOCUMENT header)
- [ ] Submit all 3 templates → poll until `approved`
- [ ] Store in `whatsapp_template_submissions` with `preset_key` as above
- [ ] Enable toggle per preset (only when `approved`)
- [ ] Configure admin mobile(s) for reports + supervisor alerts
- [ ] Configure agent mobile on user profile for task reminders
- [ ] Dedupe: max 1 agent-attention alert per agent per hour; max 1 task reminder per task per day

---

## CCaaS integration (when wired)

| `preset_key` | Trigger |
|--------------|---------|
| `reports` | Report run succeeded — pass schedule name + period + PDF URL in header |
| `supervisor_agent_attention` | Presence escalation in monitoring |
| `task_due_reminder` | Task due/overdue scheduler (agent + optional admin copy) |
