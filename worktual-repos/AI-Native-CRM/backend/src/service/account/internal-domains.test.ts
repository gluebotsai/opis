/**
 * run: npx tsx src/service/account/internal-domains.test.ts
 */
import { isInternalEmail, type InternalDomainsState } from "./internal-domains";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const derived: InternalDomainsState = {
  organizationId: "1",
  domains: ["worktual.com", "acme.io"],
  mode: "derived",
  overrideEmails: ["founder@gmail.com"],
  updatedAt: null,
};

assert(isInternalEmail("rep@worktual.com", derived), "domain match");
assert(isInternalEmail("founder@gmail.com", derived), "override match");
assert(!isInternalEmail("customer@other.com", derived), "external domain");
assert(!isInternalEmail("", derived), "empty email");
assert(!isInternalEmail(null, derived), "null email");

console.log("internal-domains.test.ts ok");
