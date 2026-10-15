# Booxoo — Worktual attach scripts (purchase, clear cart, refund, login forms)

**For:** Booxoo website developers (`https://booxoo.co.uk`)  
**From:** Worktual  
**Requires:** Universal snippet on every page first (see §0).

> **All e-commerce sites:** see **[CLIENT_FULL_ECOMMERCE_INTEGRATION_GUIDE.md](./CLIENT_FULL_ECOMMERCE_INTEGRATION_GUIDE.md)** for the generic guide. This file is Booxoo-specific copy-paste with real IDs.

This guide contains **copy-paste scripts** to attach on specific pages. Give this file to whoever maintains the Booxoo storefront theme/templates.

| What | Where to attach | SDK calls |
|------|-----------------|-----------|
| Order complete | Thank-you / order confirmation page | `purchase()` then `removeFromCart()` per line |
| Clear cart after purchase | Same thank-you page (same script) | `removeFromCart()` for each purchased product |
| Refund | Refund confirmation page or admin-triggered page | `refund()` |
| Login form | Login page | `data-wt-form="login"` + `formSuccess()` / `login()` on AJAX success |
| Register form | Register page | `data-wt-form="register"` + `formSuccess()` / `register()` on AJAX success |

---

## 0. Prerequisite — universal snippet (once, all pages)

Add **before `</body>`** in the global layout (theme footer). Load **once** only.

```html
<!-- Worktual Analytics — Booxoo -->
<script src="https://nlp-storage.worktual.co.uk/wsnlp/Web_Tracking/JavaScript_sdk/sdk/v1/web_tracking_v3.js"></script>
<script>
  WorktualAnalytics.init({
    websiteId: 1009,
    websiteUrl: 'https://booxoo.co.uk',
    organizationId: 1010,
  });
</script>
```

Do **not** add extra flags unless Worktual asks. Forms, page views, and behavior are already enabled by default.

---

## 1. Thank-you page — purchase + clear purchased cart lines

### When

- **Page:** Order confirmation / thank-you (after payment succeeds).
- **Once per order** — use the guard below so refresh does not duplicate events.

### Why two steps

| Step | Call | Dashboard effect |
|------|------|------------------|
| 1 | `purchase()` | Purchases count, purchase revenue, conversions |
| 2 | `removeFromCart()` for **each** line in `products` | Visitor “Est. cart” goes down; cart remove KPIs stay accurate |

Worktual does **not** read Booxoo’s live cart. After checkout the store cart is empty — send `removeFromCart` for every purchased line so analytics match.

### Script A — backend prints order values (PHP / template)

Replace `orderId`, `revenue`, and `products` with real order data from Booxoo:

```html
<script>
  (function () {
    if (typeof WorktualAnalytics === 'undefined') return;

    var orderId = '<?= htmlspecialchars($order->id) ?>';
    var currency = 'GBP';
    var revenue = <?= (float) $order->total ?>;
    var products = <?= json_encode(array_map(function ($line) {
      return [
        'productId' => (string) $line->sku,
        'productName' => $line->name,
        'productPrice' => (float) $line->price,
        'quantity' => (int) $line->qty,
      ];
    }, $order->lines)) ?>;

    var key = 'wt_purchase_' + orderId;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');

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

### Script B — hidden div + JSON (Shopify / Woo / any CMS)

**Step 1 — HTML** (thank-you template; values from backend):

```html
<div id="wt-order" hidden
  data-order-id="ORD-12345"
  data-revenue="129.99"
  data-currency="GBP"
  data-products='[{"productId":"SKU-100","productName":"Product name","productPrice":29.99,"quantity":2}]'>
</div>
```

**Step 2 — Script** (same page, after universal snippet):

```html
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

### Rules

| Do | Don't |
|----|--------|
| Attach on **thank-you page only** | Call on checkout button click |
| Send **`purchase` and** `removeFromCart` per line | Send only `removeFromCart` instead of `purchase` |
| Use same `productId` / SKU as add-to-cart events | Use different IDs on thank-you |
| Guard with `sessionStorage` per `orderId` | Fire again on page refresh |

---

## 2. Refund — revenue script

### When

- Booxoo records a **full or partial refund** (admin panel, refund email landing page, or one-time confirmation page).
- Usually **not** on product or cart pages.

