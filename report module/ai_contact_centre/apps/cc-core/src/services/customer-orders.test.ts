import assert from "node:assert/strict";
import test from "node:test";

import { mapCustomerOrder } from "./customer-orders.js";

test("mapCustomerOrder keeps detail fields and hides a fulfillment that repeats status", () => {
  const order = mapCustomerOrder(
    {
      order_id: 9,
      order_number: "BXUK-1",
      status: "fulfilled",
      payment_status: "paid",
      fulfillment_status: "fulfilled",
      total_amount: "31.58",
      currency: "GBP",
      created_at: "2026-09-25T10:00:00.000Z",
      custom_fields: {
        tracking_numbers: ["BXUK-M4YFT8"],
        courier: "DPD",
        shipping_address: { address1: "1 High Street", city: "London", country: "UK" },
        order_url: "https://shop.example/orders/1",
      },
      profile_custom_fields: null,
      city: null,
      region: null,
      country: null,
    },
    [
      {
        order_id: 9,
        quantity: 1,
        unit_price: "27.59",
        custom_fields: { title: "Aveeno lotion", sku: "AVE-1" },
        product_name: "Daily Moisturising Lotion",
        product_image: "https://cdn.shop/a.jpg",
      },
    ],
  );

  assert.equal(order.orderNumber, "BXUK-1");
  assert.equal(order.fulfillmentStatus, null);
  assert.equal(order.tracking, "BXUK-M4YFT8");
  assert.equal(order.address, "1 High Street, London, UK");
  assert.equal(order.orderUrl, "https://shop.example/orders/1");
  assert.deepEqual(order.lines, [
    {
      name: "Daily Moisturising Lotion",
      sku: "AVE-1",
      quantity: 1,
      unitPrice: "27.59",
      imageUrl: "https://cdn.shop/a.jpg",
    },
  ]);
});

test("mapCustomerOrder falls back to the profile address and ignores a zero tracking value", () => {
  const order = mapCustomerOrder(
    {
      order_id: 2,
      order_number: "BXUK-2",
      status: "pending",
      payment_status: "paid",
      fulfillment_status: "unfulfilled",
      total_amount: 11.9,
      currency: "GBP",
      created_at: "2026-09-24T10:00:00.000Z",
      custom_fields: { tracking_number: "0" },
      profile_custom_fields: null,
      city: "Leeds",
      region: null,
      country: "UK",
    },
    [],
  );

  assert.equal(order.tracking, null);
  assert.equal(order.fulfillmentStatus, "unfulfilled");
  assert.equal(order.address, "Leeds, UK");
  assert.equal(order.totalAmount, "11.90");
  assert.deepEqual(order.lines, []);
});
