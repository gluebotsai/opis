# Worktual Analytics — Full E-commerce Integration Guide

**Audience:** Any e-commerce storefront developer on Worktual  
**From:** Worktual team  

Worktual provides: **`websiteId`**, **`websiteUrl`** (exact registered URL), **`organizationId`**, SDK script URL.

This document covers everything in one place:

1. Universal snippet (all pages)  
2. Login & register  
3. Product, cart, wishlist, checkout, purchase, refund  
4. Contact forms & custom events  
5. Go-live checklist  

**Focused guides (send to clients separately):**

| Topic | Document |
|-------|----------|
| Login & register only | [CLIENT_ECOMMERCE_LOGIN_REGISTER.md](./CLIENT_ECOMMERCE_LOGIN_REGISTER.md) |
| Contact / lead forms only | [CLIENT_CONTACT_FORM.md](./CLIENT_CONTACT_FORM.md) |

---

## Before you start

| Init field | Rule |
|------------|------|
| `websiteId` | Numeric site ID from Worktual |
| `websiteUrl` | Must **exactly** match registered URL (scheme + host), e.g. `https://www.yourstore.com` |
| `organizationId` | Numeric org ID from Worktual |

Wrong `websiteUrl` → ingest rejects payloads.

---

## Script URLs

| Environment | SDK script |
|-------------|------------|
| **Production** | `https://nlp-storage.worktual.co.uk/wsnlp/Web_Tracking/JavaScript_sdk/sdk/v1/web_tracking_v3.js` |
| **QA** | `https://qatracking.worktual.com/webtracking.min.js` |

Ingest endpoint is set inside the SDK (production: `tracking.worktual.co.uk`).

---

# Part 1 — Universal snippet (all pages)

### Where

- Every page: home, category, product, cart, checkout, thank-you, login, account.  
- Just before `</body>` in global layout (theme footer, `theme.liquid`, React root layout).  
- Load **once** only.

### Snippet

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

### Automatic (no extra code)

| Feature | SDK default |
|---------|-------------|
| Page views, navigation | On |
| Clicks, scroll, heatmap | On |
| Form submit / success / failure tracking | On |
| Session replay (if enabled for your account) | On |

Cart, wishlist, checkout, purchase, login, and register **require explicit SDK calls** in Parts 2–3.

---

# Part 2 — Login & register

> **Standalone doc:** [CLIENT_ECOMMERCE_LOGIN_REGISTER.md](./CLIENT_ECOMMERCE_LOGIN_REGISTER.md)

For stores with customer accounts (email login, Google login, registration).

Works with **any framework** (React, Vue, Angular, Next.js, plain HTML). You do **not** need to change your UI framework — only call the SDK from your existing submit handler.

---

### Standard names (use only these)

Worktual uses **two fixed strings** for auth. Your store UI may say “Sign in” or “Create account” — that is fine. In the SDK, always use the names below.

| User action | Form label (`formId`, `data-wt-form`, `leadForms`) | SDK method (after API success) | Event stored in Worktual |
|-------------|-----------------------------------------------------|--------------------------------|--------------------------|
| **Login** | `login` | `WorktualAnalytics.login({ … })` | `login` (+ `identify`) |
| **Register** | `register` | `WorktualAnalytics.register({ … })` | `register` (+ `identify`) |

**Same name everywhere** — if you use `data-wt-form="register"`, call `formSuccess('register')` and `register({ … })`. The stored event is also `register`.

**Do not use:** `signin`, `sign-in`, `signup`, or `sign_up`. Those are not the standard names.

**Quick copy-paste pattern:**

```javascript
// Login
WorktualAnalytics.formSuccess('login');
WorktualAnalytics.login({ userId, method: 'email', email, … });
await WorktualAnalytics.flush();

// Register — same word for form, method, and event
WorktualAnalytics.formSuccess('register');
WorktualAnalytics.register({ userId, method: 'email', email, … });
await WorktualAnalytics.flush();
```

