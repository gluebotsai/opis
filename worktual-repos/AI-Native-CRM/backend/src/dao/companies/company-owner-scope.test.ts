/**
 * run: npx tsx src/dao/companies/company-owner-scope.test.ts
 */
import { companyOwnerScopeWhere } from "./company-service";
import { UNOWNED_SCOPE_SENTINEL } from "@/service/auth/ownership-scope";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(
  Object.keys(companyOwnerScopeWhere(null)).length === 0,
  "admin/null scope = no filter",
);
assert(
  Object.keys(companyOwnerScopeWhere(undefined)).length === 0,
  "undefined = no filter",
);

const failClosed = companyOwnerScopeWhere(UNOWNED_SCOPE_SENTINEL);
assert(
  (failClosed as { ownerUserId?: string }).ownerUserId ===
    UNOWNED_SCOPE_SENTINEL,
  "sentinel stays exact-owner fail-closed",
);

const scoped = companyOwnerScopeWhere("rep-user-1") as {
  OR?: Array<Record<string, unknown>>;
};
assert(Array.isArray(scoped.OR) && scoped.OR.length === 4, "four OR branches");
assert(
  scoped.OR!.some((b) => b.ownerUserId === "rep-user-1"),
  "includes owned",
);
assert(
  scoped.OR!.some((b) => b.ownerUserId === null),
  "includes pool",
);
assert(
  scoped.OR!.some((b) => Boolean(b.contactProfiles)),
  "includes contact-linked",
);
assert(
  scoped.OR!.some((b) => Boolean(b.deals)),
  "includes deal-linked",
);

console.log("company-owner-scope.test.ts: ok");
