# Worktual Analytics — E-commerce integration (client)

**Audience:** Storefront developers  
**Worktual provides:** `websiteId`, `websiteUrl` (exact registered store URL), `organizationId`, and the script URL below.

> **Single document for all e-commerce clients:** use **[CLIENT_FULL_ECOMMERCE_INTEGRATION_GUIDE.md](./CLIENT_FULL_ECOMMERCE_INTEGRATION_GUIDE.md)** — universal snippet, login/register, all product/cart/purchase events, checklists. This file remains as a detailed e-commerce events reference.

This guide has two parts:

1. **Universal snippet** — install once on every page (required).
2. **E-commerce events** — add on product, cart, checkout, and thank-you pages (required for **Product Analytics**).

---

## Part 1 — Universal snippet

### What to attach


| Item                           | What it is                                                 |
| ------------------------------ | ---------------------------------------------------------- |
| **First** `<script src="...">` | Loads the Worktual SDK from CDN                            |
| **Second** `<script>`          | Calls `WorktualAnalytics.init({ ... })` with your site IDs |


Do **not** add extra flags (`autoTrack`, `trackForms`, `trackReplay`, etc.) unless Worktual asks you to change behavior. Those are already enabled in the SDK.

### Where to attach

- **Every page** of the store: home, category, product, cart, checkout, thank-you.
- **Location:** just before `</body>` in the global layout (theme footer, `footer.php`, `theme.liquid`, site-wide template).
- **SPAs (React/Vue/Next):** root layout only — load the snippet **once**, not on every route.
- **Do not** load the SDK twice on the same page.



### Universal snippet (production)

Replace the three values with those Worktual sent you. Example shape (Booxoo):

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

**Example (filled in):**

```html
<!-- Worktual Analytics -->
<script src="https://nlp-storage.worktual.co.uk/wsnlp/Web_Tracking/JavaScript_sdk/sdk/v1/web_tracking_v3.js"></script>
<script>
  WorktualAnalytics.init({
    websiteId: 1009,
    websiteUrl: 'https://booxoo.co.uk',
    organizationId: 1010
  });
</script>
```


| Field            | Rule                                                                                                                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `websiteId`      | Numeric site ID from Worktual admin                                                                                                         |
| `websiteUrl`     | Must **exactly** match the URL registered for this site (scheme + host; use the same form Worktual registered, e.g. `https://booxoo.co.uk`) |
| `organizationId` | Numeric org ID from Worktual (included on every event payload)                                                                              |


After deploy: open the live site, browse a few pages, confirm visits in the Worktual **Dashboard**.

### QA / staging (only if Worktual gives you a QA site)

Use the **script URL and IDs** Worktual provides for QA. Init shape is the same — only `websiteId`, `websiteUrl`, and `organizationId`:

```html
<!-- Worktual Analytics (QA — use only when Worktual specifies QA) -->
<script src="https://qatracking.worktual.com/webtracking.min.js"></script>
<script>
  WorktualAnalytics.init({
    websiteId: YOUR_QA_WEBSITE_ID,
    websiteUrl: 'https://your-qa-store.com',
    organizationId: YOUR_QA_ORGANIZATION_ID
  });
</script>
```

---



## What the universal snippet does automatically

With no extra code:

- Page views and navigation  
- Behavior (clicks, scroll, etc.)  
- Session replay (if enabled for your account)  
- Common contact/lead forms

**Cart, wishlist, checkout, and purchase are not automatic.** Add Part 2 for Product Analytics.

---



## Part 2 — E-commerce events (when, where, what to attach)

**Rule:** Part 1 (universal snippet) must already be on the page. Every call below uses `WorktualAnalytics` from that script.

**Product object fields** (same for view / cart / wishlist unless noted):

| Field | Required | Notes |
|-------|----------|--------|
| `productId` | **Yes** | Or use `id` or `sku` instead of `productId` |
| `productName` | Recommended | Or `name` |
| `productPrice` | Recommended | Number; or `price` |
| `currency` | Recommended | e.g. `'GBP'` |
| `quantity` | Optional | Default `1` (especially for add to cart) |
| `productCategory` | Optional | Or `category` |
| `sku`, `brand` | Optional | — |

---

### 1. Product view (`productView`)