Optional form marking (Methods A/B/C below) uses the same strings: `login` or `register`.

---

### What is required vs optional

| Step | Required? | Purpose |
|------|-----------|---------|
| Call `formSuccess` + `login` / `register` after API success | **Yes** | Identity + conversion tracking |
| Call `formFailure` on API error | Recommended | Failed login/register in Forms dashboard |
| `await WorktualAnalytics.flush()` before navigation | **Yes** (SPA) | Ensures payload sends before page change |
| Mark the form container (`data-wt-form` or `leadForms`) | **Optional** | Extra Forms funnel events: `form_view`, `form_start`, `form_submit` on button click |

**If you skip marking the form:** `formSuccess('login')` and `login({ … })` still work. You only lose automatic pre-submit form events.

Passwords are **never** stored by the SDK.

---

### Optional — register login/register forms (pick one method)

Use the same **`formId` string** in your SDK calls (`'login'`, `'register'`).

#### Method A — HTML attribute (any framework that renders DOM)

Works in React, Vue, etc. — it is a normal DOM attribute:

```jsx
// React / Next.js
<div data-wt-form="login" id="login-root">...</div>
<div data-wt-form="register" id="register-root">...</div>
```

```html
<!-- Plain HTML / PHP / Shopify -->
<div data-wt-form="login">...</div>
```

#### Method B — CSS selector in `init()` (no HTML change)

If the client cannot edit templates, register forms in the universal snippet:

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

Change `root` and `submit` to match the store’s DOM (class names, ids).

#### Method C — Register after render (SPA)

Call once when the login page mounts:

```javascript
WorktualAnalytics.registerLeadForm({
  formId: 'login',
  root: document.querySelector('#login-root'),
  submit: 'button[type="submit"]',
});
```

Same for `'register'`. The SDK rescans on SPA navigation automatically.

---

### Required — call SDK after your API responds

On **AJAX / SPA** login and register, add these calls **inside your existing submit handler** — after your API returns success, **before** `navigate()` or `window.location`.

**Always `await WorktualAnalytics.flush()` before navigation.**

---

### API reference — login & register

#### `WorktualAnalytics.formSuccess(formId)`

| | |
|---|---|
| **When** | Login or register API returned success (AJAX, no full page reload) |
| **formId** | Stable label: `'login'` or `'register'` (same string used in Method A/B/C if you registered the form) |

```javascript
WorktualAnalytics.formSuccess('login');
WorktualAnalytics.formSuccess('register');
```

---

#### `WorktualAnalytics.formFailure(formId, props)`

| | |
|---|---|
| **When** | Login or register API failed |

| Prop key | Required | Example |
|----------|----------|---------|
| `reason` | Recommended | `'invalid_credentials'`, `'register_failed'` |

```javascript
WorktualAnalytics.formFailure('login', { reason: 'invalid_credentials' });
WorktualAnalytics.formFailure('register', { reason: 'register_failed' });
```

---

#### `WorktualAnalytics.login(props)`

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

**Google login** (no email form — skip `formSuccess` if there is no login form):

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

---

#### `WorktualAnalytics.register(props)`

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

### Login / register — events & dashboard

| Form label | SDK call | Event sent | Dashboard |
|------------|----------|------------|-----------|
| `login` | `formSuccess('login')` | `form_success` | Forms |
| `login` | `formFailure('login', …)` | `form_failure` | Forms |
| — | `login({ … })` | `login` + `identify` | Visitor linked to `userId` |
| `register` | `formSuccess('register')` | `form_success` | Forms |
| — | `register({ … })` | `register` + `identify` | Visitor linked to `userId` |

Identity fields (`email`, `phone`, names) are stored in Worktual’s known-user table and linked to the browser `visitor_id`.

---

# Part 3 — E-commerce events

Part 1 must be on the page. All calls use `WorktualAnalytics.*`.

