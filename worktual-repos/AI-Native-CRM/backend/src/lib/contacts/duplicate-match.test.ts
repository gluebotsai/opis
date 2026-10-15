/**
 * run: npx tsx --tsconfig tsconfig.json src/lib/contacts/duplicate-match.test.ts
 */
import { scoreContactPair, type ContactMatchInput } from "./duplicate-match";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function contact(
  id: string,
  extra: Partial<ContactMatchInput> = {},
): ContactMatchInput {
  return {
    id,
    firstName: extra.firstName ?? "Rahul",
    lastName: extra.lastName ?? "Sharma",
    email: extra.email ?? "",
    phone: extra.phone ?? null,
    secondaryEmails: extra.secondaryEmails ?? [],
    secondaryPhones: extra.secondaryPhones ?? [],
    companyId: extra.companyId ?? null,
    companyName: extra.companyName ?? null,
    city: extra.city ?? null,
  };
}

const seed = contact("draft");

assert(
  scoreContactPair(
    { ...seed, email: "a@x.com" },
    contact("b", { email: "a@x.com" }),
  )?.confidence === 100,
  "same primary email still flags",
);

assert(
  scoreContactPair(
    { ...seed, phone: "+91 98765 43210" },
    contact("b", { phone: "91 98765 43210" }),
  )?.confidence === 85,
  "same primary phone still flags",
);

assert(
  scoreContactPair(
    { ...seed, companyName: "Acme" },
    contact("b", { companyName: "Acme" }),
  )?.confidence === 80,
  "same name + company still flags",
);

assert(
  scoreContactPair(
    { ...seed, city: "Chennai", email: "one@x.com" },
    contact("b", { city: "Chennai", email: "two@x.com" }),
  ) === null,
  "same name + city + different email does not interrupt",
);

assert(
  scoreContactPair(seed, contact("b")) === null,
  "same name only does not interrupt",
);

console.log("duplicate-match.test.ts ok");
