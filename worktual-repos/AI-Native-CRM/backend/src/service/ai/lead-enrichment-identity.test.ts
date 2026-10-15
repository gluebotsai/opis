/**
 * Run: npx tsx backend/src/service/ai/lead-enrichment-identity.test.ts
 */
import {
  enrichmentIdentityFieldsChanged,
} from "./lead-enrichment-job";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(
  enrichmentIdentityFieldsChanged(
    { email: null, phone: null, companyName: null },
    { email: "a@b.com", phone: null, companyName: null },
  ),
  "email added",
);
assert(
  enrichmentIdentityFieldsChanged(
    { email: null, phone: null, companyName: "Acme" },
    { email: null, phone: "+91 999", companyName: "Acme" },
  ),
  "phone added",
);
assert(
  enrichmentIdentityFieldsChanged(
    { email: "a@b.com", phone: null, companyName: null },
    { email: "a@b.com", phone: null, companyName: "Acme Corp" },
  ),
  "company added",
);
assert(
  enrichmentIdentityFieldsChanged(
    { email: "a@b.com", phone: null, companyName: "Acme", companyId: "c1" },
    { email: "a@b.com", phone: null, companyName: "Acme", companyId: "c2" },
  ),
  "companyId changed",
);
assert(
  !enrichmentIdentityFieldsChanged(
    { email: "a@b.com", phone: "+1", companyName: "Acme" },
    { email: "a@b.com", phone: "+1", companyName: "Acme" },
  ),
  "unchanged identity",
);
assert(
  !enrichmentIdentityFieldsChanged(
    { email: "A@B.COM", phone: null, companyName: "Yash Technologies" },
    { email: "a@b.com", phone: null, companyName: "Yash Technologies" },
  ),
  "email case-only change counts as same",
);

console.log("lead-enrichment-identity.test.ts OK");
