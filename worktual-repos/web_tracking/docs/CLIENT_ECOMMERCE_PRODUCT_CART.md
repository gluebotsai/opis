# Worktual — Product view, add to cart, remove from cart

**For client developers.** Worktual provides: `websiteId`, `websiteUrl`, `organizationId`.

Install the **universal snippet** on every page first (see [CLIENT_ECOMMERCE_INTEGRATION.md](./CLIENT_ECOMMERCE_INTEGRATION.md) Part 1). Then add the three integrations below.

---

## Universal snippet (required on all pages)

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

---

## Product fields (all three calls)

| Field | Required | Notes |
|-------|----------|--------|
| `productId` | **Yes** | Or pass `id` or `sku` instead |
| `productName` | Recommended | Or `name` |
| `productPrice` | Recommended | Number; or `price` |
| `currency` | Recommended | e.g. `'GBP'` |
| `quantity` | For add/remove cart | Default `1` if omitted |

---

## Sending events: do clients need `flush()`?

The SDK **queues** events and sends them automatically:

- On a **timer** (about every 10 seconds), and  
- When the user **leaves the page** (tab hidden / navigate away — built in, no extra code).

So for a normal **product page** or **full page reload** after add to cart, you usually **do not** need `flush()`.

**Call `WorktualAnalytics.flush()` after cart actions when:**

| Situation | Why |
|-----------|-----|
| **AJAX / SPA add or remove cart** — user stays on the same page with no navigation | Events may sit in the queue until the next timer; flush sends them **immediately** |
| You want **Product Analytics** to update within seconds after testing | Optional during QA |
| Add to cart then **instant redirect** to an external URL that might not run `pagehide` reliably | Rare; flush right before redirect is safer |

**Attach pattern** — after `addToCart` or `removeFromCart`:

```javascript
WorktualAnalytics.addToCart({ productId: 'SKU-100', productName: 'Blue Widget', productPrice: 29.99, currency: 'GBP', quantity: 1 });
WorktualAnalytics.flush();  // optional: send queue now (same page, no reload)
```

**Async (wait until send finishes)** — useful before redirect:

```javascript
async function addToCartTrack() {
  WorktualAnalytics.addToCart({
    productId: 'SKU-100',
    productName: 'Blue Widget',
    productPrice: 29.99,
    currency: 'GBP',
    quantity: 1
  });
  await WorktualAnalytics.flush();
  // then run your cart API or window.location = '...'
}
```

**Product view:** `flush()` is **optional** (page usually stays open or user navigates — auto flush on leave is enough).

You do **not** need to configure `flush` in `init()` — only call **`WorktualAnalytics.flush()`** in your handlers when the table above applies.

---

## 1. Product view

**When:** Shopper opens the **product detail page (PDP)**. Call **once per product id** (not on every re-render).

**Where:** Product template only (`product.liquid`, `product.php`, PDP component).

**Call:** `WorktualAnalytics.productView({ ... })`

### Attach — product page script

```html
<script>
  WorktualAnalytics.productView({
    productId: 'SKU-100',
    productName: 'Blue Widget',
    productPrice: 29.99,
    currency: 'GBP',
    productCategory: 'Widgets',
    sku: 'SKU-100'
  });
</script>
```

### Attach — server template (example)

```html
<script>
  WorktualAnalytics.productView({
    productId: '<?= $product->sku ?>',
    productName: '<?= $product->name ?>',
    productPrice: <?= (float) $product->price ?>,
    currency: 'GBP'
  });
</script>
```

### Attach — React

```javascript
useEffect(() => {
  if (!product?.id) return;
  WorktualAnalytics.productView({
    productId: String(product.id),
    productName: product.title,
    productPrice: product.price,
    currency: 'GBP'
  });
}, [product?.id]);
```

---

## 2. Add to cart

**When:** User clicks **Add to cart** (same moment as your cart logic).

**Where:** Add-to-cart button — inside click handler or `onclick`.

**Call:** `WorktualAnalytics.addToCart({ ... })`

### Attach — button + handler

```html
<button type="button" onclick="addToCartTrack()">Add to cart</button>
<script>
  async function addToCartTrack() {
    WorktualAnalytics.addToCart({
      productId: 'SKU-100',
      productName: 'Blue Widget',
      productPrice: 29.99,
      currency: 'GBP',
      quantity: 1
    });
    await WorktualAnalytics.flush(); // recommended for AJAX cart (same page, no reload)
    // your existing add-to-cart code here
  }
</script>
```

### Attach — React

```javascript
async function onAddToCart() {
  WorktualAnalytics.addToCart({
    productId: product.id,
    productName: product.title,
    productPrice: product.price,
    currency: 'GBP',
    quantity: qty
  });
  await WorktualAnalytics.flush(); // recommended for SPA / fetch cart
  // your existing add-to-cart code here
}
```

### Attach — data attributes (optional)

Add [`examples/worktual-ecommerce.js`](examples/worktual-ecommerce.js) after init, then:

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

---

## 3. Remove from cart

**When:** User removes an item from **cart** or mini-cart.

**Where:** Remove button on cart line — inside click handler.

**Call:** `WorktualAnalytics.removeFromCart({ ... })`

### Attach — remove button

```html
<button type="button" onclick="removeFromCartTrack('SKU-100')">Remove</button>
<script>
  async function removeFromCartTrack(productId) {
    WorktualAnalytics.removeFromCart({
      productId: productId,
      productName: 'Blue Widget',
      currency: 'GBP',
      quantity: 1
    });
    await WorktualAnalytics.flush(); // recommended for AJAX cart (same page)
    // your existing remove-from-cart code here
  }
</script>
```

### Attach — React

```javascript
function onRemoveLine(line) {
  WorktualAnalytics.removeFromCart({
    productId: line.productId,
    productName: line.title,
    currency: 'GBP',
    quantity: line.quantity
  });
  // your existing remove logic
}
```

### Attach — data attributes (optional)

```html
<button type="button"
  data-worktual-remove-from-cart
  data-product-id="SKU-100"
  data-product-name="Blue Widget"
  data-currency="GBP">
  Remove
</button>
```

---

## Checklist

- [ ] Universal snippet on all pages
- [ ] `productView` on product detail page
- [ ] `addToCart` on every add-to-cart action
- [ ] `removeFromCart` on every cart line remove
- [ ] Worktual **Product Analytics** shows views and cart events after testing

---

## More events later

Checkout, purchase, wishlist: [CLIENT_ECOMMERCE_INTEGRATION.md](./CLIENT_ECOMMERCE_INTEGRATION.md) Part 2 (sections 4–7).
