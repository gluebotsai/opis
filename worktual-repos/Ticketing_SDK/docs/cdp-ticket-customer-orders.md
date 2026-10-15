# Ticket panel: CDP customer and order details

The ticket Customer block and Order Details load from customer 360 (`ui-backend/server.ts` → `findDirectoryCustomer` and `listCustomerOrders` in `ui-backend/src/server/customersDirectory.ts`). The panel is `ui-frontend/src/components/TicketsView.tsx`.

`ticketing.contact_profile` only stores `cdp_id`. It is not the source of the name, email, phone, or orders on this panel.

## Customer block

Name, email, and phone prefer `ticketing.tickets`. CDP fills them only when the ticket email matches the CDP email. Created always comes from CDP when the emails match.

| On screen | CDP table | Column |
|---|---|---|
| Name | `cdp.customer_profile` | `first_name`, `last_name` |
| Email | `cdp.identity_keys` | `key_value` where `key_type = 'email'` |
| Phone | `cdp.identity_keys` | `key_value` where `key_type = 'phone'` |
| Created | `cdp.customer_profile` | `created_at` |

Join: `identity_keys.cdp_id = customer_profile.cdp_id` and the same `organization_id`.

Loaded from CDP and not shown on this block: `blocked`, `contact_type`, `city`, `region`, `country`, address keys inside `custom_fields`, and `identity_keys.key_type = 'customer_id'` (Shopify customer id). The address is used only as a fallback on the order card.

## Order Details

Up to 20 orders, newest first, for this org and this `cdp_id`. A row also matches when `custom_fields->>'proposed_cdp_id'` equals that `cdp_id`.

| On screen | CDP table | Column |
|---|---|---|
| Order number | `cdp.orders` | `order_number`, else `order_id` |
| Total orders | `cdp.orders` | `COUNT(*) OVER()` |
| Status | `cdp.orders` | `status` |
| Payment | `cdp.orders` | `payment_status` |
| Fulfillment | `cdp.orders` | `fulfillment_status` (hidden when it equals status) |
| Total | `cdp.orders` | `total_amount`, `currency` |
| Order date | `cdp.orders` | `created_at` |
| Address | `cdp.orders` | `custom_fields`: `shipping_address`, `shippingAddress`, `delivery_address`, `deliveryAddress`, `billing_address`, `billingAddress`, `default_address`, `defaultAddress`, `address`. If empty, customer address from `cdp.customer_profile.custom_fields` or `city`, `region`, `country` |
| Delivery date | `cdp.orders` | `custom_fields`: `expected_delivery`, `expectedDelivery`, `estimated_delivery_at`, `delivery_date`, `deliveryDate`, `delivered_at`, `deliveredAt` |
| Tracking | `cdp.orders` | `custom_fields`: `tracking_numbers`, `tracking_id`, `trackingId`, `awb`, `tracking_number` |
| Courier | `cdp.orders` | `custom_fields`: `courier`, `carrier`, `shipping_carrier` |
| Delivery | `cdp.orders` | `custom_fields`: `delivery_status`, `deliveryStatus` |
| Link | `cdp.orders` | `custom_fields`: `order_url`, `orderUrl`, `shopify_order_url`, `admin_url` |
| Line name | `cdp.order_items` then `cdp.products` | `order_items.custom_fields` `title` / `name` / `sku`, else `products.product_name` |
| Line SKU | `cdp.order_items` or `cdp.products` | `order_items.custom_fields->>'sku'`, else `products.sku` |
| Line quantity | `cdp.order_items` | `quantity` |
| Line price | `cdp.order_items` | `unit_price` |

`cdp.products` joins when `products.sku` equals the item SKU, or `products.product_id` equals `order_items.custom_fields->>'source_product_id'`, same organization. Latest `products.updated_at` wins.

A single order check during ticket create (`findCustomerOrder`) uses the same `cdp.orders` and `cdp.order_items` columns, plus `product_id` and `quantity` only. It does not read `cdp.products` or the shipping custom fields.
