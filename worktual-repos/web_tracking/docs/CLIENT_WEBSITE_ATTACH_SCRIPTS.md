# Worktual — Website attach scripts (purchase, clear cart, refund, forms)

**Audience:** Storefront / website developers  
**Use with:** Universal snippet from [CLIENT_ECOMMERCE_INTEGRATION.md](./CLIENT_ECOMMERCE_INTEGRATION.md) Part 1 (required on every page first).

This document is a **short copy-paste guide** for the scripts clients attach on:

| Page / action | Scripts |
|---------------|---------|
| Order thank-you | `purchase()` + `removeFromCart()` per purchased line |
| Refund recorded | `refund()` |
| Login page | Form tracking on submit (+ `login()` after success) |
| Other forms | Automatic or `formSuccess()` after AJAX |

---

## 0. Prerequisite — universal snippet (once per site)

Add before `</body>` in your global layout:

```html
<!-- Worktual Analytics -->
<script src="https://nlp-storage.worktual.co.uk/wsnlp/Web_Tracking/JavaScript_sdk/sdk/v1/web_tracking_v3.js"></script>
<script>
  WorktualAnalytics.init({
    websiteId: YOUR_WEBSITE_ID,
    websiteUrl: 'https://your-registered-store.com',
    organizationId: YOUR_ORGANIZATION_ID
  });
</script>
```

Replace `YOUR_WEBSITE_ID`, `websiteUrl`, and `YOUR_ORGANIZATION_ID` with values from Worktual admin.

---

## 1. Thank-you page — `purchase` + clear purchased cart lines

### When to attach

| | |
|---|---|
| **Page** | Order confirmation / thank-you (after payment succeeds) |
| **When** | Once per order (not on every refresh) |
| **Why two calls** | `purchase` → revenue KPIs. `removeFromCart` per line → visitor cart analytics match empty store cart |

### Copy-paste script (inline order data)

Replace `orderId`, `revenue`, `currency`, and `products` with real values from your backend:

```html
<script>
  (function () {
    if (typeof WorktualAnalytics === 'undefined') return;

    var orderId = 'ORD-98765';
    var currency = 'GBP';
    var revenue = 129.99;
    var products = [
      {
        productId: 'SKU-100',
        productName: 'Blue Widget',
        productPrice: 29.99,
        quantity: 2
      }
    ];

    // Prevent duplicate events on refresh
    var key = 'wt_purchase_' + orderId;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');

    // 1) Purchase — required for revenue & conversion KPIs
    WorktualAnalytics.purchase({
      orderId: orderId,
      revenue: revenue,
      currency: currency,
      products: products
    });

    // 2) Clear purchased lines from visitor cart analytics
    products.forEach(function (line) {
      WorktualAnalytics.removeFromCart({
        productId: line.productId,
        productName: line.productName,
        currency: currency,
        quantity: line.quantity || 1
      });
    });
  })();
</script>
```

### Copy-paste script (data from HTML — Shopify / Woo / PHP template)

Backend prints order JSON into a hidden element; one script reads it:

```html
<div id="wt-order" hidden
  data-order-id="ORD-98765"
  data-revenue="129.99"
  data-currency="GBP"
  data-products='[{"productId":"SKU-100","productName":"Blue Widget","productPrice":29.99,"quantity":2}]'>
</div>

<script>
  (function () {
    if (typeof WorktualAnalytics === 'undefined') return;

    var el = document.getElementById('wt-order');
    if (!el) return;

    var orderId = el.dataset.orderId;
    if (!orderId) return;

    var key = 'wt_purchase_' + orderId;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');

    var currency = el.dataset.currency || 'GBP';
    var revenue = Number(el.dataset.revenue);
    var products = [];
    try {
      products = JSON.parse(el.dataset.products || '[]');
    } catch (e) {}

    WorktualAnalytics.purchase({
      orderId: orderId,
      revenue: revenue,
      currency: currency,
      products: products
    });

    products.forEach(function (line) {
      WorktualAnalytics.removeFromCart({
        productId: line.productId,
        productName: line.productName,
        currency: currency,
        quantity: line.quantity || 1
      });
    });
  })();
</script>
```

### Alternative — `data-worktual-purchase` + helper file

1. Host or inline [`examples/worktual-ecommerce.js`](./examples/worktual-ecommerce.js) after `init`.
2. Mark thank-you page:

