# Worktual Analytics — Contact & Lead Forms

**Audience:** E-commerce and website developers  
**From:** Worktual team  

Standalone guide for **contact forms and lead forms** — how to attach the form and capture field data on submit.  
For login/register see [CLIENT_ECOMMERCE_LOGIN_REGISTER.md](./CLIENT_ECOMMERCE_LOGIN_REGISTER.md).  
For full e-commerce events see [CLIENT_FULL_ECOMMERCE_INTEGRATION_GUIDE.md](./CLIENT_FULL_ECOMMERCE_INTEGRATION_GUIDE.md).

---

## Before you start

| Init field | Rule |
|------------|------|
| `websiteId` | Numeric site ID from Worktual |
| `websiteUrl` | Must **exactly** match registered URL (scheme + host) |
| `organizationId` | Numeric org ID from Worktual |

### Script URL

| Environment | SDK script |
|-------------|------------|
| **Production** | `https://nlp-storage.worktual.co.uk/wsnlp/Web_Tracking/JavaScript_sdk/sdk/v1/web_tracking_v3.js` |
| **QA** | `https://qatracking.worktual.com/webtracking.min.js` |

### Universal snippet (required on every page)

```html
<!-- Worktual Analytics -->
<script src="https://nlp-storage.worktual.co.uk/wsnlp/Web_Tracking/JavaScript_sdk/sdk/v1/web_tracking_v3.js"></script>
<script>
  WorktualAnalytics.init({
    websiteId: YOUR_WEBSITE_ID,
    websiteUrl: 'https://your-registered-store.com',
    organizationId: YOUR_ORGANIZATION_ID,
  });
</script>
```

Works with **any framework** (React, Vue, Angular, plain HTML).

---

## How you get form data on submit

When the user clicks **Submit**, the SDK automatically sends **`form_submit`** with all field values. You do **not** need `formSuccess` just to capture name, email, message, etc.

```
User fills form → clicks Submit → SDK sends form_submit → fields: { name, email, message, … }
```

| Event | When | Has field data? | Required? |
|-------|------|-----------------|-----------|
| **`form_submit`** | Submit button clicked | **Yes** — all fields | Automatic (form must be attached) |
| **`form_success`** | Your API returns OK (AJAX) | Yes (if form still in DOM) | Optional — marks confirmed success |
| **`form_failure`** | API or validation failed | Yes | Optional |

**Where data appears:** Worktual Dashboard → **Forms** (open a form to see each submission with name, email, message, etc.).

Passwords and tokens are **never** stored.

---

## Step 1 — Attach the form (required)

Without attaching the form container, submit clicks are only heatmap clicks — **no field values**.

Use the same **`formId`** string everywhere (e.g. `'contact'`).

### Method A — HTML attribute (any framework)

```html
<div data-wt-form="contact" id="contact-root">
  <input name="name" type="text" placeholder="Your name" />
  <input name="email" type="email" placeholder="Email" />
  <input name="phone" type="tel" placeholder="Phone" />
  <textarea name="message" placeholder="Message"></textarea>
  <button type="submit">Send</button>
</div>
```

React / Vue:

```jsx
<div data-wt-form="contact" id="contact-root">
  <input name="name" value={name} onChange={...} />
  <input name="email" type="email" value={email} onChange={...} />
  <textarea name="message" value={message} onChange={...} />
  <button type="button" onClick={onSubmit}>Send</button>
</div>
```

Optional attributes:

| Attribute | Purpose |
|-----------|---------|
| `data-wt-form="contact"` | Form ID — use `'contact'` or any stable label |
| `data-wt-submit=".my-btn"` | Custom submit button selector |
| `data-wt-no-form` | Exclude a container (e.g. site search) from form tracking |

### Method B — CSS selector in `init()` (no HTML change)

Use when the client cannot edit page templates:

```javascript
WorktualAnalytics.init({
  websiteId: YOUR_WEBSITE_ID,
  websiteUrl: 'https://your-registered-store.com',
  organizationId: YOUR_ORGANIZATION_ID,
  leadForms: [
    {
      formId: 'contact',
      root: '#contact-root',              // or '.contact-form-wrapper'
      submit: 'button[type="submit"]',
    },
  ],
});
```

