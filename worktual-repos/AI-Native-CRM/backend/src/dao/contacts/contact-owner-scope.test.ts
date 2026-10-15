/**
 * Run: npx tsx src/dao/contacts/contact-owner-scope.test.ts
 */
import { contactOwnerScopeWhere } from "./contact-profile-repository";
import { UNOWNED_SCOPE_SENTINEL } from "@/service/auth/ownership-scope";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(
  Object.keys(contactOwnerScopeWhere({})).length === 0,
  "no owner = no filter",
);
assert(
  Object.keys(contactOwnerScopeWhere({ ownerUserId: null })).length === 0,
  "null owner = no filter (admin/manager)",
);
assert(
  Object.keys(contactOwnerScopeWhere({ ownerUserId: "  " })).length === 0,
  "blank owner = no filter",
);

const failClosed = contactOwnerScopeWhere({
  ownerUserId: UNOWNED_SCOPE_SENTINEL,
}) as { OR?: Array<Record<string, unknown>> };
assert(Array.isArray(failClosed.OR), "sentinel uses OR");
assert(
  failClosed.OR!.some((b) => b.ownerUserId === UNOWNED_SCOPE_SENTINEL),
  "sentinel includes owner branch",
);
assert(
  failClosed.OR!.some((b) => b.createdByUserId === UNOWNED_SCOPE_SENTINEL),
  "sentinel includes creator branch",
);

const scoped = contactOwnerScopeWhere({
  ownerUserId: "rep-user-1",
}) as { OR?: Array<Record<string, unknown>> };
assert(Array.isArray(scoped.OR) && scoped.OR.length === 2, "owner + creator");
assert(
  scoped.OR!.some((b) => b.ownerUserId === "rep-user-1"),
  "includes assigned owner",
);
assert(
  scoped.OR!.some((b) => b.createdByUserId === "rep-user-1"),
  "includes creator",
);

const channel = contactOwnerScopeWhere({
  ownerUserId: "rep-user-1",
  channelCompanyIds: ["co-1", "co-2"],
}) as { OR?: Array<Record<string, unknown>> };
assert(Array.isArray(channel.OR) && channel.OR.length === 3, "plus channel companies");
assert(
  channel.OR!.some(
    (b) =>
      Boolean(b.companyId) &&
      JSON.stringify(b.companyId) === JSON.stringify({ in: ["co-1", "co-2"] }),
  ),
  "includes franchise companies",
);

console.log("contact-owner-scope.test.ts: ok");