```html
<div data-worktual-purchase
  data-order-id="ORD-98765"
  data-revenue="129.99"
  data-currency="GBP"
  data-products='[{"productId":"SKU-100","productName":"Blue Widget","productPrice":29.99,"quantity":2}]'>
</div>
```

The helper calls `purchase()` and `clearPurchasedFromCart()` automatically.

### Rules

| Do | Don't |
|----|--------|
| Call on thank-you only | Call on checkout button click |
| Send `purchase` **and** `removeFromCart` per purchased line | Send only `removeFromCart` instead of `purchase` |
| Use same `productId` as add-to-cart events | Use different IDs per page |
| Guard with `sessionStorage` per `orderId` | Fire again on page refresh |

### Dashboard effect

| Event | Product Analytics | Visitor page |
|-------|-------------------|--------------|
| `purchase` | Purchases, purchase revenue | Conversions |
| `removeFromCart` (each line) | Cart removes | Est. cart qty goes down |

---

## 2. Refund — revenue script

### When to attach

| | |
|---|---|
| **When** | Your system records a refund (full or partial) |
| **Where** | Admin refund confirmation page, customer refund email landing page, or **server-side webhook** that injects a one-time script |
| **Note** | Most stores trigger this from backend/admin, not on every product page |

### Copy-paste script

```html
<script>
  (function () {
    if (typeof WorktualAnalytics === 'undefined') return;

    var orderId = 'ORD-98765';
    var refundAmount = 29.99;
    var currency = 'GBP';

    // Prevent duplicate refund events on refresh
    var key = 'wt_refund_' + orderId + '_' + refundAmount;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');

    WorktualAnalytics.refund({
      orderId: orderId,
      revenue: refundAmount,
      currency: currency
    });
  })();
</script>
```

### With backend data element

```html
<div id="wt-refund" hidden
  data-order-id="ORD-98765"
  data-revenue="29.99"
  data-currency="GBP">
</div>

<script>
  (function () {
    if (typeof WorktualAnalytics === 'undefined') return;

    var el = document.getElementById('wt-refund');
    if (!el) return;

    var orderId = el.dataset.orderId;
    var revenue = Number(el.dataset.revenue);
    if (!orderId || !revenue) return;

    var key = 'wt_refund_' + orderId + '_' + revenue;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');

    WorktualAnalytics.refund({
      orderId: orderId,
      revenue: revenue,
      currency: el.dataset.currency || 'GBP'
    });
  })();
</script>
```

### Partial refund

Send the **refunded amount** in `revenue`, not the full order total:

```javascript
WorktualAnalytics.refund({
  orderId: 'ORD-98765',
  revenue: 15.00,   // partial refund value
  currency: 'GBP'
});
```

### Dashboard effect

| Event | Product Analytics |
|-------|-------------------|
| `refund` | Refunds count, refund value KPIs |

---

## 3. Form tracking — login page & submit button

Forms are **on by default** (`trackForms: true` in SDK). No extra init flags needed unless Worktual asks you to change behavior.

### What fires automatically (standard HTML form)

When the user clicks **Submit** on a normal `<form>`:

| Event | When |
|-------|------|
| `form_view` | Form entered viewport |
| `form_start` | First field interaction |
| `form_submit` | Submit button clicked / form submitted |
| `form_success` | Page reload after submit (full postback) |

Password fields are **never stored** (masked by SDK).

---

### 3A. Login page — HTML form (recommended)

Mark the login container so Worktual identifies it in the **Forms** dashboard:

```html
<form id="login-form" data-wt-form="login" action="/login" method="post">
  <input name="email" type="email" autocomplete="username" required />
  <input name="password" type="password" autocomplete="current-password" required />
  <button type="submit">Log in</button>
</form>
```

**Attach:** `data-wt-form="login"` on the `<form>` (or wrapper `<div>` if you use div-based login UI).

**On submit click:** SDK sends `form_submit` with field values (password masked).

**After successful login (same page or redirect):** optionally link the visitor:

```html
<script>
  // Only if your backend outputs the logged-in user id on the next page
  WorktualAnalytics.login({
    userId: 'USER-12345',
    method: 'email'
  });
</script>
```

---

### 3B. Login page — AJAX / SPA (submit button, no page reload)

When login submits via JavaScript (React, Vue, fetch):

**1. Mark the form:**

