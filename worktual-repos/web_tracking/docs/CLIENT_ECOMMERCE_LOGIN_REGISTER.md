# Worktual Analytics — E-commerce Login & Register

**Audience:** E-commerce storefront developers  
**From:** Worktual team  

Standalone guide for **customer login and registration** only.  
For product/cart/purchase events see [CLIENT_FULL_ECOMMERCE_INTEGRATION_GUIDE.md](./CLIENT_FULL_ECOMMERCE_INTEGRATION_GUIDE.md).  
For contact/lead forms see [CLIENT_CONTACT_FORM.md](./CLIENT_CONTACT_FORM.md).

---

## Before you start

Worktual provides three values — use them exactly as given:

| Init field | Rule |
|------------|------|
| `websiteId` | Numeric site ID from Worktual |
| `websiteUrl` | Must **exactly** match registered URL (scheme + host), e.g. `https://www.yourstore.com` |
| `organizationId` | Numeric org ID from Worktual |

Wrong `websiteUrl` → ingest rejects payloads.

### Script URL

| Environment | SDK script |
|-------------|------------|
| **Production** | `https://nlp-storage.worktual.co.uk/wsnlp/Web_Tracking/JavaScript_sdk/sdk/v1/web_tracking_v3.js` |
| **QA** | `https://qatracking.worktual.com/webtracking.min.js` |

### Universal snippet (required on every page)

Load once, just before `</body>`:

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

Login and register **require explicit SDK calls** in your submit handler after your API succeeds.

Works with **any framework** (React, Vue, Angular, Next.js, plain HTML). You do **not** need to change your UI — only add SDK calls in your existing submit handler.

---

## Standard names (use only these)

Your store UI may say “Sign in” or “Create account” — that is fine. In the SDK, always use:

| User action | Form label (`formId`, `data-wt-form`, `leadForms`) | SDK method (after API success) | Event stored in Worktual |
|-------------|-----------------------------------------------------|--------------------------------|--------------------------|
| **Login** | `login` | `WorktualAnalytics.login({ … })` | `login` (+ `identify`) |
| **Register** | `register` | `WorktualAnalytics.register({ … })` | `register` (+ `identify`) |

**Same name everywhere** — if you use `data-wt-form="register"`, call `formSuccess('register')` and `register({ … })`. The stored event is also `register`.

**Do not use:** `signin`, `sign-in`, `signup`, or `sign_up`.

**Quick copy-paste:**

```javascript
// Login
WorktualAnalytics.formSuccess('login');
WorktualAnalytics.login({ userId, method: 'email', email, … });
await WorktualAnalytics.flush();

// Register
WorktualAnalytics.formSuccess('register');
WorktualAnalytics.register({ userId, method: 'email', email, … });
await WorktualAnalytics.flush();
```

---

## What is required vs optional

| Step | Required? | Purpose |
|------|-----------|---------|
| Call `formSuccess` + `login` / `register` after API success | **Yes** | Identity + conversion tracking |
| Call `formFailure` on API error | Recommended | Failed login/register in Forms dashboard |
| `await WorktualAnalytics.flush()` before navigation | **Yes** (SPA) | Ensures payload sends before page change |
| Mark the form container (`data-wt-form` or `leadForms`) | **Optional** | Extra funnel events: `form_view`, `form_start`, `form_submit` |

**If you skip marking the form:** `formSuccess('login')` and `login({ … })` still work. You only lose automatic pre-submit form events.

Passwords are **never** stored by the SDK.

---

## How to attach login / register forms (optional)

Use the same **`formId`** in attach code and SDK calls: `'login'` or `'register'`.

### Method A — HTML attribute (any framework)

```jsx
// React / Next.js
<div data-wt-form="login" id="login-root">...</div>
<div data-wt-form="register" id="register-root">...</div>
```

```html
<!-- Plain HTML / PHP / Shopify -->
<div data-wt-form="login">...</div>
<div data-wt-form="register">...</div>
```

### Method B — CSS selector in `init()` (no HTML change)

```javascript
WorktualAnalytics.init({
  websiteId: YOUR_WEBSITE_ID,
  websiteUrl: 'https://your-registered-store.com',
  organizationId: YOUR_ORGANIZATION_ID,
  leadForms: [
    { formId: 'login',    root: '#login-root',    submit: 'button[type="submit"]' },
    { formId: 'register', root: '#register-root', submit: 'button[type="submit"]' },
  ],
});
```

Change `root` and `submit` to match your DOM.

### Method C — Register after SPA render

```javascript
// Login page — call once on mount
WorktualAnalytics.registerLeadForm({
  formId: 'login',
  root: document.querySelector('#login-root'),
  submit: 'button[type="submit"]',
});

// Register page — same pattern with formId: 'register'
WorktualAnalytics.registerLeadForm({
  formId: 'register',
  root: document.querySelector('#register-root'),
  submit: 'button[type="submit"]',
});
```