### Script — inline values

```html
<script>
  (function () {
    if (typeof WorktualAnalytics === 'undefined') return;

    var orderId = 'ORD-12345';
    var refundAmount = 29.99;
    var currency = 'GBP';

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

### Script — backend data element

```html
<div id="wt-refund" hidden
  data-order-id="ORD-12345"
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

**Partial refund:** set `revenue` to the **refunded amount only**, not the original order total.

**Dashboard:** Product Analytics → Refunds count and refund value KPIs.

---

## 3. Form tracking — login & register (AJAX / SPA)

Forms are **on by default** (`trackForms: true`). `formSuccess` and `formFailure` are **on by default** in the SDK — no extra init flags needed.

For AJAX login/register, call the SDK directly after your API succeeds (see [CLIENT_FULL_ECOMMERCE_INTEGRATION_GUIDE.md](./CLIENT_FULL_ECOMMERCE_INTEGRATION_GUIDE.md) Part 2).

### What happens when the user clicks Submit

| Event | When |
|-------|------|
| `form_view` | Login form visible on screen |
| `form_start` | User focuses first field |
| `form_submit` | Submit button clicked |
| `form_success` | Successful submit (auto on full page postback, or manual for AJAX — see below) |

Password fields are **never stored** (masked by SDK).

---

### 3A. Standard HTML login form (full page submit)

Add `data-wt-form="login"` on the form:

```html
<form id="login-form" data-wt-form="login" action="/login" method="post">
  <input name="email" type="email" autocomplete="username" required />
  <input name="password" type="password" autocomplete="current-password" required />
  <button type="submit">Log in</button>
</form>
```

**On submit click:** SDK sends `form_submit` automatically.

**After successful login** (on the page Booxoo redirects to, if you have the user id):

```html
<script>
  WorktualAnalytics.login({
    userId: 'USER-12345',
    method: 'email'
  });
</script>
```

---

### 3B. AJAX / SPA login (submit button, no page reload)

**1. Mark the login container:**

```html
<div data-wt-form="login" id="login-root">
  <input name="email" id="login-email" type="email" />
  <input name="password" id="login-password" type="password" />
  <button type="button" id="login-submit">Log in</button>
</div>
```

**2. Attach on submit button click:**

```javascript
document.getElementById('login-submit').addEventListener('click', async function () {
  var email = document.getElementById('login-email').value;
  var password = document.getElementById('login-password').value;

  var res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: email, password: password })
  });

  if (res.ok) {
    var data = await res.json();

    await WorktualAnalytics.formSuccess('login');
    await WorktualAnalytics.login({
      userId: String(data.customer.id),
      method: 'email',
      email: data.customer.email,
      phone: data.customer.phone,
      firstName: data.customer.firstName,
      lastName: data.customer.lastName,
    });
    await WorktualAnalytics.flush();

    window.location.href = '/account';
  } else {
    WorktualAnalytics.formFailure('login', { reason: 'invalid_credentials' });
  }
});
```

| Call | When |
|------|------|
| `formSuccess('login')` | API returns success — required for AJAX |
| `login({ userId, method, email, phone, … })` | Links visitor to Booxoo customer id + identity traits |
| `formFailure('login', …)` | Wrong password / API error |

**Important:** Always **`await`** `formSuccess` / `login` / `flush()` **before** SPA navigation (`navigate()` or `window.location`).

**Identity fields stored** (password is never sent):

| Field | Sent in `login()` props | Stored in ClickHouse |
|-------|-------------------------|----------------------|
| `userId` | Yes | `dim_known_users.user_id`, `dim_visitors.user_id` |
| `email` | Yes | `dim_known_users.email` |
| `phone` | Yes | `dim_known_users.phone` |
| `firstName` / `lastName` | Yes | `dim_known_users.first_name`, `last_name` |
| `method` | Yes (`email` / `google`) | `dim_known_users.method` |

| Event | ClickHouse table |
|-------|------------------|
| `form_success` | `fact_form_events` |
| `login` | `fact_conversion_events` + `dim_known_users` |
| `identify` (auto from `login()`) | `fact_custom_events` + `dim_known_users` |

---

### 3C. Register page

Mark the register container:

