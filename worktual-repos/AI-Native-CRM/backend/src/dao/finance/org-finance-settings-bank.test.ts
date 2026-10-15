/**
 * run: npx tsx src/dao/finance/org-finance-settings-bank.test.ts
 */
import {
  formatBankDetailsBody,
  overlayBankDetailsOnSections,
  parseBankDetails,
  sanitizeBankDetails,
} from "./org-finance-settings";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(
  parseBankDetails(JSON.stringify({ accountName: "Worktual", ifsc: "UTIB1" }))
    ?.ifsc === "UTIB1",
  "parses JSON string",
);
assert(
  parseBankDetails({ account_name: "Worktual", IFSC: "UTIB1" })?.accountName ===
    "Worktual",
  "reads snake_case / IFSC",
);

const saved = sanitizeBankDetails({
  accountName: "  Worktual  ",
  bankName: "Axis",
  accountNumber: "926010000000009",
  ifsc: "UTIB0000234",
  iban: "  ",
  swift: "",
});
assert(saved?.accountName === "Worktual", "trims account name");
assert(saved?.iban === "", "keeps blank IBAN so it can clear");

const body = formatBankDetailsBody(saved);
assert(body.includes("Account name: Worktual"), "formats account");
assert(body.includes("IFSC / routing: UTIB0000234"), "formats IFSC");

const overlaid = overlayBankDetailsOnSections(
  [
    {
      key: "payment",
      title: "Payment",
      body: "Account name: [Your legal entity name]\nPlease remit by due date.",
    },
  ],
  saved,
);
assert(
  overlaid[0].body.includes("Account name: Worktual") &&
    !overlaid[0].body.includes("[Your legal entity name]"),
  "replaces placeholder bank lines",
);
assert(overlaid[0].body.includes("Please remit by due date."), "keeps other payment copy");

console.log("org-finance-settings-bank.test.ts ok");
