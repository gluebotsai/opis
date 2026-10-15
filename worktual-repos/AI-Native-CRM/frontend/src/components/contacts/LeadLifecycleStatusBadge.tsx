type Props = {
  status?: string | null;
  ladder?: string | null;
  from?: string | null;
  to?: string | null;
  reason?: string | null;
  lastAppliedAt?: string | null;
};

const LADDER_LABEL: Record<string, string> = {
  lead_status: "Lead status",
  lifecycle: "Lifecycle",
  pipeline: "Pipeline",
};

const STAGE_LABEL: Record<string, string> = {
  new: "New",
  contacted: "Contacted",
  qualifying: "Qualifying",
  qualified: "Qualified",
  disqualified: "Disqualified",
  converted: "Converted",
  lead: "Lead",
  prospect: "Prospect",
  customer: "Customer",
  qualification: "Qualify",
  discover: "Discover",
  propose: "Propose",
  negotiate: "Negotiate",
  closed_won: "Won",
  closed_lost: "Lost",
  quote_draft: "Quote drafted",
  quote_sent: "Quote sent",
  quote_accepted: "Quote accepted",
};

function stage(value: string | null | undefined): string {
  if (!value) return "—";
  return STAGE_LABEL[value] ?? value.replace(/_/g, " ");
}

/**
 * Read-only chip for the last autonomous lifecycle elevation on a contact.
 */
export function LeadLifecycleStatusBadge({
  status = null,
  ladder = null,
  from = null,
  to = null,
  reason = null,
  lastAppliedAt = null,
}: Props) {
  if (status !== "applied") return null;
  if (!ladder || !to) return null;

  const when = lastAppliedAt
    ? ` · ${new Date(lastAppliedAt).toLocaleDateString()}`
    : "";

  return (
    <div
      className="mb-4 rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-900"
      role="status"
    >
      <span className="font-medium">
        Lifecycle agent · {LADDER_LABEL[ladder] ?? "Lifecycle"} {stage(from)} →{" "}
        {stage(to)}
        {when}
      </span>
      {reason ? <span className="ml-1 text-indigo-800/80">— {reason}</span> : null}
    </div>
  );
}