### Shared product props

Used by `productView`, `addToCart`, `removeFromCart`, `addToWishlist`, `removeFromWishlist`:

| Prop key | Required | Type | Example |
|----------|----------|------|---------|
| `productId` | **Yes** | string | `'SKU-100'` |
| `productName` | Recommended | string | `'Blue Widget'` |
| `productPrice` | Recommended | number | `29.99` |
| `currency` | Recommended | string | `'GBP'` |
| `quantity` | No | number | `1` (default) |
| `productCategory` | No | string | `'Widgets'` |
| `productBrand` | No | string | `'YourBrand'` |

---

### 3.1 `WorktualAnalytics.productView(props)`

| | |
|---|---|
| **When** | Product detail page (PDP) loads — once per product per visit |
| **Where** | Product template, PDP component `useEffect` |

```javascript
WorktualAnalytics.productView({
  productId: 'SKU-100',
  productName: 'Blue Widget',
  productPrice: 29.99,
  currency: 'GBP',
  productCategory: 'Widgets',
  productBrand: 'YourBrand',
});
```

---

### 3.2 `WorktualAnalytics.addToCart(props)`

| | |
|---|---|
| **When** | User clicks Add to cart |
| **Where** | Add-to-cart button handler |

Uses **shared product props** above. `productId` required.

```javascript
WorktualAnalytics.addToCart({
  productId: 'SKU-100',
  productName: 'Blue Widget',
  productPrice: 29.99,
  currency: 'GBP',
  quantity: 1,
});
```

---

### 3.3 `WorktualAnalytics.removeFromCart(props)`

| | |
|---|---|
| **When** | User removes item from cart **or** on thank-you for each purchased line (see §3.7) |
| **Where** | Cart remove handler; thank-you page |

Uses **shared product props**. `productId` required.

```javascript
WorktualAnalytics.removeFromCart({
  productId: 'SKU-100',
  productName: 'Blue Widget',
  currency: 'GBP',
  quantity: 1,
});
```

---

### 3.4 `WorktualAnalytics.addToWishlist(props)`

| | |
|---|---|
| **When** | User adds to wishlist |
| **Where** | Wishlist button handler |

Uses **shared product props**. Skip if store has no wishlist.

---

### 3.5 `WorktualAnalytics.removeFromWishlist(props)`

| | |
|---|---|
| **When** | User removes from wishlist page |
| **Where** | Wishlist remove handler |

Uses **shared product props**.

---

### 3.6 `WorktualAnalytics.beginCheckout(props)`

| | |
|---|---|
| **When** | Checkout page loads — once per checkout |
| **Where** | Checkout template only |

| Prop key | Required | Type | Example |
|----------|----------|------|---------|
| `currency` | Recommended | string | `'GBP'` |
| `cartValue` | No | number | `129.99` |
| `itemCount` | No | number | `3` |

```javascript
WorktualAnalytics.beginCheckout({
  currency: 'GBP',
  cartValue: 129.99,
  itemCount: 3,
});
```

---

### 3.7 `WorktualAnalytics.purchase(props)` + clear cart

| | |
|---|---|
| **When** | Order thank-you page — **once per order** |
| **Where** | Thank-you template with order data from backend |

| Prop key | Required | Type | Example |
|----------|----------|------|---------|
| `orderId` | **Yes** | string | `'ORD-98765'` |
| `revenue` | **Yes** | number | `129.99` |
| `currency` | **Yes** | string | `'GBP'` |
| `products` | **Yes** | array | See line item object below |

**Line item object** (each entry in `products[]`):

| Key | Required | Type |
|-----|----------|------|
| `productId` | **Yes** | string |
| `productName` | Recommended | string |
| `productPrice` | Recommended | number |
| `quantity` | Recommended | number |

**After `purchase`**, call `removeFromCart()` for **each line** in `products` so visitor cart analytics match the empty store cart.

