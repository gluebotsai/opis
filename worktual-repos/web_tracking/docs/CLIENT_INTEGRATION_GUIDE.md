# Worktual Analytics — Client Integration Guide

How to add Worktual tracking to any website: **one script**, all frameworks (React, Vue, WordPress, plain HTML), plus **forms** and **custom events**.

Share this document with client developers. Replace placeholders `YOUR_WEBSITE_ID` and the full registered `websiteUrl` with values from Worktual admin.

> **E-commerce stores:** use **[CLIENT_FULL_ECOMMERCE_INTEGRATION_GUIDE.md](./CLIENT_FULL_ECOMMERCE_INTEGRATION_GUIDE.md)** instead — it includes this guide’s patterns plus login/register, product/cart/purchase/refund, and go-live checklists in one file.

---

## URLs

| Environment | SDK script | Ingest endpoint |
|-------------|------------|-----------------|
| **Production (CDN)** | `https://nlp-storage.worktual.co.uk/wsnlp/Web_Tracking/JavaScript_sdk/sdk/v1/web_tracking_v3.js` | `https://tracking.worktual.co.uk/webtracking/v1/tracking/nfs-ingestions` |
| **QA** | `https://qatracking.worktual.com/webtracking.min.js` | `https://qatrackingapi.worktual.com/webtracking/v1/tracking/nfs-ingestions` |
| **Local dev** | `http://localhost:7870/sdk/webtracking.js` (demo server) or built `sdk/dist/webtracking.js` | `http://localhost:7860/v1/tracking/nfs-ingestions` |

**Important:** `websiteUrl` in `init()` must **exactly match** the full URL registered in Worktual admin (e.g. `https://beta.worktual.co.uk`). A mismatch causes ingest to reject payloads.

---

## Quick start (copy-paste)

Add **before `</body>` on every page** (site-wide footer, GTM, or layout template):

```html
<!-- Worktual Analytics -->
<script src="https://nlp-storage.worktual.co.uk/wsnlp/Web_Tracking/JavaScript_sdk/sdk/v1/web_tracking_v3.js"></script>
<script>
WorktualAnalytics.init({
  websiteId: YOUR_WEBSITE_ID,
  websiteUrl: 'https://your-full-site-url.com',
  endpoint: 'https://tracking.worktual.co.uk/webtracking/v1/tracking/nfs-ingestions',
  trackForms: true,
  leadFormAutoScan: true,
  trackReplay: true,
  autoTrack: true,
  geolocation: true,
  fetchClientIp: true
});
</script>
```

**Optional:** set `organizationId` in `init()` — it is included on every payload (same camelCase as `websiteId`). The ingest API still **validates** it matches the registered website in admin. Snake_case `organization_id` in init is also accepted.

**Campaign email clicks:** when users land with `?wt={30-char-token}`, the SDK verifies HMAC and decodes org / campaign / contact into session attribution. The shared secret is **already in SDK defaults** (`webTrackingHmacSecret` in `config.js`, same as Campaign `WEB_TRACKING_HMAC_SECRET`). Override in `init()` only for production. See [WEB_TRACKING_LINK_DECODE.md](./WEB_TRACKING_LINK_DECODE.md).

After deploy: browse the site, submit a test form, and confirm data in the Worktual dashboard.

---

## What gets tracked automatically

| Feature | Config | Events |
|---------|--------|--------|
| Page views | `autoTrack: true` (default) | `page_view` |
| Standard HTML `<form>` | `trackForms: true` (default) | `form_start`, `form_submit`, … |
| Div-based forms | `trackForms: true` + auto-detect (`leadFormHeuristicScan`, default) | Same `form_*` events as `<form>` |
| Clicks / heatmap | `trackHeatmap: true` (default) | `click`, scroll, etc. |
| Visitor IP + geo | `fetchClientIp: true` (default) | Enriched server-side |

No extra code needed for page views or native `<form>` elements.

---

## Forms (any framework, any HTML structure)

Many sites use **div + inputs** instead of `<form>`. The SDK supports both.

**Auto-detect (default):** With `leadFormHeuristicScan: true` (default), div wrappers that contain **2+ inputs** or **1 input + submit button** are tracked automatically — no HTML changes needed. Works on e-commerce, blog, and React/Vue sites.

### Requirements for all forms

1. Each input should have **`name`** or **`id`**. If missing, the SDK falls back to associated **`<label>`** text or **`placeholder`**.
2. Use **`form_*` event names only via the SDK** — do not manually send `lead_form_*` (those do not appear in the dashboard Forms tab).
3. Password fields are automatically masked and not stored.
4. Exclude non-form widgets with `data-wt-no-form` on the container (e.g. site search).

### Option A — HTML attribute (recommended for ambiguous layouts)

Add `data-wt-form` on the form container:

