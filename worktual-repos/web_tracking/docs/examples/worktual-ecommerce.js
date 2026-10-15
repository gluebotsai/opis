/**
 * Example: hook Worktual ecommerce events on a typical SPA/storefront.
 * Adjust selectors and data attributes to match your theme.
 */
(function () {
  const WA = window.WorktualAnalytics;
  if (!WA) return;

  function productFromEl(el) {
    if (!el) return null;
    return {
      productId: el.dataset.productId || el.getAttribute('data-sku'),
      productName: el.dataset.productName,
      productCategory: el.dataset.category,
      productPrice: el.dataset.price ? Number(el.dataset.price) : undefined,
      currency: el.dataset.currency || 'USD',
      quantity: el.dataset.qty ? Number(el.dataset.qty) : 1,
    };
  }

  /** After purchase on thank-you: remove each purchased line from visitor cart analytics. */
  function clearPurchasedFromCart(products, currency) {
    if (!Array.isArray(products)) return;
    products.forEach((line) => {
      const productId = line.productId || line.id || line.sku;
      if (!productId) return;
      WA.removeFromCart({
        productId,
        productName: line.productName || line.name,
        currency: line.currency || currency || 'USD',
        quantity: line.quantity || 1,
      });
    });
  }

  // PDP: fire once per product view (debounce in your router if needed)
  document.querySelectorAll('[data-worktual-product-view]').forEach((el) => {
    const p = productFromEl(el);
    if (p?.productId) WA.productView(p);
  });

  document.addEventListener('click', (e) => {
    const addCart = e.target.closest('[data-worktual-add-to-cart]');
    if (addCart) {
      const p = productFromEl(addCart);
      if (p?.productId) WA.addToCart(p);
      return;
    }

    const removeCart = e.target.closest('[data-worktual-remove-from-cart]');
    if (removeCart) {
      const p = productFromEl(removeCart);
      if (p?.productId) WA.removeFromCart(p);
      return;
    }

    const addWish = e.target.closest('[data-worktual-add-to-wishlist]');
    if (addWish) {
      const p = productFromEl(addWish);
      if (p?.productId) WA.addToWishlist(p);
      return;
    }

    const removeWish = e.target.closest('[data-worktual-remove-from-wishlist]');
    if (removeWish) {
      const p = productFromEl(removeWish);
      if (p?.productId) WA.removeFromWishlist(p);
    }
  });

  // Checkout page mount
  const checkoutEl = document.querySelector('[data-worktual-begin-checkout]');
  if (checkoutEl) {
    WA.beginCheckout({
      currency: checkoutEl.dataset.currency || 'USD',
    });
  }

  // Order thank-you page — pass real order payload from your backend template
  const orderEl = document.querySelector('[data-worktual-purchase]');
  if (orderEl) {
    const orderId = orderEl.dataset.orderId;
    const key = orderId ? `wt_purchase_${orderId}` : '';
    if (key && sessionStorage.getItem(key)) return;
    if (key) sessionStorage.setItem(key, '1');

    let products = [];
    try {
      products = JSON.parse(orderEl.dataset.products || '[]');
    } catch (_) {
      /* ignore */
    }
    const currency = orderEl.dataset.currency || 'USD';
    WA.purchase({
      orderId,
      revenue: orderEl.dataset.revenue ? Number(orderEl.dataset.revenue) : undefined,
      currency,
      products,
    });
    clearPurchasedFromCart(products, currency);
  }
})();