**Duplicate guard** — run once per order:

```javascript
var key = 'wt_purchase_' + orderId;
if (sessionStorage.getItem(key)) return;
sessionStorage.setItem(key, '1');
```

**Full thank-you example:**

```javascript
(function () {
  if (typeof WorktualAnalytics === 'undefined') return;

  var orderId = 'ORD-98765';
  var currency = 'GBP';
  var revenue = 129.99;
  var products = [
    { productId: 'SKU-100', productName: 'Blue Widget', productPrice: 29.99, quantity: 2 },
  ];

  var key = 'wt_purchase_' + orderId;
  if (sessionStorage.getItem(key)) return;
  sessionStorage.setItem(key, '1');

  WorktualAnalytics.purchase({
    orderId: orderId,
    revenue: revenue,
    currency: currency,
    products: products,
  });

  products.forEach(function (line) {
    WorktualAnalytics.removeFromCart({
      productId: line.productId,
      productName: line.productName,
      currency: currency,
      quantity: line.quantity || 1,
    });
  });

  WorktualAnalytics.flush();
})();
```

---

### 3.8 `WorktualAnalytics.refund(props)` (optional)

| | |
|---|---|
| **When** | Refund is confirmed (client or admin page) |

| Prop key | Required | Type | Example |
|----------|----------|------|---------|
| `orderId` | **Yes** | string | `'ORD-98765'` |
| `revenue` | **Yes** | number | Refunded amount only |
| `currency` | **Yes** | string | `'GBP'` |

```javascript
WorktualAnalytics.refund({
  orderId: 'ORD-98765',
  revenue: 29.99,
  currency: 'GBP',
});
```

---

### E-commerce quick reference

| User action | SDK call | Attach where |
|-------------|----------|--------------|
| PDP loads | `productView({ productId, … })` | Product page |
| Add to cart | `addToCart({ productId, … })` | Cart button handler |
| Remove from cart | `removeFromCart({ productId, … })` | Cart remove handler |
| Add to wishlist | `addToWishlist({ productId, … })` | Wishlist button |
| Remove from wishlist | `removeFromWishlist({ productId, … })` | Wishlist page |
| Checkout loads | `beginCheckout({ currency, … })` | Checkout page |
| Order complete | `purchase({ orderId, revenue, currency, products })` | Thank-you page |
| Clear cart analytics | `removeFromCart({ productId, … })` per purchased line | Thank-you page (after purchase) |
| Refund | `refund({ orderId, revenue, currency })` | Refund flow |

**Dashboard:** Product Analytics (views, cart, wishlist, purchases, refunds, engaged visitors).

---

# Part 4 — Contact forms & custom events

Works with **any framework** (React, Vue, Angular, plain HTML). Use the same attach pattern as login/register (Part 2).

---

### How you get form data on submit

When the user clicks **Submit**, the SDK automatically sends **`form_submit`** with all field values. You do **not** need `formSuccess` just to capture name, email, message, etc.

```
User fills form → clicks Submit → SDK sends form_submit → fields: { name, email, message, … }
```

| Event | When | Has field data? | Required? |
|-------|------|-----------------|-----------|
| **`form_submit`** | Submit button clicked | **Yes** — all fields | Automatic (form must be attached) |
| **`form_success`** | Your API returns OK (AJAX) | Yes (if form still in DOM) | Optional — marks confirmed success |
| **`form_failure`** | API or validation failed | Yes | Optional |

**Where data appears:** Worktual Dashboard → **Forms** (open a form to see each submission). Passwords and tokens are never stored.

---

### Step 1 — Attach the form (required)

Without attaching the form container, submit clicks are only heatmap clicks — **no field values**.

Use the same **`formId`** string everywhere (e.g. `'contact'`).

#### Method A — HTML attribute (any framework)

