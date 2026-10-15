import { describe, expect, it } from "vitest";

import {
  filterOpenQuotationsHidingSupersededRejected,
  isRejectedQuotationSuperseded,
} from "../src/modules/billing/changes.js";
import { QUOTATION_STATUSES } from "../src/lib/statuses.js";

const REJECTED = {
  id: "q-rejected",
  status: QUOTATION_STATUSES.REJECTED,
  submittedAt: "2026-07-01T10:00:00.000Z",
  sourceProductRequestId: null,
  assignments: [{ productId: "cvm", branchId: "hq" }],
};

describe("isRejectedQuotationSuperseded", () => {
  it("keeps Rejected visible when no newer replacement exists", () => {
    expect(isRejectedQuotationSuperseded(REJECTED, [])).toBe(false);
    expect(
      isRejectedQuotationSuperseded(REJECTED, [
        {
          id: "q-older-paid",
          submittedAt: "2026-06-01T10:00:00.000Z",
          productKeys: new Set(["cvm::hq"]),
        },
      ]),
    ).toBe(false);
  });

  it("hides Rejected when a newer Paid quote covers the same product+branch", () => {
    expect(
      isRejectedQuotationSuperseded(REJECTED, [
        {
          id: "q-paid",
          submittedAt: "2026-07-15T10:00:00.000Z",
          productKeys: new Set(["cvm::hq"]),
        },
      ]),
    ).toBe(true);
  });

  it("hides Rejected when a newer Pending redo covers the same product+branch", () => {
    expect(
      isRejectedQuotationSuperseded(REJECTED, [
        {
          id: "q-redo-pending",
          submittedAt: "2026-07-10T10:00:00.000Z",
          productKeys: new Set(["cvm::hq"]),
        },
      ]),
    ).toBe(true);
  });

  it("hides Rejected when a newer quote shares sourceProductRequestId", () => {
    expect(
      isRejectedQuotationSuperseded(
        { ...REJECTED, sourceProductRequestId: "req-1", assignments: [] },
        [
          {
            id: "q-redo",
            submittedAt: "2026-07-12T10:00:00.000Z",
            sourceProductRequestId: "req-1",
            productKeys: new Set(),
          },
        ],
      ),
    ).toBe(true);
  });

  it("does not hide Rejected for a different product or branch", () => {
    expect(
      isRejectedQuotationSuperseded(REJECTED, [
        {
          id: "q-other-product",
          submittedAt: "2026-07-20T10:00:00.000Z",
          productKeys: new Set(["ccaas::hq"]),
        },
        {
          id: "q-other-branch",
          submittedAt: "2026-07-20T10:00:00.000Z",
          productKeys: new Set(["cvm::branch-2"]),
        },
      ]),
    ).toBe(false);
  });
});

describe("filterOpenQuotationsHidingSupersededRejected", () => {
  it("removes superseded Rejected but keeps Pending/Approved and unmatched Rejected", () => {
    const open = [
      REJECTED,
      {
        id: "q-unrelated-rejected",
        status: QUOTATION_STATUSES.REJECTED,
        submittedAt: "2026-07-02T10:00:00.000Z",
        assignments: [{ productId: "ccaas", branchId: "hq" }],
      },
      {
        id: "q-pending-other",
        status: QUOTATION_STATUSES.PENDING,
        submittedAt: "2026-07-05T10:00:00.000Z",
        assignments: [{ productId: "cdp", branchId: "hq" }],
      },
    ];

    const filtered = filterOpenQuotationsHidingSupersededRejected(open, [
      {
        id: "q-paid-cvm",
        status: QUOTATION_STATUSES.PAID,
        submitted_at: "2026-07-20T10:00:00.000Z",
        product_id: "cvm",
        branch_id: "hq",
      },
      {
        id: "q-pending-other",
        status: QUOTATION_STATUSES.PENDING,
        submitted_at: "2026-07-05T10:00:00.000Z",
        product_id: "cdp",
        branch_id: "hq",
      },
    ]);

    expect(filtered.map((q) => q.id)).toEqual(["q-unrelated-rejected", "q-pending-other"]);
  });
});