| | |
|---|---|
| **When** | The shopper opens a **product detail page (PDP)** and the product is visible. Fire **once per product id** per visit (not on every scroll or re-render). |
| **Where to attach** | Product template: `product.php`, Shopify `product.liquid`, PDP React/Vue component `useEffect`, etc. |
| **SDK call** | `WorktualAnalytics.productView({ ... })` |

**Attach — server-rendered product page (PHP/HTML template):**

```html
<!-- On the product page only, after universal snippet is loaded -->
<script>
  WorktualAnalytics.productView({
    productId: '<?= htmlspecialchars($product->sku) ?>',
    productName: '<?= htmlspecialchars($product->name) ?>',
    productPrice: <?= (float) $product->price ?>,
    currency: 'GBP',
    productCategory: '<?= htmlspecialchars($product->category) ?>',
    sku: '<?= htmlspecialchars($product->sku) ?>'
  });
</script>
```

**Attach — plain values (replace with your product data):**

```html
<script>
  WorktualAnalytics.productView({
    productId: 'SKU-100',
    productName: 'Blue Widget',
    productPrice: 29.99,
    currency: 'GBP',
    productCategory: 'Widgets',
    brand: 'Booxoo'
  });
</script>
```

**Attach — React (when product id is known):**

```javascript
useEffect(() => {
  if (!product?.id) return;
  WorktualAnalytics.productView({
    productId: String(product.id),
    productName: product.title,
    productPrice: product.price,
    currency: 'GBP',
    quantity: 1
  });
}, [product?.id]);
```

---

### 2. Add to cart (`addToCart`)

| | |
|---|---|
| **When** | Immediately when the user clicks **Add to cart** (or equivalent) and **before or after** your cart API succeeds — same moment you consider the item added. |
| **Where to attach** | PDP button, quick-add modal, listing “Add to cart” — inside the click handler or `onclick`. |
| **SDK call** | `WorktualAnalytics.addToCart({ ... })` — **`productId` required** |

**Attach — inline on button:**

```html
<button type="button" onclick="handleAddToCart()">Add to cart</button>
<script>
  function handleAddToCart() {
    WorktualAnalytics.addToCart({
      productId: 'SKU-100',
      productName: 'Blue Widget',
      productPrice: 29.99,
      currency: 'GBP',
      quantity: 1
    });
    // …your existing add-to-cart logic (fetch, form submit, etc.)
  }
</script>
```

**Attach — React:**

```javascript
function onAddToCart() {
  WorktualAnalytics.addToCart({
    productId: product.id,
    productName: product.title,
    productPrice: product.price,
    currency: 'GBP',
    quantity: selectedQty
  });
  // …existing cart logic
}
```

---

### 3. Remove from cart (`removeFromCart`)

| | |
|---|---|
| **When** | When the user removes a line item from the **cart page** or mini-cart (click remove / minus to zero). **Also** on thank-you page for each purchased line (after `purchase`) — see §7. |
| **Where to attach** | Cart template, mini-cart component — remove button handler; thank-you template for post-purchase cart clear. |
| **SDK call** | `WorktualAnalytics.removeFromCart({ ... })` — **`productId` required** |

**Attach:**

```html
<button type="button" onclick="removeLine('SKU-100')">Remove</button>
<script>
  function removeLine(sku) {
    WorktualAnalytics.removeFromCart({
      productId: sku,
      productName: 'Blue Widget',
      currency: 'GBP',
      quantity: 1
    });
    // …your remove-from-cart logic
  }
</script>
```

---

### 4. Add to wishlist (`addToWishlist`)

| | |
|---|---|
| **When** | User clicks **Add to wishlist** / heart icon. |
| **Where to attach** | PDP or listing wishlist button handler. |
| **SDK call** | `WorktualAnalytics.addToWishlist({ ... })` |

**Attach:**

```javascript
WorktualAnalytics.addToWishlist({
  productId: 'SKU-100',
  productName: 'Blue Widget',
  productPrice: 29.99,
  currency: 'GBP'
});
```

---

### 5. Remove from wishlist (`removeFromWishlist`)

| | |
|---|---|
| **When** | User removes an item from the wishlist page. |
| **Where to attach** | Wishlist remove button handler. |
| **SDK call** | `WorktualAnalytics.removeFromWishlist({ ... })` |

**Attach:**

```javascript
WorktualAnalytics.removeFromWishlist({
  productId: 'SKU-100',
  productName: 'Blue Widget',
  currency: 'GBP'
});
```

