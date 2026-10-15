import pg from "../backend/node_modules/pg/lib/index.js";

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const orgs = await c.query(`
  SELECT o.id, o.company_name, o.business_type, o.industry_type, o.lifecycle_status
  FROM accounts.organizations o
  WHERE lower(coalesce(o.business_type, '')) IN ('b2b', 'b2b2c')
    AND EXISTS (SELECT 1 FROM crm.companies k WHERE k.organization_id = o.id)
  ORDER BY o.id
  LIMIT 10
`);
console.log(JSON.stringify(orgs.rows, null, 2));
await c.end();