```html
<div data-wt-form="login" id="login-root">
  <input name="email" id="email" type="email" />
  <input name="password" id="password" type="password" />
  <button type="button" id="login-submit">Log in</button>
</div>
```

**2. Attach on submit button click / handler:**

```javascript
document.getElementById('login-submit').addEventListener('click', async function () {
  var email = document.getElementById('email').value;
  var password = document.getElementById('password').value;

  // form_submit is still captured if the button is inside data-wt-form
  // Your login API call:
  var res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email, password: password })
  });

  if (res.ok) {
    var data = await res.json();

    // Required for AJAX — tells Forms dashboard the submit succeeded
    WorktualAnalytics.formSuccess('login');

    // Link visitor to user + conversion event
    WorktualAnalytics.login({
      userId: String(data.userId),
      method: 'email'
    });

    WorktualAnalytics.flush(); // optional: send immediately
    window.location.href = '/dashboard';
  } else {
    WorktualAnalytics.formFailure('login', { reason: 'invalid_credentials' });
  }
});
```

**React example:**

```jsx
const handleLoginSubmit = async (e) => {
  e.preventDefault();
  const res = await fetch('/api/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  if (res.ok) {
    const { userId } = await res.json();
    window.WorktualAnalytics?.formSuccess('login');
    window.WorktualAnalytics?.login({ userId: String(userId), method: 'email' });
  } else {
    window.WorktualAnalytics?.formFailure('login', { reason: 'invalid_credentials' });
  }
};
```

---

### 3C. Login form — init selector (no HTML change)

If you cannot edit login HTML, register in `init()`:

```javascript
WorktualAnalytics.init({
  websiteId: YOUR_WEBSITE_ID,
  websiteUrl: 'https://your-registered-store.com',
  organizationId: YOUR_ORGANIZATION_ID,
  leadForms: [
    {
      formId: 'login',
      root: '#login-form',              // or '.login-form-wrapper'
      submit: 'button[type="submit"]' // or '#login-submit'
    }
  ]
});
```

---

### 3D. Other forms (contact, newsletter, checkout guest)

Same pattern as login:

| Form type | `data-wt-form` | After AJAX success |
|-----------|----------------|---------------------|
| Contact | `contact` | `formSuccess('contact')` |
| Newsletter | `newsletter` | `formSuccess('newsletter')` |
| Register | `signup` | `formSuccess('signup')` + `signup({ userId })` |
| Login | `login` | `formSuccess('login')` + `login({ userId, method })` |

Example contact form:

```html
<form data-wt-form="contact" onsubmit="return submitContact(event)">
  <input name="name" required />
  <input name="email" type="email" required />
  <textarea name="message"></textarea>
  <button type="submit">Send</button>
</form>

<script>
  async function submitContact(e) {
    e.preventDefault();
    var form = e.target;
    var res = await fetch('/api/contact', { method: 'POST', body: new FormData(form) });
    if (res.ok) {
      WorktualAnalytics.formSuccess('contact');
      WorktualAnalytics.flush();
    } else {
      WorktualAnalytics.formFailure('contact', { reason: 'api_error' });
    }
  }
</script>
```

---

## 4. Quick checklist (send to client after deploy)

### E-commerce

- [ ] Universal snippet on all pages
- [ ] Thank-you: `purchase({ orderId, revenue, currency, products })`
- [ ] Thank-you: `removeFromCart()` for **each** item in `products`
- [ ] `sessionStorage` guard on thank-you (`wt_purchase_{orderId}`)
- [ ] Refund page/webhook: `refund({ orderId, revenue, currency })` with guard

### Forms / login

- [ ] Login form has `data-wt-form="login"` (or `leadForms` in init)
- [ ] Submit button inside marked form container
- [ ] AJAX login calls `formSuccess('login')` on API success
- [ ] AJAX login calls `login({ userId, method })` after success
- [ ] Test submit → confirm **Forms** tab in Worktual dashboard

---

## 5. Related docs

| Document | Contents |
|----------|----------|
| [CLIENT_ECOMMERCE_INTEGRATION.md](./CLIENT_ECOMMERCE_INTEGRATION.md) | Full e-commerce (cart, wishlist, checkout) |
| [CLIENT_INTEGRATION_GUIDE.md](./CLIENT_INTEGRATION_GUIDE.md) | Forms, custom events, frameworks |
| [examples/worktual-ecommerce.js](./examples/worktual-ecommerce.js) | Attribute-based ecommerce helper |
