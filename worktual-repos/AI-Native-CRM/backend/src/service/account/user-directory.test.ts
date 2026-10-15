/**
 * run: npx tsx --tsconfig tsconfig.json src/service/account/user-directory.test.ts
 */
import { parseCrmRole } from "@/service/auth/rbac";
import {
  directoryUsersFromSetupRows,
  escalationRecipientViaLabel,
  mergeEscalationRecipients,
  type AssignableUser,
} from "./user-directory";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

function user(
  id: string,
  role: AssignableUser["role"],
): AssignableUser {
  return {
    id,
    email: `${id}@example.com`,
    name: id,
    role,
    label: `${id} (${role})`,
  };
}

const manager = user("mgr-1", "sales_manager");
const admin = user("adm-1", "admin");
const admin2 = user("adm-2", "admin");

{
  const out = mergeEscalationRecipients([manager], [admin, admin2]);
  assert(out.via === "sales_manager_admin", "both roles → union via");
  assert(
    JSON.stringify(out.recipients.map((r) => r.id).sort()) ===
      JSON.stringify(["adm-1", "adm-2", "mgr-1"]),
    "managers and admins are both included",
  );
}

{
  const out = mergeEscalationRecipients([manager], []);
  assert(out.via === "sales_manager", "managers only");
  assert(out.recipients.length === 1 && out.recipients[0]?.id === "mgr-1", "manager kept");
}

{
  const out = mergeEscalationRecipients([], [admin]);
  assert(out.via === "admin", "admins only");
  assert(out.recipients.length === 1 && out.recipients[0]?.id === "adm-1", "admin kept");
}

{
  const dual = user("both-1", "admin");
  const out = mergeEscalationRecipients(
    [{ ...dual, role: "sales_manager" }],
    [dual],
  );
  assert(out.recipients.length === 1, "same user id is not duplicated");
  assert(out.via === "sales_manager_admin", "present in both lists → union via");
}

assert(
  escalationRecipientViaLabel("sales_manager_admin") ===
    "sales managers and organization admins",
  "union label",
);

const directory = directoryUsersFromSetupRows([
  {
    id: "1",
    email: "asha@example.com",
    first_name: "Asha",
    last_name: "R",
    crm_role_name: "sales_rep",
  },
  {
    id: "2",
    email: "mia@example.com",
    first_name: "Mia",
    last_name: "K",
    crm_role_name: "marketing",
  },
  {
    id: "3",
    email: "fin@example.com",
    first_name: "Fin",
    last_name: "L",
    crm_role_name: "finance",
  },
  {
    id: "4",
    email: "none@example.com",
    first_name: "No",
    last_name: "Crm",
    crm_role_name: null,
  },
  {
    id: "5",
    email: "odd@example.com",
    first_name: "Odd",
    last_name: "Role",
    crm_role_name: "intern",
  },
]);
assert(parseCrmRole(null) === null, "blank CRM role is not a sales rep");
assert(parseCrmRole("intern") === null, "unknown CRM role is not a sales rep");
assert(
  directory.map((row) => row.id).join(",") === "1,2,3",
  "only real CRM roles are listed",
);
const sales = directory.filter((row) =>
  ["admin", "sales_manager", "sales_rep", "presales"].includes(row.role),
);
assert(sales.length === 1 && sales[0]?.id === "1", "sales lists omit marketing and finance");

console.log("user-directory.test.ts: ok");