```html
<div data-wt-form="contact" id="contact-root">
  <input name="name" type="text" placeholder="Your name" />
  <input name="email" type="email" placeholder="Email" />
  <input name="phone" type="tel" placeholder="Phone" />
  <textarea name="message" placeholder="Message"></textarea>
  <button type="submit">Send</button>
</div>
```

React / Vue — same attribute on your wrapper div:

```jsx
<div data-wt-form="contact" id="contact-root">
  {/* inputs must have name= attributes */}
</div>
```

Optional attributes:

| Attribute | Purpose |
|-----------|---------|
| `data-wt-form="contact"` | Form ID (use `'contact'` or any stable label) |
| `data-wt-submit=".my-btn"` | Custom submit button selector |
| `data-wt-no-form` | Exclude a container (e.g. site search) from form tracking |

#### Method B — CSS selector in `init()` (no HTML change)

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

#### Method C — Register after SPA render

```javascript
WorktualAnalytics.registerLeadForm({
  formId: 'contact',
  root: document.querySelector('#contact-root'),
  submit: 'button[type="submit"]',
});
```

Native HTML `<form>` elements are also tracked automatically when `trackForms: true` (SDK default).

---

### Step 2 — Field keys (so values are captured)

Each input needs a key the SDK can read:

| Priority | Example |
|----------|---------|
| 1. `name` | `<input name="email" />` ← **recommended** |
| 2. `id` | `<input id="email" />` |
| 3. `data-wt-field` | `<input data-wt-field="email" />` |
| 4. Label text | `<label>Email</label><input />` |

**Never stored:** password, OTP, CVV, tokens (SDK masks them automatically).

---

### Step 3 — What is sent on submit (automatic)

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

No extra client code is needed for this — as long as the form is attached and inputs have `name` attributes.

---

### Step 4 — AJAX / SPA (optional `formSuccess`)

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

### Other form labels

Use any stable `formId` — same attach pattern:

| Form type | `formId` example |
|-----------|------------------|
| Contact us | `contact` |
| Request quote | `quote` |
| Book demo | `demo` |
| Newsletter | `newsletter` |

---

### Custom events

```javascript
WorktualAnalytics.track('newsletter_signup', {
  source: 'footer',
  listId: 'promo',
});
```

Event names: lowercase, underscores, start with a letter — e.g. `demo_requested`.

---

# Part 5 — Go-live checklist

### Universal

- [ ] Snippet on all pages with correct `websiteId`, `websiteUrl`, `organizationId`

### Login & register

- [ ] Standard names only: `login` and `register` (form label, SDK method, and event name)
- [ ] Optional: `data-wt-form="login"` / `"register"`
- [ ] `formSuccess('login'|'register')` + `login()` / `register()` after API success
- [ ] `formFailure` on API error
- [ ] `await flush()` before SPA navigation
- [ ] Pass `userId`, `method`, and identity fields when available
- [ ] Never send password or tokens

### Contact & lead forms

- [ ] Form attached: `data-wt-form="contact"` or `leadForms` / `registerLeadForm`
- [ ] Inputs have `name` attributes (`name`, `email`, `phone`, `message`, …)
- [ ] Test submit: Network tab shows `form_submit` with `fields` object
- [ ] AJAX sites: optional `formSuccess('contact')` after API OK + `await flush()`
- [ ] Forms dashboard shows submission with field values

### E-commerce

- [ ] `productView` on PDP
- [ ] `addToCart` / `removeFromCart`
- [ ] Wishlist calls if applicable
- [ ] `beginCheckout` on checkout
- [ ] `purchase` + `removeFromCart` per line on thank-you
- [ ] `wt_purchase_{orderId}` session guard
- [ ] `refund` if applicable

### Verify

- [ ] Network tab: ingest POST after login and after test order
- [ ] Worktual Dashboard + Product Analytics + Forms show test data

---

*Replace `YOUR_WEBSITE_ID`, `YOUR_ORGANIZATION_ID`, and `https://your-registered-store.com` with values from Worktual.*