```html
<div data-wt-form="register" id="register-root">
  ...
  <button type="button" id="register-submit">Create account</button>
</div>
```

After successful register API:

```typescript
import { trackWorktualRegister, trackWorktualFormFailure } from "../../analytics/worktualEcommerce";

async function onRegisterSubmit(values) {
  try {
    const response = await registerMutation.mutateAsync(values);
    await trackWorktualRegister({
      userId: String(response.customer.id),
      method: "email",
      formId: "register",
      email: response.customer.email,
      phone: response.customer.phone,
      firstName: response.customer.firstName,
      lastName: response.customer.lastName,
      source: "register_page",
    });
    navigate("/account", { replace: true });
  } catch {
    await trackWorktualFormFailure("register", "register_failed");
  }
}
```

| Event | ClickHouse table |
|-------|------------------|
| `form_success` | `fact_form_events` |
| `register` | `fact_conversion_events` + `dim_known_users` |

---

### 3D. Cannot edit login HTML — register in init

Add to the universal `init()` block:

```javascript
WorktualAnalytics.init({
  websiteId: 1009,
  websiteUrl: 'https://booxoo.co.uk',
  organizationId: 1010,
  leadForms: [
    {
      formId: 'login',
      root: '#login-form',
      submit: 'button[type="submit"]'
    }
  ]
});
```

Change `root` and `submit` selectors to match Booxoo’s login page DOM.

---

## 4. Identity table (Worktual server — one-time)

Apply DDL on ClickHouse (QA/prod):

```bash
cd ~/Web_tracking_workspace/web_tracking_QA   # or your repo root
conda activate web_tracking
./scripts/apply_dim_known_users.py
```

Dry run (print SQL only): `./scripts/apply_dim_known_users.py --dry-run`

Uses `.env` (`CLICKHOUSE_HOST`, `CLICKHOUSE_PORT`, `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`).

**Table:** `web_tracking.dim_known_users` — one row per `(website_id, user_id, visitor_id)` with latest email, phone, name, method. Populated automatically from `login`, `register`, and `identify` events.

Query example:

```sql
SELECT user_id, visitor_id, email, phone, last_event_type, last_identified_at
FROM web_tracking.dim_known_users
WHERE website_id = 1009
ORDER BY last_identified_at DESC
LIMIT 50;
```

---

## 5. Deploy checklist (Booxoo)

### E-commerce

- [ ] Universal snippet (§0) on all pages
- [ ] Thank-you: `purchase({ orderId, revenue, currency, products })`
- [ ] Thank-you: `removeFromCart()` for **each** item in `products`
- [ ] `sessionStorage` guard: `wt_purchase_{orderId}`
- [ ] Refund flow: `refund({ orderId, revenue, currency })` with guard

### Login / register

- [ ] Login: `data-wt-form="login"` + `formSuccess` + `login()` + `flush()` before navigate
- [ ] Register: `data-wt-form="register"` + `formSuccess` + `register()` + `flush()` before navigate
- [ ] Pass `userId`, `email`, `phone`, `firstName`, `lastName` when API returns them
- [ ] Redeploy SDK (`web_tracking_v3.js`) after Worktual SDK fix (formSuccess bug)
- [ ] Apply `15_dim_known_users.sql` on ClickHouse
- [ ] Test: Network → ingest POST contains `login` / `register` / `form_success`

---

## 6. Booxoo site IDs (reference)

| Field | Value |
|-------|--------|
| `websiteId` | `1009` |
| `websiteUrl` | `https://booxoo.co.uk` |
| `organizationId` | `1010` |

---

## 7. Related docs

| Document | Contents |
|----------|----------|
| [CLIENT_ECOMMERCE_INTEGRATION.md](./CLIENT_ECOMMERCE_INTEGRATION.md) | Full e-commerce (product view, cart, wishlist, checkout) |
| [CLIENT_INTEGRATION_GUIDE.md](./CLIENT_INTEGRATION_GUIDE.md) | Forms, custom events, React/Vue |
| [examples/worktual-ecommerce.js](./examples/worktual-ecommerce.js) | Optional attribute-based helper (`data-worktual-purchase`) |
| [examples/worktual-auth-tracking.ts](./examples/worktual-auth-tracking.ts) | Login + register helpers with identity fields |
