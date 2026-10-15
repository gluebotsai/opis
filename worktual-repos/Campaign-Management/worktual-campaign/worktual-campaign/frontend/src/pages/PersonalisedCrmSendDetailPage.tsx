import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Loader2 } from "lucide-react";
import { ContentFadeIn } from "@/components/skeleton";
import { useEmbedPageReady } from "@/hooks/useEmbedPageReady";
import {
  getPersonalisedCrmRecipientsApi,
  getPersonalisedCrmRunApi,
  type PersonalisedCrmApiRun,
  type PersonalisedCrmRecipientRow,
} from "@/services/personalised-crm.service";

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

function statusClass(status: string): string {
  const s = status.toLowerCase();
  if (s === "completed" || s === "sent") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }
  if (s === "failed" || s === "cancelled") {
    return "border-red-200 bg-red-50 text-red-800";
  }
  if (s === "scheduled" || s === "pending") {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }
  if (s === "live" || s === "running") {
    return "border-sky-200 bg-sky-50 text-sky-800";
  }
  return "border-neutral-200 bg-neutral-50 text-neutral-700";
}

function flattenRecipientRows(recipients: PersonalisedCrmRecipientRow[]) {
  const rows: Array<{
    key: string;
    name: string;
    contact: string;
    channel: string;
    time: string;
    status: string;
  }> = [];
  recipients.forEach((person, i) => {
    const contact =
      person.email || person.phone || person.contact_id || person.name;
    const channels = person.channels?.length
      ? person.channels
      : [
          {
            channel: "—",
            outcome: person.outcome || "not_sent",
            status: person.outcome || "not_sent",
            skip_fail_reason: null,
            destination: person.email,
            scheduled_for: null,
            sent_at: null,
            opened_at: null,
            clicked_at: null,
          },
        ];
    channels.forEach((ch, j) => {
      rows.push({
        key: `${person.contact_id || i}-${ch.channel}-${j}`,
        name: person.name,
        contact: ch.destination || contact || "—",
        channel: ch.channel,
        time: formatWhen(ch.sent_at || ch.scheduled_for),
        status: ch.outcome || ch.status || "pending",
      });
    });
  });
  return rows;
}

export function PersonalisedCrmSendDetailBody({
  runId,
  embedded = false,
}: {
  runId: string;
  embedded?: boolean;
}) {
  const [run, setRun] = useState<PersonalisedCrmApiRun | null>(null);
  const [grid, setGrid] = useState<ReturnType<typeof flattenRecipientRows>>([]);
  const [loading, setLoading] = useState(Boolean(runId));
  useEmbedPageReady(!loading);

  useEffect(() => {
    if (!runId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [apiRun, report] = await Promise.all([
          getPersonalisedCrmRunApi(runId),
          getPersonalisedCrmRecipientsApi(runId),
        ]);
        if (cancelled) return;
        setRun(apiRun);
        setGrid(flattenRecipientRows(report?.recipients || []));
      } catch {
        if (!cancelled) {
          setRun(null);
          setGrid([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [runId]);

  if (loading) {
    return (
      <div
        className={`flex min-h-[16rem] flex-col items-center justify-center gap-2 px-6 ${
          embedded ? "" : "h-full bg-[#f3f4f6]"
        }`}
      >
        <Loader2 className="size-5 animate-spin text-neutral-400" />
        <p className="text-sm text-neutral-500">Loading Personalised CRM send…</p>
      </div>
    );
  }

  if (!run) {
    return (
      <div
        className={`flex flex-col items-center justify-center gap-3 px-6 ${
          embedded ? "min-h-[16rem]" : "h-full bg-[#f3f4f6]"
        }`}
      >
        <p className="text-sm font-medium text-neutral-900">
          Personalised CRM send not found
        </p>
        {!embedded ? (
          <Link
            to="/campaigns?tab=personalised-crm"
            className="text-sm font-medium text-neutral-600 underline hover:text-neutral-900"
          >
            Back to Personalised CRM
          </Link>
        ) : null}
      </div>
    );
  }

  return (
    <div
      className={
        embedded
          ? "flex min-h-0 flex-col"
          : "flex h-full min-h-0 flex-col overflow-y-auto bg-[#f3f4f6]"
      }
    >
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
        {!embedded ? (
          <Link
            to="/campaigns?tab=personalised-crm"
            className="inline-flex h-[38px] items-center gap-1.5 text-sm font-medium text-neutral-600 hover:text-neutral-900"
          >
            <ArrowLeft className="size-[18px]" strokeWidth={1.75} />
            Personalised CRM
          </Link>
        ) : null}

        <ContentFadeIn className={embedded ? "space-y-4" : "mt-4 space-y-4"}>
          <div className="rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h1 className="text-xl font-semibold tracking-tight text-neutral-900">
                  {run.title}
                </h1>
                <p className="mt-1 text-xs text-neutral-500">Run id {run.id}</p>
              </div>
              <span
                className={`rounded-full border px-2.5 py-0.5 text-xs font-medium capitalize ${statusClass(run.status)}`}
              >
                {run.status}
              </span>
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Channels" value={run.channels.join(", ") || "—"} />
              <Field label="Send at" value={formatWhen(run.sendAt || run.scheduledAt)} />
              <Field label="Audience" value={run.audienceHint || String(run.audienceCount)} />
              <Field
                label="Delivery"
                value={`${run.sent} sent · ${run.failed} failed · ${run.pending} pending`}
              />
            </div>
            {run.brief ? (
              <p className="mt-4 text-sm text-neutral-700">{run.brief}</p>
            ) : null}
          </div>

          <div className="overflow-hidden rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white shadow-sm">
            <div className="border-b-[0.6px] border-[#bfbfbf] px-5 py-3">
              <h2 className="text-sm font-semibold text-neutral-900">
                Recipients
              </h2>
              <p className="mt-0.5 text-xs text-neutral-500">
                Contact × channel × time × status
              </p>
            </div>
            {grid.length === 0 ? (
              <p className="px-5 py-8 text-sm text-neutral-500">
                Recipients will appear here once send batches are planned.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-[#f3f4f6] text-xs font-medium uppercase tracking-wide text-neutral-500">
                    <tr>
                      <th className="px-5 py-2.5">Contact</th>
                      <th className="px-5 py-2.5">Channel</th>
                      <th className="px-5 py-2.5">Time</th>
                      <th className="px-5 py-2.5">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grid.map((row) => (
                      <tr
                        key={row.key}
                        className="border-t-[0.6px] border-[#bfbfbf]"
                      >
                        <td className="px-5 py-2.5">
                          <p className="font-medium text-neutral-900">
                            {row.name}
                          </p>
                          <p className="text-xs text-neutral-500">
                            {row.contact}
                          </p>
                        </td>
                        <td className="px-5 py-2.5 capitalize text-neutral-800">
                          {row.channel}
                        </td>
                        <td className="px-5 py-2.5 text-neutral-700">
                          {row.time}
                        </td>
                        <td className="px-5 py-2.5">
                          <span
                            className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${statusClass(row.status)}`}
                          >
                            {row.status.replace(/_/g, " ")}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </ContentFadeIn>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-neutral-500">{label}</p>
      <p className="mt-0.5 break-all text-sm text-neutral-900">{value}</p>
    </div>
  );
}

export function PersonalisedCrmSendDetailPage() {
  const { runId } = useParams();
  return <PersonalisedCrmSendDetailBody runId={String(runId || "")} />;
}
