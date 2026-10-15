# Worktual — E-commerce client integration (product, cart, wishlist, checkout)

**For storefront developers.**  
Worktual provides: **`websiteId`**, **`websiteUrl`** (exact registered URL), **`organizationId`**.

**Covers these SDK calls:**

| SDK method | When |
|------------|------|
| `productView` | Product detail page |
| `addToCart` | Add to bag / cart |
| `removeFromCart` | Remove line from cart |
| `addToWishlist` | Save to wishlist |
| `removeFromWishlist` | Remove from wishlist |
| `beginCheckout` | Checkout page entered |

**Order complete** uses `purchase()` plus `removeFromCart` per purchased line on the thank-you page — see [CLIENT_ECOMMERCE_INTEGRATION.md](./CLIENT_ECOMMERCE_INTEGRATION.md) §7. Do **not** use `removeFromCart` **instead of** `purchase` on checkout.

---

## Step 1 — Universal snippet (every page)

Add **once**, before `</body>` on **all** pages (home, PLP, PDP, cart, checkout, account).

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

| Field | Rule |
|-------|------|
| `websiteId` | From Worktual admin |
| `websiteUrl` | Must **exactly** match registered URL |
| `organizationId` | From Worktual admin |

No need to set `autoTrack`, `trackForms`, `trackReplay`, etc. — SDK defaults are already on.

**SPA (React/Vue/Next):** put the snippet in the **root layout only** (not every route).

---

## Step 2 — Product fields (view / cart / wishlist)

Use the **same property names** for `productView`, `addToCart`, `removeFromCart`, `addToWishlist`, `removeFromWishlist`:

| Property | Required | Notes |
|----------|----------|--------|
| `productId` | **Yes** | Or pass `id` or `sku` instead |
| `productName` | Recommended | Or `name` |
| `productPrice` | Recommended | Number; or `price` |
| `currency` | Recommended | e.g. `'GBP'` |
| `quantity` | Optional | Default `1` |
| `productCategory` | Optional | Or `category` |
| `sku`, `brand` | Optional | — |

---

## Step 3 — When to call `flush()`

After **AJAX / SPA** cart or wishlist (user stays on same page, no full reload):

```javascript
await WorktualAnalytics.flush();
```

Call **after** `addToCart`, `removeFromCart`, or wishlist methods. Optional on full page navigation.

---

## Step 4 — What to attach (each event)

### 4.1 `productView` — product detail page (PDP)

| | |
|---|---|
| **When** | PDP is shown; **once per product id** (not every re-render) |
| **Where** | Product template / PDP component |
| **Do not** | Fire on category/list pages unless that page is the PDP |

```html
<script>
  WorktualAnalytics.productView({
    productId: 'SKU-100',
    productName: 'Brown midi dress',
    productPrice: 30,
    currency: 'GBP',
    productCategory: 'Dresses',
    sku: 'SKU-100'
  });
</script>
```