The SDK rescans on SPA navigation automatically.

---

## Required — call SDK after your API responds

On **AJAX / SPA** login and register, add these calls **inside your existing submit handler** — after your API returns success, **before** `navigate()` or `window.location`.

**Always `await WorktualAnalytics.flush()` before navigation.**

---

## API reference

### `WorktualAnalytics.formSuccess(formId)`

| | |
|---|---|
| **When** | Login or register API returned success (AJAX) |
| **formId** | `'login'` or `'register'` |

```javascript
WorktualAnalytics.formSuccess('login');
WorktualAnalytics.formSuccess('register');
```

### `WorktualAnalytics.formFailure(formId, props)`

| | |
|---|---|
| **When** | Login or register API failed |

| Prop key | Example |
|----------|---------|
| `reason` | `'invalid_credentials'`, `'register_failed'` |

```javascript
WorktualAnalytics.formFailure('login', { reason: 'invalid_credentials' });
WorktualAnalytics.formFailure('register', { reason: 'register_failed' });
```

### `WorktualAnalytics.login(props)`

| | |
|---|---|
| **When** | Immediately after successful login API |
| **After** | Call `formSuccess('login')` first for email login |

| Prop key | Required | Type | Example |
|----------|----------|------|---------|
| `userId` | **Yes** | string | Customer ID from your API |
| `method` | **Yes** | string | `'email'` or `'google'` |
| `email` | No | string | `'shopper@example.com'` |
| `phone` | No | string | `'+441234567890'` |
| `firstName` | No | string | `'Jane'` |
| `lastName` | No | string | `'Doe'` |

**Do not send:** `password`, OTP, tokens.

```javascript
WorktualAnalytics.formSuccess('login');
WorktualAnalytics.login({
  userId: String(customer.id),
  method: 'email',
  email: customer.email,
  phone: customer.phone,
  firstName: customer.firstName,
  lastName: customer.lastName,
});
await WorktualAnalytics.flush();
```

**Google login** (skip `formSuccess` if there is no login form):

```javascript
WorktualAnalytics.login({
  userId: String(customer.id),
  method: 'google',
  email: customer.email,
  phone: customer.phone,
  firstName: customer.firstName,
  lastName: customer.lastName,
});
await WorktualAnalytics.flush();
```

### `WorktualAnalytics.register(props)`

| | |
|---|---|
| **When** | Immediately after successful register API |
| **After** | Call `formSuccess('register')` first |
| **Event sent** | `register` (+ `identify`) |

| Prop key | Required | Type | Example |
|----------|----------|------|---------|
| `userId` | **Yes** | string | New customer ID |
| `method` | **Yes** | string | `'email'` or `'google'` |
| `email` | No | string | |
| `phone` | No | string | |
| `firstName` | No | string | |
| `lastName` | No | string | |
| `source` | No | string | `'register_page'` |

```javascript
WorktualAnalytics.formSuccess('register');
WorktualAnalytics.register({
  userId: String(customer.id),
  method: 'email',
  email: customer.email,
  phone: customer.phone,
  firstName: customer.firstName,
  lastName: customer.lastName,
  source: 'register_page',
});
await WorktualAnalytics.flush();
```

---

## Events & dashboard

| Form label | SDK call | Event sent | Dashboard |
|------------|----------|------------|-----------|
| `login` | `formSuccess('login')` | `form_success` | Forms |
| `login` | `formFailure('login', …)` | `form_failure` | Forms |
| — | `login({ … })` | `login` + `identify` | Visitor linked to `userId` |
| `register` | `formSuccess('register')` | `form_success` | Forms |
| — | `register({ … })` | `register` + `identify` | Visitor linked to `userId` |

Identity fields (`email`, `phone`, names) are stored in Worktual’s known-user table and linked to the browser `visitor_id`.

---

## Go-live checklist

- [ ] Universal snippet on all pages with correct `websiteId`, `websiteUrl`, `organizationId`
- [ ] Standard names only: `login` and `register` (form label, SDK method, event name)
- [ ] Optional: `data-wt-form="login"` / `"register"`
- [ ] `formSuccess('login'|'register')` + `login()` / `register()` after API success
- [ ] `formFailure` on API error
- [ ] `await flush()` before SPA navigation
- [ ] Pass `userId`, `method`, and identity fields when available
- [ ] Never send password or tokens
- [ ] Network tab: ingest POST contains `login` or `register` after test

---

*Replace `YOUR_WEBSITE_ID`, `YOUR_ORGANIZATION_ID`, and `https://your-registered-store.com` with values from Worktual.*
