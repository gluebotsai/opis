/**
 * run: npx tsx --tsconfig tsconfig.json src/dao/home/revenue-board.test.ts
 */
import assert from "node:assert/strict";
import {
  kolkataQuarterBounds,
  revenueChangePct,
  rollupPaidInvoices,
  type PaidInvoiceFact,
} from "./revenue-board";

const now = new Date("2026-10-04T18:30:00.000Z");
const bounds = kolkataQuarterBounds(now);
assert.equal(bounds.quarterLabel, "Q4 2026");
assert.equal(bounds.previousQuarterLabel, "Q3 2026");
assert.equal(bounds.currentStart.toISOString(), "2026-09-30T18:30:00.000Z");
assert.equal(bounds.currentEnd.toISOString(), "2026-12-31T18:30:00.000Z");
assert.equal(bounds.previousStart.toISOString(), "2026-06-30T18:30:00.000Z");
assert.equal(revenueChangePct(4500000, 4000000), 12.5);
assert.equal(revenueChangePct(10, 0), null);

const facts: PaidInvoiceFact[] = [
  {
    total: 500000,
    paidAt: new Date("2026-10-02T06:30:00.000Z"),
    companyId: "c1",
    companyName: "Acme",
    ownerUserId: "u1",
    lines: [{ key: "crm", label: "CRM Platform", amount: 500000 }],
  },
  {
    total: 200000,
    paidAt: new Date("2026-10-03T06:30:00.000Z"),
    companyId: "c2",
    companyName: "Beta",
    ownerUserId: null,
    lines: [{ key: "voice", label: "Voice Assist", amount: 200000 }],
  },
  {
    total: 400000,
    paidAt: new Date("2026-08-01T06:30:00.000Z"),
    companyId: "c1",
    companyName: "Acme",
    ownerUserId: "u1",
    lines: [],
  },
];

const board = rollupPaidInvoices(facts, bounds, new Map([["u1", "Asha"]]), "INR");
assert.equal(board.companyCurrent, 700000);
assert.equal(board.companyPrevious, 400000);
assert.equal(board.employeeCurrent, 500000);
assert.equal(board.employeePrevious, 400000);
assert.equal(board.reps.length, 1);
assert.equal(board.reps[0]?.name, "Asha");
assert.equal(board.reps[0]?.changePct, 25);
assert.equal(board.byCustomer[0]?.label, "Acme");
assert.equal(board.byProduct.find((row) => row.label === "Voice Assist")?.amount, 200000);

const withOutsider: PaidInvoiceFact[] = [
  ...facts,
  {
    total: 90000,
    paidAt: new Date("2026-10-04T06:30:00.000Z"),
    companyId: "c3",
    companyName: "Gamma",
    ownerUserId: "marketing-user",
    lines: [{ key: "inbox", label: "Inbox", amount: 90000 }],
  },
];
const salesOnly = rollupPaidInvoices(
  withOutsider,
  bounds,
  new Map([["u1", "Asha"]]),
  "INR",
);
assert.equal(salesOnly.companyCurrent, 790000);
assert.equal(salesOnly.employeeCurrent, 500000);
assert.equal(salesOnly.reps.length, 1);
assert.equal(salesOnly.reps[0]?.userId, "u1");

console.log("revenue-board.test.ts ok");