---

### 6. Checkout started (`beginCheckout`)

| | |
|---|---|
| **When** | When the **checkout page loads** (user entered checkout), once per checkout session. |
| **Where to attach** | Checkout template only (`checkout.liquid`, checkout route, step 1 of checkout). |
| **SDK call** | `WorktualAnalytics.beginCheckout({ ... })` — product id not required; pass cart context if you have it |

**Attach — checkout page footer:**

```html
<script>
  WorktualAnalytics.beginCheckout({
    currency: 'GBP',
    cartValue: 129.99,
    itemCount: 3
  });
</script>
```

(`cartValue` / `itemCount` are optional but useful; any extra keys are stored in analytics JSON.)

---

### 7. Purchase / order complete (`purchase`)

| | |
|---|---|
| **When** | On the **order confirmation / thank-you** page, **once per order** (not on refresh — see guard below). |
| **Where to attach** | Thank-you template with order data from your backend. |
| **SDK call** | `WorktualAnalytics.purchase({ orderId, revenue, currency, products })` |
| **Also recommended** | After `purchase`, call `removeFromCart` for **each purchased line** so visitor cart analytics match the empty store cart (see §7B). |

**Two steps on thank-you:**

1. **`purchase`** — revenue and conversions (required).
2. **Clear purchased cart lines** — one `removeFromCart` per item in `products` (recommended for visitor Product Activity).

Do **not** skip `purchase` and only send `removeFromCart`. Do **not** bulk-remove the whole cart on the checkout button — only remove lines that were **actually purchased**, on the thank-you page.

**Attach — thank-you page (server outputs order):**

```html
<script>
  (function () {
    var orderId = 'ORD-98765';
    var currency = 'GBP';
    var products = [
      {
        productId: 'SKU-100',
        productName: 'Blue Widget',
        productPrice: 29.99,
        quantity: 2
      }
    ];

    var key = 'wt_purchase_' + orderId;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');

    WorktualAnalytics.purchase({
      orderId: orderId,
      revenue: 129.99,
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

**Attach — hidden div + JSON from backend (Shopify/Woo pattern):**

```html
<div id="wt-order" hidden
  data-order-id="ORD-98765"
  data-revenue="129.99"
  data-currency="GBP"
  data-products='[{"productId":"SKU-100","productName":"Blue Widget","productPrice":29.99,"quantity":2}]'>
