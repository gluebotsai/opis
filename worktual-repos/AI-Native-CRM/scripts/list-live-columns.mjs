import fs from "node:fs";
const data = JSON.parse(fs.readFileSync(new URL("./reports-schema-live.json", import.meta.url)));
for (const key of [
  "accounts.organizations",
  "accounts.setup_users",
  "accounts.setup_roles",
  "accounts.setup_user_product_access",
  "accounts.auth_sessions",
  "accounts.mail_oauth_connections",
  "accounts.a2a_spoke_clients",
  "cdp.customer_profile",
  "cdp.identity_keys",
  "inventory.products",
]) {
  const t = data[key];
  console.log("\n##", key);
  console.log((t.columns || []).map((c) => c.column_name).join(", "));
}
