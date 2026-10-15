/**
 * run: npx tsx src/service/contacts/customer-event-brief.test.ts
 */
import assert from "node:assert/strict";
import {
  describeCustomerEvent,
  eventNamesForBusinessType,
} from "./customer-event-brief";

const b2b = eventNamesForBusinessType("b2b");
assert.equal(b2b.includes("page_view"), true);
assert.equal(b2b.includes("add_to_cart"), false);
assert.equal(b2b.includes("order_paid"), false);
assert.equal(b2b.includes("crm.appointment.scheduled"), false);

const b2c = eventNamesForBusinessType("b2c");
assert.equal(b2c.includes("add_to_cart"), true);
assert.equal(b2c.includes("page_view"), false);
assert.equal(b2c.includes("order_paid"), false);

const both = eventNamesForBusinessType("b2b2c");
assert.equal(both.includes("page_view") && both.includes("begin_checkout"), true);

const page = describeCustomerEvent({
  eventName: "page_view",
  channel: "web",
  pagePath: "/pricing",
  pageTitle: "Pricing",
  amount: null,
  currency: null,
  occurredAt: "2026-10-08T00:00:00.000Z",
  properties: { page_id: "99", visitor_id: "abc" },
});
assert.equal(page?.name, "Opened Pricing");
assert.equal(page?.page, null);

const click = describeCustomerEvent({
  eventName: "click",
  channel: "web",
  pagePath: null,
  pageTitle: "Home",
  amount: null,
  currency: null,
  occurredAt: null,
  properties: { elementText: "Book a demo", href: "https://example.com/demo" },
});
assert.equal(click?.name, "Clicked Book a demo on Home");

const cart = describeCustomerEvent({
  eventName: "add_to_cart",
  channel: "web",
  pagePath: null,
  pageTitle: null,
  amount: null,
  currency: "USD",
  occurredAt: null,
  properties: { productName: "Running shoes", productPrice: 49, productId: "sku-1" },
});
assert.equal(cart?.name, "Added Running shoes to the cart, USD 49");

const email = describeCustomerEvent({
  eventName: "email_open",
  channel: "email",
  pagePath: null,
  pageTitle: null,
  amount: null,
  currency: null,
  occurredAt: null,
  properties: {
    campaign_name: "Spring offer",
    email: "person@example.com",
    campaign_id: "9001",
  },
});
assert.equal(email?.name, "Opened Spring offer");
assert.equal(email?.campaignTitle, "Spring offer");
assert.equal(email?.name.includes("@"), false);

const dirty = describeCustomerEvent({
  eventName: "site_search",
  channel: null,
  pagePath: null,
  pageTitle: null,
  amount: null,
  currency: null,
  occurredAt: null,
  properties: { query: "https://example.com/secret" },
});
assert.equal(dirty?.name, "Searched the site");

console.log("customer-event-brief.test.ts ok");