### Method C — Register after SPA render

Call once when the contact page mounts:

```javascript
WorktualAnalytics.registerLeadForm({
  formId: 'contact',
  root: document.querySelector('#contact-root'),
  submit: 'button[type="submit"]',
});
```

Native HTML `<form>` elements are also tracked automatically when `trackForms: true` (SDK default).

---

## Step 2 — Field keys (so values are captured)

Each input needs a key the SDK can read:

| Priority | Example |
|----------|---------|
| 1. `name` | `<input name="email" />` ← **recommended** |
| 2. `id` | `<input id="email" />` |
| 3. `data-wt-field` | `<input data-wt-field="email" />` |
| 4. Label text | `<label>Email</label><input />` |

**Never stored:** password, OTP, CVV, tokens (SDK masks them automatically).

---

## Step 3 — What is sent on submit (automatic)

When the user clicks Submit, the SDK sends:

```json
{
  "event_name": "form_submit",
  "formId": "contact",
  "fields": {
    "name": "Jane Doe",
    "email": "jane@example.com",
    "phone": "+441234567890",
    "message": "I need help with my order"
  }
}
```

**No extra client code needed** — as long as the form is attached and inputs have `name` attributes.

---

## Step 4 — AJAX / SPA (optional `formSuccess`)

For forms that submit via JavaScript (no full page reload), call **`formSuccess`** after your API confirms success. This marks a **confirmed** submission in the Forms dashboard.

```javascript
async function onContactSubmit(values) {
  try {
    const res = await fetch('/api/contact', {
      method: 'POST',
      body: JSON.stringify(values),
    });
    if (!res.ok) throw new Error('api_error');

    // Field data was already sent on Submit click (form_submit).
    // Optional — mark API-confirmed success (form must still be in DOM):
    WorktualAnalytics.formSuccess('contact');
    await WorktualAnalytics.flush();
  } catch {
    WorktualAnalytics.formFailure('contact', { reason: 'api_error' });
    await WorktualAnalytics.flush();
  }
}
```

Call `formSuccess` / `formFailure` **before** navigating away or unmounting the form.

**If the form is removed before you can call `formSuccess`**, pass fields manually:

```javascript
WorktualAnalytics.formSuccess('contact', {
  fields: {
    name: values.name,
    email: values.email,
    phone: values.phone,
    message: values.message,
  },
});
await WorktualAnalytics.flush();
```

Use manual `fields` only when the DOM container is gone. Prefer attach + auto-read when possible.

---

## Other form types (same attach pattern)

Use any stable `formId`:

| Form type | `formId` example | Attach |
|-----------|------------------|--------|
| Contact us | `contact` | `data-wt-form="contact"` |
| Request quote | `quote` | `data-wt-form="quote"` |
| Book demo | `demo` | `data-wt-form="demo"` |
| Newsletter | `newsletter` | `data-wt-form="newsletter"` |

Same three attach methods (A/B/C) apply — only change the `formId` string.

---

## Go-live checklist

- [ ] Universal snippet on all pages
- [ ] Form attached: `data-wt-form="contact"` or `leadForms` / `registerLeadForm`
- [ ] Inputs have `name` attributes (`name`, `email`, `phone`, `message`, …)
- [ ] Test submit: Network tab shows `form_submit` with `fields` object
- [ ] AJAX sites: optional `formSuccess('contact')` after API OK + `await flush()`
- [ ] Forms dashboard shows submission with field values

---

## Quick reference for clients

> Mark the form with `data-wt-form="contact"`, give inputs `name` attributes — when the user clicks Submit, Worktual automatically receives name, email, message, etc. in `form_submit`. You see it in the Forms dashboard.

---

*Replace `YOUR_WEBSITE_ID`, `YOUR_ORGANIZATION_ID`, and `https://your-registered-store.com` with values from Worktual.*
