import Link from "next/link";
import {
  listCampaignsByBucket,
  type MonitorBucket,
} from "@/server/campaigns/campaign-service";

const TABS: { id: MonitorBucket; label: string }[] = [
  { id: "live", label: "Live" },
  { id: "scheduled", label: "Scheduled" },
  { id: "past", label: "Past" },
];

function formatDate(iso: string | null) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default async function CampaignsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const params = await searchParams;
  const tabRaw = params.tab ?? "live";
  const tab: MonitorBucket =
    tabRaw === "scheduled" || tabRaw === "past" || tabRaw === "live"
      ? tabRaw
      : "live";

  const result = await listCampaignsByBucket(tab);
  const items = result.ok ? result.items : [];
  const error = result.ok ? null : result.error;

  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-text-primary">
          Campaign monitoring
        </h1>
        <p className="mt-1 text-sm text-text-caption">
          Live, scheduled, and past campaigns for your branch.
        </p>
      </div>

      <div className="mb-4 flex gap-1 rounded-lg border border-border-default bg-surface p-1">
        {TABS.map((t) => {
          const active = t.id === tab;
          return (
            <Link
              key={t.id}
              href={`/campaigns?tab=${t.id}`}
              className={
                active
                  ? "rounded-md bg-violet-100 px-4 py-2 text-sm font-medium text-violet-700"
                  : "rounded-md px-4 py-2 text-sm text-text-caption hover:bg-subtle"
              }
            >
              {t.label}
            </Link>
          );
        })}
      </div>

      {error ? (
        <p className="rounded-lg border border-border-default bg-surface px-4 py-3 text-sm text-text-danger">
          {error}
        </p>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-default bg-surface px-6 py-12 text-center">
          <p className="text-sm font-medium text-text-primary">
            No {tab} campaigns yet
          </p>
          <p className="mt-1 text-sm text-text-caption">
            No {tab} campaigns yet for this branch.
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border-default bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border-default bg-subtle text-text-caption">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Starts</th>
                <th className="px-4 py-3 font-medium">Ends</th>
                <th className="px-4 py-3 font-medium">Channel</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr
                  key={item.id}
                  className="border-b border-border-default last:border-0"
                >
                  <td className="px-4 py-3">
                    <p className="font-medium text-text-primary">{item.name}</p>
                    {item.description ? (
                      <p className="mt-0.5 line-clamp-1 text-xs text-text-caption">
                        {item.description}
                      </p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 capitalize text-text-secondary">
                    {item.status.replace("_", " ")}
                  </td>
                  <td className="px-4 py-3 text-text-caption">
                    {formatDate(item.startsAt)}
                  </td>
                  <td className="px-4 py-3 text-text-caption">
                    {formatDate(item.endsAt)}
                  </td>
                  <td className="px-4 py-3 text-text-caption">
                    {item.sourceChannel === "crm_marketing"
                      ? "CRM Marketing"
                      : "Standalone"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
