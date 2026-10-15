import {
  formatSendFailureReason,
  sendFailureRemedy,
  type CampaignSendFailureRow,
} from "@/lib/campaign-send-failures";

type Props = {
  failures: CampaignSendFailureRow[];
  loading?: boolean;
  /** Shown when metrics report failures but API returned no rows yet. */
  fallbackFailedCount?: number;
};

export function CampaignSendFailuresAlert({
  failures,
  loading,
  fallbackFailedCount = 0,
}: Props) {
  if (loading) {
    return (
      <section
        className="rounded-xl border border-amber-200 bg-amber-50/80 px-3 py-3"
        aria-busy="true"
      >
        <p className="text-xs font-medium text-amber-900">
          Loading send failure details…
        </p>
      </section>
    );
  }
  if (!failures.length) {
    if (fallbackFailedCount <= 0) return null;
    return (
      <section className="rounded-xl border border-red-200 bg-red-50 px-3 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-red-800">
          Why send failed
        </p>
        <p className="mt-2 text-xs leading-relaxed text-red-800">
          {fallbackFailedCount.toLocaleString()} recipient
          {fallbackFailedCount === 1 ? "" : "s"} failed. Details are still
          syncing — refresh in a moment, or open the full campaign monitor
          recipients view.
        </p>
      </section>
    );
  }

  const shown = failures.slice(0, 5);
  const primary = shown[0]!;
  const remedy = sendFailureRemedy(primary.skip_fail_reason);

  return (
    <section className="rounded-xl border border-red-200 bg-red-50 px-3 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-red-800">
        Why send failed
      </p>
      <ul className="mt-2 space-y-2">
        {shown.map((row) => {
          const who =
            (row.email || row.destination || "").trim() || "Recipient";
          const reason = formatSendFailureReason(row.skip_fail_reason);
          return (
            <li key={row.recipient_id || `${who}-${reason}`} className="text-xs">
              <span className="font-medium text-red-900">{who}</span>
              {row.channel ? (
                <span className="text-red-700"> · {row.channel}</span>
              ) : null}
              <p className="mt-0.5 leading-relaxed text-red-800">{reason}</p>
            </li>
          );
        })}
      </ul>
      {remedy ? (
        <p className="mt-3 border-t border-red-200/80 pt-2 text-xs leading-relaxed text-red-900">
          <span className="font-semibold">What to do: </span>
          {remedy}
        </p>
      ) : null}
    </section>
  );
}
