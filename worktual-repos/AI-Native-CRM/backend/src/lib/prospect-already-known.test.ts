/**
 * run: npx tsx --tsconfig tsconfig.json src/lib/prospect-already-known.test.ts
 */
import assert from "node:assert/strict";
import {
  crmNameIsSamePerson,
  prospectIdentityKeys,
  rememberProspectIdentity,
  sharesProspectIdentity,
} from "./prospect-already-known";

const jameson = {
  firstName: "Jameson",
  lastName: "Ta",
  companyName: "Lane Transit District",
  email: "ta.jameson@ltd.org",
  providerPayload: { zoominfoId: "7395978367" },
};

const keys = new Set<string>();
rememberProspectIdentity(jameson, keys);
assert.equal(
  sharesProspectIdentity(
    {
      firstName: "Jameson",
      lastName: "Ta",
      companyName: "Lane Transit District",
      providerPayload: { zoominfoId: "7395978367" },
    },
    keys,
  ),
  true,
  "the same ZoomInfo person is recognized without relying on the chat",
);

assert.equal(
  sharesProspectIdentity(
    {
      firstName: "Ava",
      lastName: "Singh",
      companyName: "Northline",
      providerPayload: { zoominfoId: "999" },
    },
    keys,
  ),
  false,
  "a different person is still offered",
);

assert.equal(
  crmNameIsSamePerson({
    firstName: "Jameson",
    lastName: "Ta",
    companyName: "Lane Transit District",
    matchName: "Jameson Ta",
    matchCompany: "Lane Transit District",
    matchEmail: "ta.jameson@ltd.org",
  }),
  true,
);

assert.equal(
  crmNameIsSamePerson({
    firstName: "Jameson",
    lastName: "Ta",
    companyName: "Other Agency",
    matchName: "Jameson Ta",
    matchCompany: "Lane Transit District",
  }),
  false,
  "the same name at a different company is not the imported contact",
);

assert.ok(
  prospectIdentityKeys(jameson).includes("zi:7395978367"),
  "zoominfo id is part of the identity",
);

console.log("prospect-already-known.test.ts ok");
