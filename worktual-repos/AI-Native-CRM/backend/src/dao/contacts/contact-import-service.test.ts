/**
 * Run: npx tsx src/dao/contacts/contact-import-service.test.ts
 */
import { csvToContactInputs } from "./contact-import-service";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const sample = `first_name,last_name,email,phone,title,company,company_domain,contact_type,lead_status,lead_source,status
Priya,Nair,priya.nair@acme.com,+91 98765 43210,VP Sales,Acme Corp,acme.com,lead,new,csv_import,active
James,Chen,james.chen@globex.io,+1 415 555 0199,Director,Globex,globex.io,lead,contacted,csv_import,active
`;

const parsed = csvToContactInputs(sample, { includeCompany: true });
assert(parsed.errors.length === 0, "sample should parse cleanly");
assert(parsed.rows.length === 2, "two data rows");
assert(parsed.rows[0]!.input.email === "priya.nair@acme.com", "email lowercased");
assert(parsed.rows[0]!.input.companyName === "Acme Corp", "company mapped");
assert(parsed.rows[1]!.input.leadStatus === "contacted", "lead status");

const exportStyle = `Name,Email,Phone,Title,Company,Stage,Lead status,Status
Alex Kim,alex@kim.co,+1 415 555 0100,PM,Kim Co,Lead,New,Active
`;
const exported = csvToContactInputs(exportStyle, { includeCompany: true });
assert(exported.errors.length === 0, "export headers should alias");
assert(exported.rows.length === 1, "one export row");
assert(exported.rows[0]!.input.firstName === "Alex", "split first");
assert(exported.rows[0]!.input.lastName === "Kim", "split last");
assert(exported.rows[0]!.input.contactType === "lead", "stage alias");

const bad = csvToContactInputs("foo,bar\n1,2\n", { includeCompany: true });
assert(bad.rows.length === 0, "missing email/name rejected");
assert(bad.errors.length >= 1, "header error");

const nameOnly = csvToContactInputs(
  `first_name,last_name,email,phone,contact_type
NoChannel,Person,,,contact
`,
  { includeCompany: false },
);
assert(nameOnly.errors.length === 0, "name-only import allowed");
assert(nameOnly.rows.length === 1, "one name-only row");
assert(nameOnly.rows[0]!.input.contactType === "contact", "name-only stays contact");

const emailPromotes = csvToContactInputs(
  `first_name,last_name,email
Ada,Lovelace,ada@example.com
`,
  { includeCompany: false },
);
assert(emailPromotes.rows[0]!.input.contactType === "lead", "email auto-promotes");

console.log("contact-import-service.test.ts ok");