```html
<div data-wt-form="contact" class="contact_formblock">
  <input name="name" type="text" placeholder="Name" />
  <input name="email" type="email" placeholder="Email" />
  <textarea name="message" rows="4"></textarea>
  <button type="submit">Send message</button>
</div>
```

Optional attributes:

| Attribute | Purpose |
|-----------|---------|
| `data-wt-form="contact"` | Form ID (required for auto-scan) |
| `data-wt-submit=".my-btn"` | Custom submit button selector |
| `data-wt-auto-success="true"` | Fire `form_success` immediately on click (demo/simple sites only) |

The SDK auto-detects `[data-wt-form]` on load and when SPAs (React/Vue) add new DOM nodes.

### Option B — CSS selector in init (no client HTML change)

Configure in `WorktualAnalytics.init()` — useful when the client cannot edit HTML:

```javascript
WorktualAnalytics.init({
  domainId: YOUR_DOMAIN_ID,
  domainName: 'YOUR_DOMAIN_NAME',
  endpoint: 'https://tracking.worktual.co.uk/webtracking/v1/tracking/nfs-ingestions',
  trackForms: true,
  leadFormAutoScan: true,
  leadForms: [
    {
      formId: 'contact',
      root: '.contact_formblock__iGq_9',   // wrapper class or #id
      submit: 'button[type="submit"]'      // submit button selector
    }
  ]
});
```

### AJAX / React / Vue submit (after API success)

When the form submits via JavaScript (no page reload), call **`formSuccess`** after your API returns success:

```javascript
async function submitContact() {
  const res = await fetch('/api/contact', { method: 'POST', body: JSON.stringify(data) });
  if (res.ok) {
    WorktualAnalytics.formSuccess('contact');  // formId matches data-wt-form or leadForms
    WorktualAnalytics.flush();                 // optional: send immediately
  } else {
    WorktualAnalytics.formFailure('contact', { reason: 'api_error' });
  }
}
```

**React example:**

```jsx
const handleSubmit = async (e) => {
  e.preventDefault();
  const ok = await saveContact(formData);
  if (ok) window.WorktualAnalytics?.formSuccess('contact');
};
```

**On failure:**

```javascript
WorktualAnalytics.formFailure('contact', { reason: 'validation_failed' });
```

### What is sent on form submit

```json
{
  "name": "form_submit",
  "properties": {
    "formId": "contact",
    "fields": {
      "name": "Jane Doe",
      "email": "jane@example.com",
      "message": "Hello"
    }
  }
}
```

### Where form data appears

| Location | What you see |
|----------|----------------|
| Dashboard → **Forms** | Funnel counts (views, submits, successes) |
| ClickHouse `fact_form_events.extra_data` | Full `fields` JSON |
| Script `python3 scripts/check_form_tracking.py --domain-id ID` | Latest submitted field values |

---

## Custom events (buttons, downloads, video, business actions)

Use **`WorktualAnalytics.track()`** for anything that is **not** a form.

### Naming rules (required)

| Rule | Valid | Invalid |
|------|-------|---------|
| Lowercase letters, numbers, underscores | `demo_requested` | `Demo-Requested` |
| Must start with a letter | `video_play` | `123_start` |
| Max 64 characters | `pricing_cta_click` | — |
| Max 50 property keys per event | — | — |

Pattern: `^[a-z][a-z0-9_]{0,63}$`

### Basic usage

```javascript
WorktualAnalytics.track('event_name', {
  key1: 'value1',
  key2: 'value2'
});
```

### Common examples

**Button click — book demo:**

```javascript
document.querySelector('#book-demo').addEventListener('click', function () {
  WorktualAnalytics.track('demo_requested', {
    page: 'pricing',
    plan: 'enterprise'
  });
});
```

**Brochure download:**

```javascript
WorktualAnalytics.track('brochure_download', {
  file: 'product-guide.pdf',
  section: 'resources'
});
```

**Video play:**

```javascript
WorktualAnalytics.track('video_play', {
  videoId: 'intro-2026',
  title: 'Product overview'
});
```

**Newsletter (non-form button):**

```javascript
WorktualAnalytics.track('newsletter_signup', {
  source: 'footer',
  list: 'product_updates'
});
```

### Identify logged-in users (optional)

```javascript
WorktualAnalytics.identify('USER-123', {
  email: 'user@example.com',
  plan: 'pro'
});

WorktualAnalytics.track('login_success', { method: 'email' });
```

### Where custom events appear

| Location | Table / API |
|----------|-------------|
| ClickHouse | `fact_custom_events` |
| Dashboard | Visitor journey, custom event reports |
| Internal query | `event_name` + `event_data` JSON |

See [EVENTS_REFERENCE.md](EVENTS_REFERENCE.md) for the full event catalog.

---

## Forms vs custom events — decision guide

