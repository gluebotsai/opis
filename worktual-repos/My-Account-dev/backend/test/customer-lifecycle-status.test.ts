import { describe, expect, it } from "vitest";

import { isPaidCustomer } from "../src/modules/customer-portal/portfolio.js";
import {
  isHeadOfficePortalUser,
  selectEntitledSubscriptions,
  selectSubscriptionRowsForGrants,
} from "../src/modules/customer-portal/customer-auth.js";
import { resolveLeadStatusPreservingCustomer } from "../src/modules/quotations/quotation-store.js";
import { LEAD_STATUSES, QUOTATION_STATUSES } from "../src/lib/statuses.js";

describe("resolveLeadStatusPreservingCustomer", () => {
  it("uses fallback for first-time leads with no Paid history", () => {
    expect(
      resolveLeadStatusPreservingCustomer(
        [QUOTATION_STATUSES.APPROVED],
        QUOTATION_STATUSES.APPROVED,
      ),
    ).toBe(QUOTATION_STATUSES.APPROVED);
    expect(
      resolveLeadStatusPreservingCustomer(
        [QUOTATION_STATUSES.PENDING],
        QUOTATION_STATUSES.PENDING,
      ),
    ).toBe(QUOTATION_STATUSES.PENDING);
    expect(
      resolveLeadStatusPreservingCustomer([], QUOTATION_STATUSES.REJECTED),
    ).toBe(QUOTATION_STATUSES.REJECTED);
  });

  it("keeps Partially paid when a Paid customer has an open Approved quote", () => {
    expect(
      resolveLeadStatusPreservingCustomer(
        [QUOTATION_STATUSES.PAID, QUOTATION_STATUSES.APPROVED],
        QUOTATION_STATUSES.APPROVED,
      ),
    ).toBe(LEAD_STATUSES.PARTIALLY_PAID);
  });

  it("stays Paid when a Paid customer has only a Pending Finance Review quote", () => {
    expect(
      resolveLeadStatusPreservingCustomer(
        [QUOTATION_STATUSES.PAID, QUOTATION_STATUSES.PENDING],
        QUOTATION_STATUSES.PENDING,
      ),
    ).toBe(QUOTATION_STATUSES.PAID);
  });

  it("returns Paid when every non-rejected quotation is Paid", () => {
    expect(
      resolveLeadStatusPreservingCustomer(
        [QUOTATION_STATUSES.PAID, QUOTATION_STATUSES.PAID],
        QUOTATION_STATUSES.REJECTED,
      ),
    ).toBe(QUOTATION_STATUSES.PAID);
  });
});

describe("isPaidCustomer", () => {
  it("includes active orgs even when lead status is Approved (awaiting payment on new quote)", () => {
    expect(
      isPaidCustomer({
        leadId: "lead-1",
        status: QUOTATION_STATUSES.APPROVED,
        lifecycleStatus: "active",
      }),
    ).toBe(true);
  });

  it("excludes prospect orgs that are only Approved", () => {
    expect(
      isPaidCustomer({
        leadId: "lead-2",
        status: QUOTATION_STATUSES.APPROVED,
        lifecycleStatus: "prospect",
      }),
    ).toBe(false);
  });

  it("includes Paid and Partially paid regardless of org lifecycle", () => {
    expect(
      isPaidCustomer({
        leadId: "lead-3",
        status: LEAD_STATUSES.PAID,
        lifecycleStatus: "prospect",
      }),
    ).toBe(true);
    expect(
      isPaidCustomer({
        leadId: "lead-4",
        status: LEAD_STATUSES.PARTIALLY_PAID,
        lifecycleStatus: "active",
      }),
    ).toBe(true);
  });
});

/**
 * Documented Sales overview KPI rule: pending finance = open quotations with
 * status Pending Finance Review (not lead status). Existing customers stay
 * Paid while a quote awaits finance — Customers by status must not show
 * Partially paid for pending-finance-only.
 */
describe("pending finance review KPI definition", () => {
  it("treats Paid lead + Pending quotation as finance-pending (not lead status alone)", () => {
    const leadStatus = QUOTATION_STATUSES.PAID;
    const quotationStatuses = [QUOTATION_STATUSES.PAID, QUOTATION_STATUSES.PENDING];
    const pendingQuoteCount = quotationStatuses.filter(
      (status) => status === QUOTATION_STATUSES.PENDING,
    ).length;

    expect(leadStatus).not.toBe(QUOTATION_STATUSES.PENDING);
    expect(pendingQuoteCount).toBe(1);
    expect(
      resolveLeadStatusPreservingCustomer(quotationStatuses, QUOTATION_STATUSES.PENDING),
    ).toBe(QUOTATION_STATUSES.PAID);
  });
});

describe("portal entitlements branch grants", () => {
  const org = {
    locations: [
      { id: "hq", label: "Head office", isPrimary: true },
      { id: "branch-b", label: "BANGALORE", isPrimary: false },
    ],
  };

  it("treats primary-location users as head office", () => {
    expect(isHeadOfficePortalUser({ branchId: "hq" }, org)).toBe(true);
    expect(isHeadOfficePortalUser({ branchId: "branch-b" }, org)).toBe(false);
  });

  it("grants head office every active subscription row (not HQ-only)", () => {
    const rows = [
      { id: "s-hq", branch_id: "hq" },
      { id: "s-blr", branch_id: "branch-b" },
    ];
    expect(selectSubscriptionRowsForGrants(rows, { branchId: "hq" }, org)).toEqual(rows);
    expect(selectSubscriptionRowsForGrants(rows, { branchId: "branch-b" }, org)).toEqual([
      { id: "s-blr", branch_id: "branch-b" },
    ]);
  });

  it("returns all org subscriptions for head office entitlements even with empty grants", () => {
    const subscriptions = [
      { id: "s-hq", branchId: "hq", status: "active" },
      { id: "s-blr", branchId: "branch-b", status: "active" },
    ];
    expect(
      selectEntitledSubscriptions(subscriptions, { branchId: "hq", grants: [] }, { isHeadOffice: true }),
    ).toEqual(subscriptions);
  });

  it("falls back to branch subscriptions when branch-user grants are empty", () => {
    const subscriptions = [
      { id: "s-hq", branchId: "hq", status: "active" },
      { id: "s-blr", branchId: "branch-b", status: "active" },
    ];
    expect(
      selectEntitledSubscriptions(
        subscriptions,
        { branchId: "branch-b", grants: [] },
        { isHeadOffice: false },
      ),
    ).toEqual([{ id: "s-blr", branchId: "branch-b", status: "active" }]);
  });

  it("keeps branch-user grant filter when grants exist (does not leak other branches)", () => {
    const subscriptions = [
      { id: "s-hq", branchId: "hq", status: "active" },
      { id: "s-blr", branchId: "branch-b", status: "active" },
    ];
    expect(
      selectEntitledSubscriptions(
        subscriptions,
        { branchId: "branch-b", grants: [{ subscriptionId: "s-blr" }] },
        { isHeadOffice: false },
      ),
    ).toEqual([{ id: "s-blr", branchId: "branch-b", status: "active" }]);
  });
});
