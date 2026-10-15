import { Users } from "lucide-react";
import { accountQuery } from "@/server/db/account-pool";
import { requireCampaignSession } from "@/server/auth/login-action";
import { ModulePage } from "@/components/layout/ModulePage";

type ContactRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  company_name: string | null;
};

export default async function ContactsPage() {
  const session = await requireCampaignSession();

  let items: ContactRow[] = [];
  let error: string | null = null;

  try {
    const { rows } = await accountQuery<ContactRow>(
      `SELECT id, first_name, last_name, email, phone, company_name
       FROM public.contacts
       WHERE organization_id = $1::bigint
       ORDER BY updated_at DESC NULLS LAST, created_at DESC
       LIMIT 50`,
      [session.tenantId],
    );
    items = rows;
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load contacts.";
  }

  return (
    <ModulePage
      title="Contacts"
      description="People from your account directory (read-only). Used for campaign audiences — contacts stay in my_account_db."
      icon={Users}
    >
      {error ? (
        <p className="rounded-xl border border-border-default bg-surface px-4 py-3 text-sm text-text-danger">
          {error}
        </p>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-default bg-surface px-6 py-16 text-center">
          <p className="text-sm font-medium text-text-primary">No contacts yet</p>
          <p className="mt-1 text-sm text-text-caption">
            Contacts for this tenant will appear here from the account database.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border-default bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border-default bg-subtle text-text-caption">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Email</th>
                <th className="px-4 py-3 font-medium">Phone</th>
                <th className="px-4 py-3 font-medium">Company</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => {
                const name =
                  [row.first_name, row.last_name].filter(Boolean).join(" ") ||
                  "—";
                return (
                  <tr
                    key={row.id}
                    className="border-b border-border-default last:border-0"
                  >
                    <td className="px-4 py-3 font-medium text-text-primary">
                      {name}
                    </td>
                    <td className="px-4 py-3 text-text-secondary">
                      {row.email ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-text-caption">
                      {row.phone ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-text-caption">
                      {row.company_name ?? "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </ModulePage>
  );
}
