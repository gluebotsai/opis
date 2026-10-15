/**
 * run: npx tsx src/dao/companies/company-contact-sync-plan.test.ts
 */
import { readFileSync } from "node:fs";
import {
  collapseContactCompanies,
  planCompanyWrites,
  planMissingLocations,
  planProfileLinks,
} from "./company-contact-sync-plan";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const collapsed = collapseContactCompanies([
  {
    organization_id: "1003",
    name: "Acme",
    domain: null,
    industry: null,
    city: "Chennai",
  },
  {
    organization_id: "1003",
    name: "acme",
    domain: "https://www.Acme.com/about",
    industry: "Software",
    city: null,
  },
  {
    organization_id: "1003",
    name: "  ",
    domain: "skip.example",
    industry: null,
    city: null,
  },
]);
assert(collapsed.length === 1, "case variants collapse to one company");
assert(collapsed[0]?.name === "Acme", "first spelling is kept");
assert(collapsed[0]?.domain === "acme.com", "domain is normalized from a later row");
assert(collapsed[0]?.industry === "Software", "blank industry is filled");
assert(collapsed[0]?.city === "Chennai", "first city is kept");

const writes = planCompanyWrites(collapsed, [
  {
    id: "co-1",
    name: "ACME",
    domain: null,
    industry: "Existing",
    locationCount: 0,
  },
]);
assert(writes.create.length === 0, "existing lower(name) is not inserted again");
assert(writes.enrich.length === 1 && writes.enrich[0]?.domain === "acme.com", "blank domain is enriched");
assert(writes.enrich[0]?.industry == null, "existing industry is kept");

const created = planCompanyWrites(
  [
    {
      organizationId: "1003",
      name: "Northwind",
      domain: "northwind.io",
      industry: null,
      city: "Pune",
    },
  ],
  [],
);
assert(created.create.length === 1 && created.create[0]?.name === "Northwind", "missing company is inserted");
assert(created.enrich.length === 0, "a new company is not also an enrich");

const locations = planMissingLocations(
  [
    { id: "co-1", name: "Acme", domain: null, industry: "Existing", locationCount: 0 },
    { id: "co-2", name: "Acme", domain: "x", industry: null, locationCount: 2 },
    { id: "co-3", name: "Other", domain: null, industry: null, locationCount: 0 },
  ],
  collapsed,
);
assert(locations.length === 1 && locations[0]?.companyId === "co-1", "only a matching company with no location");
assert(locations[0]?.industry === "Existing", "location keeps the company industry");

const links = planProfileLinks({
  contacts: [
    { id: "c1", companyName: "Acme" },
    { id: "c1", companyName: "Other" },
    { id: "c2", companyName: "acme" },
    { id: "c3", companyName: "acme" },
    { id: "c4", companyName: "missing" },
  ],
  profiles: [
    { accountContactId: "c2", companyId: "already" },
    { accountContactId: "c3", companyId: null },
  ],
  companyIdByLowerName: new Map([["acme", "co-1"]]),
});
assert(links.insert.length === 1 && links.insert[0]?.accountContactId === "c1", "contact without a profile is inserted once");
assert(links.update.length === 1 && links.update[0]?.accountContactId === "c3", "null company id is updated");
assert(
  !links.insert.concat(links.update).some((row) => row.accountContactId === "c2"),
  "an existing company link is left alone",
);

const listSource = readFileSync(
  new URL("./company-service.ts", import.meta.url),
  "utf8",
);
assert(
  !listSource.includes("syncCompaniesFromContacts"),
  "opening the company list must not run the contact backfill",
);

console.log("company-contact-sync-plan.test.ts ok");
