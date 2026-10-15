/**
 * run: npx tsx --tsconfig tsconfig.json src/service/zoominfo/zoominfo-enrich.test.ts
 */
import { zoominfoLeadEnrichmentParameters } from "./zoominfo-enrich";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const allSignals = zoominfoLeadEnrichmentParameters({
  companyName: "Acme",
  companyDomain: null,
  email: "ada@acme.com",
  phone: "+1 555 0100",
});
assert(allSignals?.companyName === "Acme", "company name is sent");
assert(allSignals?.companyWebsite === "acme.com", "company email domain is sent");
assert(allSignals?.emailAddress === "ada@acme.com", "full email is sent");
assert(allSignals?.phone === "+1 555 0100", "phone is sent");

const freeMail = zoominfoLeadEnrichmentParameters({
  companyName: "Acme",
  companyDomain: null,
  email: "ada@gmail.com",
  phone: null,
});
assert(
  freeMail?.emailAddress === "ada@gmail.com",
  "free-mail address is still a person identifier",
);
assert(
  !("companyWebsite" in (freeMail ?? {})),
  "free-mail domain is not treated as a company website",
);

const storedDomain = zoominfoLeadEnrichmentParameters({
  companyName: null,
  companyDomain: "https://www.example.com/about",
  email: "",
  phone: null,
});
assert(
  storedDomain?.companyWebsite === "example.com",
  "stored company website is normalized",
);

const companyOnly = zoominfoLeadEnrichmentParameters({
  companyName: "Acme",
  companyDomain: null,
  email: "",
  phone: null,
});
assert(companyOnly?.companyName === "Acme", "company name alone triggers ZoomInfo");

const phoneOnly = zoominfoLeadEnrichmentParameters({
  companyName: null,
  companyDomain: null,
  email: "",
  phone: "+44 20 7946 0958",
});
assert(phoneOnly?.phone === "+44 20 7946 0958", "phone alone triggers ZoomInfo");

assert(
  zoominfoLeadEnrichmentParameters({
    companyName: null,
    companyDomain: null,
    email: "",
    phone: null,
  }) === null,
  "no identity signals skips ZoomInfo",
);

console.log("zoominfo-enrich.test.ts: ok");