| User action | What to use | Dashboard |
|-------------|-------------|-----------|
| Filled contact / lead form | Automatic `form_*` or `formSuccess('contact')` | **Forms** tab |
| Clicked “Book demo” | `track('demo_requested', {...})` | Custom events |
| Downloaded PDF | `track('brochure_download', {...})` | Custom events |
| Completed signup | `track('signup_completed', {...})` + `identify()` | Custom events + visitor |
| Watched video | `track('video_play', {...})` | Custom events |

**Rule of thumb:** If it collects **field values** (name, email, message) → **form**. If it is a **single action** → **custom event**.

---

## Framework notes

| Framework | Integration |
|-----------|-------------|
| **Plain HTML / WordPress** | Paste script in footer; add `data-wt-form` on form div |
| **React / Next.js** | Script in `_document` or layout; `formSuccess()` in submit handler |
| **Vue / Nuxt** | Script in `index.html` or app layout; same AJAX pattern |
| **Angular** | Script in `index.html`; call `formSuccess` from component |
| **SPA routing** | Page views tracked automatically when URL changes (`autoTrack`) |

The SDK uses **DOM-level** listeners and a **MutationObserver** — it does not depend on any framework.

---

## Manual registration (advanced)

Register a dynamic form after render:

```javascript
WorktualAnalytics.registerLeadForm({
  formId: 'contact',
  root: document.querySelector('.dynamic-form'),
  submit: 'button.send'
});
```

---

## Client checklist (send after deploy)

```text
□ Tracking script added before </body> on all pages
□ domainId and domainName are correct (match Worktual admin)
□ Form container has data-wt-form="..." OR leadForms configured
□ Each input has name="..." or id="..."
□ AJAX forms call WorktualAnalytics.formSuccess('formId') after API success
□ Custom buttons call WorktualAnalytics.track('event_name', { ... })
□ Custom event names are lowercase_with_underscores
□ Test form submit completed
□ Test at least one custom event fired
```

---

## Internal verification (Worktual team)

```bash
# Form events + field JSON
python3 scripts/check_form_tracking.py --domain-id YOUR_DOMAIN_ID --days 1

# Local demo site
python3 demo/serve.py
# → http://localhost:7870
```

**ClickHouse — latest form field data:**

```sql
SELECT
  created_at,
  form_id,
  event_type,
  JSONExtractRaw(extra_data, 'fields') AS fields
FROM web_tracking.fact_form_events
WHERE domain_id = YOUR_DOMAIN_ID
ORDER BY created_at DESC
LIMIT 10;
```

**ClickHouse — custom events:**

```sql
SELECT event_name, count() AS cnt
FROM web_tracking.fact_custom_events
WHERE domain_id = YOUR_DOMAIN_ID
  AND created_at >= now() - INTERVAL 7 DAY
GROUP BY event_name
ORDER BY cnt DESC;
```

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| No data at all | Wrong `domainId` / `domainName` | Match admin exactly |
| Form submits not in Forms tab | Using `lead_form_*` instead of `form_*` | Use SDK form tracking or `formSuccess()` |
| Div form not tracked | Auto-detect missed (search bar, single field) or `leadFormHeuristicScan: false` | Add `data-wt-form="contact"` or `leadForms` selector; ensure 2+ fields or 1 field + submit button |
| Div form clicks only, no values | Form not registered — only heatmap `click` events fired | Redeploy latest SDK; div forms auto-bind on focus. Values appear on `form_blur`, `form_change`, `form_submit` |
| Fields empty | Inputs missing `name` / `id` / label | Add `name` on inputs; SDK also resolves keys from `<label>` text and `placeholder` |
| Custom event rejected | Invalid name (uppercase, hyphen) | Use `snake_case` lowercase |
| GPS / city missing | Permission denied or HTTP site | HTTPS + user grants location |
| Private IP in dashboard | Visitor on local network | Normal for LAN; use `fetchClientIp` on public sites |

---

## Related documentation

- [EVENTS_REFERENCE.md](EVENTS_REFERENCE.md) — Full event catalog and storage
- [CLIENT_IP_GETIP.md](CLIENT_IP_GETIP.md) — Visitor IP and geo
- [VISITOR_DATA_COLLECTED.md](VISITOR_DATA_COLLECTED.md) — All collected fields
- [DATABASE_TABLES_RETENTION.md](DATABASE_TABLES_RETENTION.md) — ClickHouse tables and TTL

---

## Email template (copy for clients)

**Subject:** Worktual Analytics — tracking script setup

Hi,

Please add the attached tracking snippet to your website before `</body>` on every page.

**We will provide:** your `domainId` and `domainName`.

**For contact forms:** either add `data-wt-form="contact"` on your form container, or send us the CSS class of the form wrapper.

**For custom actions** (e.g. “Book demo”, downloads): add one line in your click handler:

```javascript
WorktualAnalytics.track('demo_requested', { page: 'pricing' });
```

Full instructions: [CLIENT_INTEGRATION_GUIDE.md](CLIENT_INTEGRATION_GUIDE.md)

Thanks,
