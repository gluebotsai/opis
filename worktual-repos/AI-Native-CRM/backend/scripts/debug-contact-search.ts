import { accountQuery } from "@/dao/db/account-pool";
import { findContactIdsBySearch } from "@/dao/account/account-repository";
import { findContactIdsByCompanyNameSearch } from "@/dao/contacts/contact-profile-repository";
import { listContacts } from "@/dao/contacts/contact-service";

const org = process.argv[2] ?? "1000";
const term = process.argv[3] ?? "peter";

async function main() {
  const { rows } = await accountQuery<{
    cdp_id: string;
    first_name: string | null;
    last_name: string | null;
    company: string | null;
    key_type: string | null;
    key_value: string | null;
  }>(
    `SELECT p.cdp_id::text, p.first_name, p.last_name, p.company,
            k.key_type, k.key_value
     FROM cdp.customer_profile p
     LEFT JOIN cdp.identity_keys k ON k.cdp_id = p.cdp_id
     WHERE p.organization_id = $1::bigint
       AND (p.cdp_id::text = '8' OR lower(coalesce(p.first_name,'')) LIKE '%bharathi%')
     ORDER BY p.cdp_id, k.key_type`,
    [org],
  );
  process.stdout.write(`profile rows for bharathi/8: ${rows.length}\n`);
  for (const r of rows) {
    process.stdout.write(`${JSON.stringify(r)}\n`);
  }

  for (const q of [term, "pete", "Bharathi"]) {
    const person = await findContactIdsBySearch(q, { organizationId: org });
    const company = await findContactIdsByCompanyNameSearch(q, org);
    const ids = [...new Set([...person, ...company])];
    process.stdout.write(
      `term=${JSON.stringify(q)} ids=${ids.length} sample=${JSON.stringify(ids.slice(0, 2))}\n`,
    );
  }
  const page = await listContacts({
    search: term,
    page: 1,
    pageSize: 20,
    organizationId: org,
  });
  process.stdout.write(
    `listContacts search=${term} total=${page.pagination.total} names=${JSON.stringify(page.items.map((i) => i.displayName))}\n`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