```javascript
// React — when product id is known
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

### 4.2 `addToCart` — add to bag

| | |
|---|---|
| **When** | User clicks Add to cart / Add to bag |
| **Where** | Button click handler (PDP, PLP quick add, modal) |
| **Not** | On checkout or pay button |

```javascript
async function onAddToCart() {
  WorktualAnalytics.addToCart({
    productId: 'SKU-100',
    productName: 'Brown midi dress',
    productPrice: 30,
    currency: 'GBP',
    quantity: 1
  });
  await WorktualAnalytics.flush(); // if AJAX cart, same page
  // …your cart API / form logic
}
```

---

### 4.3 `removeFromCart` — remove from cart

| | |
|---|---|
| **When** | User removes **one line** from cart or mini-cart |
| **Where** | Remove / delete line button handler |
| **Not** | On checkout button alone (use `purchase` on thank-you; optional `removeFromCart` there for purchased lines only) |

One call = **one product**. For three lines removed, call **three times** (or only track explicit removes).

```javascript
async function onRemoveLine(productId, name) {
  WorktualAnalytics.removeFromCart({
    productId: productId,
    productName: name,
    currency: 'GBP',
    quantity: 1
  });
  await WorktualAnalytics.flush(); // if AJAX cart
  // …your remove logic
}
```

---

### 4.4 `addToWishlist` — add to wishlist

| | |
|---|---|
| **When** | User saves item to wishlist (heart / wishlist button) |
| **Where** | Wishlist button handler on PDP or listing |

```javascript
WorktualAnalytics.addToWishlist({
  productId: 'SKU-100',
  productName: 'Brown midi dress',
  productPrice: 30,
  currency: 'GBP',
  sku: 'SKU-100'
});
```

---

### 4.5 `removeFromWishlist` — remove from wishlist

| | |
|---|---|
| **When** | User removes item on wishlist page |
| **Where** | Remove button on wishlist |

```javascript
WorktualAnalytics.removeFromWishlist({
  productId: 'SKU-100',
  productName: 'Brown midi dress',
  currency: 'GBP'
});
```

---

### 4.6 `beginCheckout` — checkout started

| | |
|---|---|
| **When** | **Checkout page loads** (step 1), once per checkout visit |
| **Where** | Checkout template or checkout route mount |
| **Props** | Order-level (no `productId` required) |

```html
<!-- Checkout page only -->
<script>
  WorktualAnalytics.beginCheckout({
    currency: 'GBP',
    cartValue: 129.99,
    itemCount: 3
  });
</script>
```

```javascript
// React — checkout route
useEffect(() => {
  WorktualAnalytics.beginCheckout({
    currency: 'GBP',
    cartValue: cart.total,
    itemCount: cart.lines.length
  });
}, []);
```

Optional props: `coupon`, etc. (stored in analytics JSON).

---

## Quick reference

| Store moment | Attach on | SDK call |
|--------------|-----------|----------|
| PDP loads | Product page | `productView({ ... })` |
| Add to bag | Add button handler | `addToCart({ ... })` + `flush()` if AJAX |
| Remove line | Cart remove button | `removeFromCart({ ... })` + `flush()` if AJAX |
| Add to wishlist | Wishlist button | `addToWishlist({ ... })` |
| Remove from wishlist | Wishlist remove | `removeFromWishlist({ ... })` |
| Checkout page loads | Checkout template | `beginCheckout({ currency, cartValue, ... })` |
| Order paid | Thank-you page | `purchase({ ... })` then `removeFromCart` per line *(see main doc §7)* |

---

## Optional — HTML data attributes

Load helper after init: [`examples/worktual-ecommerce.js`](examples/worktual-ecommerce.js)

| Attribute | Event |
|-----------|--------|
| `data-worktual-product-view` + `data-product-id`, … | `productView` |
| `data-worktual-add-to-cart` | `addToCart` |
| `data-worktual-remove-from-cart` | `removeFromCart` |
| `data-worktual-add-to-wishlist` | `addToWishlist` |
| `data-worktual-remove-from-wishlist` | `removeFromWishlist` |
| `data-worktual-begin-checkout` + `data-currency` | `beginCheckout` |

---

## Go-live checklist

- [ ] Universal snippet on **all** pages (`websiteId`, `websiteUrl`, `organizationId`)
- [ ] `productView` on PDP
- [ ] `addToCart` on every add action (+ `flush` if AJAX cart)
- [ ] `removeFromCart` only on explicit remove (not checkout)
- [ ] Wishlist add/remove if store has wishlist
- [ ] `beginCheckout` on checkout entry
- [ ] `purchase` on order confirmation (required for revenue KPIs)
- [ ] `removeFromCart` for each purchased line on thank-you (recommended for visitor cart analytics)
- [ ] Test in browser Network tab: POST contains `add_to_cart`, etc.

---

## Worktual / CDP references

- Payload keys: [CDP_ECOMMERCE_CART_WISHLIST_PAYLOAD.md](./CDP_ECOMMERCE_CART_WISHLIST_PAYLOAD.md)
- Full e-commerce guide: [CLIENT_ECOMMERCE_INTEGRATION.md](./CLIENT_ECOMMERCE_INTEGRATION.md)