</div>
<script>
  (function () {
    var el = document.getElementById('wt-order');
    if (!el || typeof WorktualAnalytics === 'undefined') return;
    var orderId = el.dataset.orderId;
    if (!orderId) return;

    var key = 'wt_purchase_' + orderId;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');

    var currency = el.dataset.currency || 'GBP';
    var products = [];
    try { products = JSON.parse(el.dataset.products || '[]'); } catch (e) {}

    WorktualAnalytics.purchase({
      orderId: orderId,
      revenue: Number(el.dataset.revenue),
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

**Attach — React (thank-you route):**

```javascript
useEffect(() => {
  if (!order?.id || typeof WorktualAnalytics === 'undefined') return;

  const key = `wt_purchase_${order.id}`;
  if (sessionStorage.getItem(key)) return;
  sessionStorage.setItem(key, '1');

  const currency = order.currency || 'GBP';
  const products = order.lines.map((line) => ({
    productId: String(line.productId),
    productName: line.title,
    productPrice: line.price,
    quantity: line.quantity,
    currency,
  }));

  WorktualAnalytics.purchase({
    orderId: String(order.id),
    revenue: order.total,
    currency,
    products,
  });

  products.forEach((line) => {
    WorktualAnalytics.removeFromCart({
      productId: line.productId,
      productName: line.productName,
      currency,
      quantity: line.quantity || 1,
    });
  });
}, [order?.id]);
```

#### §7B — Why clear cart after purchase?

Worktual does **not** read the store’s live cart. Visitor **“Est. cart”** is calculated as `add_to_cart` minus `remove_from_cart` events. A `purchase` event records revenue but **does not** remove lines from that estimate.

After checkout, the shopper’s cart is empty on the store — to reflect that in the dashboard, send **`removeFromCart` for each line in `purchase.products`** immediately after `purchase` on the thank-you page (same `productId` and `quantity`).

| Event | Dashboard effect |
|-------|------------------|
| `purchase` | Purchases, revenue, visitor Conversions |
| `removeFromCart` (per purchased line) | Visitor Est. cart decreases; site Cart removes KPI increases |

Use the **same `sessionStorage` guard** so refresh does not duplicate purchase or cart clears.

---

### 8. Refund (`refund`) — optional

| | |
|---|---|
| **When** | When your system records a refund (often server-side or admin; only add client-side if you expose it). |
| **SDK call** | `WorktualAnalytics.refund({ orderId, revenue, currency, ... })` |

```javascript
WorktualAnalytics.refund({
  orderId: 'ORD-98765',
  revenue: 29.99,
  currency: 'GBP'
});
```

---

## Part 2B — Alternative: one script + HTML attributes (no framework)

If you prefer **not** to edit every handler, add this **once** after the universal snippet (same layout). Then mark buttons/cards with `data-*` attributes.

**1. Add the helper script** (after `WorktualAnalytics.init`):

```html
<script src="/path-or-inline/worktual-ecommerce-hooks.js"></script>
```

Or paste the full file from [`examples/worktual-ecommerce.js`](examples/worktual-ecommerce.js) in a `<script>` block.

**2. Mark up the storefront:**

**Product page** — container with product data:

```html
<div data-worktual-product-view
  data-product-id="SKU-100"
  data-product-name="Blue Widget"
  data-price="29.99"
  data-currency="GBP"
  data-category="Widgets">
  <!-- product content -->
</div>
```

**Add to cart button:**

```html
<button type="button"
  data-worktual-add-to-cart
  data-product-id="SKU-100"
  data-product-name="Blue Widget"
  data-price="29.99"
  data-currency="GBP"
  data-qty="1">
  Add to cart
</button>
```

**Remove from cart:**

```html
<button type="button"
  data-worktual-remove-from-cart
  data-product-id="SKU-100"
  data-product-name="Blue Widget"
  data-currency="GBP">
  Remove
</button>
```

**Wishlist:**

```html
<button type="button" data-worktual-add-to-wishlist data-product-id="SKU-100" data-product-name="Blue Widget" data-price="29.99" data-currency="GBP">Wishlist</button>
<button type="button" data-worktual-remove-from-wishlist data-product-id="SKU-100" data-product-name="Blue Widget" data-currency="GBP">Remove</button>
```

**Checkout page** — marker element:

```html
<div data-worktual-begin-checkout data-currency="GBP" style="display:none"></div>
```

**Thank-you page:**

```html
<div data-worktual-purchase
  data-order-id="ORD-98765"
  data-revenue="129.99"
  data-currency="GBP"
  data-products='[{"productId":"SKU-100","productName":"Blue Widget","productPrice":29.99,"quantity":2}]'
  style="display:none">
</div>
```

The helper script fires the matching `WorktualAnalytics.*` calls automatically.

---

## Quick reference

| Store page / action | Call | Attach where |
|---------------------|------|----------------|
| Product detail loads | `productView` | Product template or PDP component mount |
| Add to cart click | `addToCart` | Add-to-cart button handler |
| Remove line from cart | `removeFromCart` | Cart remove button handler |
| Add to wishlist | `addToWishlist` | Wishlist button handler |
| Remove from wishlist | `removeFromWishlist` | Wishlist remove handler |
| Checkout page loads | `beginCheckout` | Checkout template (once) |
| Thank-you page | `purchase` + `removeFromCart` per purchased line | Order confirmation template (once per order) |
| Refund (optional) | `refund` | Your refund flow |

---



## Go-live checklist

- [ ] Universal snippet on **all** pages with correct `websiteId`, `websiteUrl`, `organizationId`
- [ ] `productView` on product detail
- [ ] `addToCart` / `removeFromCart` where applicable
- [ ] Wishlist hooks if the store has wishlist
- [ ] `beginCheckout` on checkout
- [ ] `purchase` on thank-you with `orderId`, `revenue`, `currency`, `products[]`
- [ ] `removeFromCart` for **each purchased line** on thank-you (after `purchase`)
- [ ] Worktual verifies **Product Analytics** after a test order

---



## Worktual team references

- [ECOMMERCE_INTEGRATION_GUIDE.md](./ECOMMERCE_INTEGRATION_GUIDE.md) — pipeline and API  
- [CLIENT_INTEGRATION_GUIDE.md](./CLIENT_INTEGRATION_GUIDE.md) — forms and advanced options

