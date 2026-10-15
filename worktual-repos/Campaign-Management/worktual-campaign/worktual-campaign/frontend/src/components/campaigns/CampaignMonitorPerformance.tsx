import { useEffect, useMemo, useState } from "react";
import {
  Bell,
  CalendarDays,
  ChevronDown,
  Globe,
  Loader2,
  Mail,
  Megaphone,
  MessageSquare,
  Pause,
  Play,
  Smartphone,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  ChannelKpiCard,
  OutcomesDonut,
  type ChannelKpi,
} from "@/components/campaigns/CampaignMonitorCharts";
import { computeCampaignPerformanceFromDetail } from "@/lib/campaign-performance-metrics";
import { CampaignSendFailuresAlert } from "@/components/campaigns/CampaignSendFailuresAlert";
import {
  fetchRecentSendFailures,
  pickEmailAbWinner,
  setChannelRunState,
  type CampaignChannelDetail,
  type CampaignDetail,
  type CampaignSendFailureRow,
} from "@/services/campaigns.service";
import { notifyCampaignChannelRunState } from "@/lib/campaign-activity-notifications";

function channelIcon(channel: string) {
  const c = channel.toLowerCase();
  if (c === "email") return Mail;
  if (c === "sms") return MessageSquare;
  if (c === "whatsapp") return MessageSquare;
  if (c === "push" || c === "apppush" || c === "app_push") return Bell;
  if (c === "web" || c === "web_push") return Globe;
  if (c === "ppc") return Megaphone;
  return Smartphone;
}

export function formatMonitorChannel(channel: string) {
  const c = channel.toLowerCase();
  if (c === "push" || c === "apppush" || c === "app_push") return "App push";
  if (c === "web" || c === "web_push") return "Web push";
  if (c === "ppc") return "PPC";
  return c.charAt(0).toUpperCase() + c.slice(1);
}

function formatMoney(amount: number, currency?: string | null) {
  const cur = (currency || "INR").trim() || "INR";
  return `${cur} ${Math.round(amount).toLocaleString()}`;
}

function channelKey(channel: string) {
  return channel.toLowerCase();
}

function isPpcChannel(channel: string) {
  return channelKey(channel) === "ppc";
}

function isEmailChannel(channel: string) {
  return channelKey(channel) === "email";
}

function isClickTrackedChannel(channel: string) {
  return channelKey(channel) === "email";
}

function channelIconClass(channel: string) {
  const c = channelKey(channel);
  if (c === "email") return "bg-blue-50 text-blue-700";
  if (c === "sms") return "bg-sky-50 text-sky-700";
  if (c === "whatsapp") return "bg-emerald-50 text-emerald-700";
  if (c === "web" || c === "web_push" || c === "webpush") {
    return "bg-violet-50 text-violet-700";
  }
  if (c === "push" || c === "apppush" || c === "app_push") {
    return "bg-orange-50 text-orange-700";
  }
  if (c === "ppc") return "bg-amber-50 text-amber-800";
  return "bg-neutral-100 text-neutral-800";
}

export function ChannelLogo({
  channel,
  className = "",
}: {
  channel: string;
  className?: string;
}) {
  const Icon = channelIcon(channel);
  return (
    <span
      className={`inline-flex size-7 items-center justify-center rounded-md bg-neutral-900 text-white ${className}`}
      title={formatMonitorChannel(channel)}
    >
      <Icon className="size-3.5" strokeWidth={1.75} />
    </span>
  );
}

function formatLaunchWhen(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function joinChannelNames(names: string[]) {
  if (names.length === 0) return "No channels";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

function audienceSummaryLine(campaign: CampaignDetail, selected: number) {
  const text = campaign.audienceSummary?.trim().replace(/\.+$/, "") || "";
  const count = campaign.audienceCount || selected;
  if (text && count > 0) {
    return `${count.toLocaleString()} contacts · ${text}`;
  }
  if (text) return text;
  if (count > 0) return `${count.toLocaleString()} contacts`;
  return "Audience pending";
}

function SummaryFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] text-text-caption">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-text-primary">{value}</dd>
    </div>
  );
}

function CampaignSummaryCard({
  campaign,
  delivery,
  kind,
}: {
  campaign: CampaignDetail;
  delivery: ReturnType<
    typeof computeCampaignPerformanceFromDetail
  >["delivery"];
  kind: "scheduled" | "live" | "past";
}) {
  const channelNames = campaign.channels.map((ch) =>
    formatMonitorChannel(ch.channel),
  );
  const channels = joinChannelNames(channelNames);
  const audience = audienceSummaryLine(campaign, delivery.selected);
  const when = formatLaunchWhen(campaign.startsAt);
  const processed = delivery.sent + delivery.failed + delivery.bounced;
  const remaining = Math.max(delivery.pending, 0);
  const total = Math.max(delivery.selected, processed + remaining, 1);
  const donePct = Math.min(100, Math.round((processed / total) * 100));

  const paragraph =
    kind === "scheduled"
      ? `Scheduled for ${when}. Will send on ${channels}. ${audience}.`
      : kind === "live"
        ? `Sending now on ${channels}. ${delivery.sent.toLocaleString()} of ${delivery.selected.toLocaleString()} sent · ${remaining.toLocaleString()} contacts still pending${
            delivery.failed > 0
              ? ` · ${delivery.failed.toLocaleString()} failed`
              : ""
          }.`
        : `Ran on ${channels}. ${delivery.selected.toLocaleString()} selected, ${delivery.sent.toLocaleString()} sent, ${delivery.failed.toLocaleString()} failed, ${delivery.bounced.toLocaleString()} bounced.`;

  const facts =
    kind === "scheduled"
      ? [
          ["Scheduled date", when],
          ["Channels", channelNames.length ? channelNames.join(" · ") : "—"],
          ["Audience", audience],
        ]
      : kind === "live"
        ? [
            [
              "Done",
              `${processed.toLocaleString()} of ${delivery.selected.toLocaleString()} (${donePct}%)`,
            ],
            ["Pending contacts", remaining.toLocaleString()],
            ["Channels", channelNames.length ? channelNames.join(" · ") : "—"],
            ["Audience", audience],
          ]
        : [
            ["Channels", channelNames.length ? channelNames.join(" · ") : "—"],
            ["Audience", audience],
            ["Goal", campaign.goal?.trim() || "—"],
          ];

  return (
    <section>
      <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">
        Summary
      </p>
      <div className="mt-2 rounded-xl border border-neutral-200 bg-white px-3 py-3 shadow-sm">
        <p className="text-sm leading-relaxed text-text-primary">{paragraph}</p>
        {kind === "live" ? (
          <div className="mt-3">
            <div className="h-1.5 overflow-hidden rounded-full bg-neutral-100">
              <div
                className="h-full rounded-full bg-emerald-500"
                style={{ width: `${donePct}%` }}
              />
            </div>
            <p className="mt-1 text-[11px] text-text-caption">
              {donePct}% processed · {remaining.toLocaleString()} pending
            </p>
          </div>
        ) : null}
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          {facts.map(([label, value]) => (
            <SummaryFact key={label} label={label} value={value} />
          ))}
        </dl>
        {kind === "scheduled" && campaign.goal?.trim() ? (
          <p className="mt-3 text-xs text-text-caption">
            Goal: {campaign.goal.trim()}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function channelKpis(ch: CampaignChannelDetail): ChannelKpi[] {
  const selected = ch.selected || ch.totalToSend || 0;
  const sent = ch.sent || 0;
  const failed = ch.failed || 0;
  const items: ChannelKpi[] = [
    { label: "Selected", value: selected.toLocaleString(), tone: "selected" },
    { label: "Sent", value: sent.toLocaleString(), tone: "sent" },
    { label: "Failed", value: failed.toLocaleString(), tone: "failed" },
  ];
  if (isEmailChannel(ch.channel)) {
    items.push(
      {
        label: "Opened",
        value: (ch.opens || 0).toLocaleString(),
        tone: "opened",
      },
      {
        label: "Clicked",
        value: (ch.clicks || 0).toLocaleString(),
        tone: "clicked",
      },
    );
  } else if (isClickTrackedChannel(ch.channel)) {
    items.push({
      label: "Clicked",
      value: (ch.clicks || 0).toLocaleString(),
      tone: "clicked",
    });
  }
  return items;
}

function channelExtras(ch: CampaignChannelDetail) {
  const selected = ch.selected || ch.totalToSend || 0;
  const sent = ch.sent || 0;
  const failed = ch.failed || 0;
  const bounced = ch.bounced || 0;
  const pending = Math.max(0, selected - sent - failed - bounced);
  if (isPpcChannel(ch.channel)) {
    return (
      <p>
        {formatMoney(ch.spend || 0, ch.currency)} spend
        {ch.cpc != null ? ` · ${formatMoney(ch.cpc, ch.currency)} CPC` : ""}
        {ch.cpa != null ? ` · ${formatMoney(ch.cpa, ch.currency)} CPA` : ""}
        {(ch.clicks || 0) > 0 ? ` · ${(ch.clicks || 0).toLocaleString()} clicks` : ""}
      </p>
    );
  }
  return (
    <p>
      {selected.toLocaleString()} selected · {sent.toLocaleString()} sent ·{" "}
      {failed.toLocaleString()} failed · {bounced.toLocaleString()} bounced
      {pending > 0 ? ` · ${pending.toLocaleString()} pending` : ""}
      {isClickTrackedChannel(ch.channel) && !isEmailChannel(ch.channel)
        ? ` · ${(ch.clicks || 0).toLocaleString()} unique clicks`
        : ""}
    </p>
  );
}

type Props = {
  campaign: CampaignDetail;
  onCampaignChange: (next: CampaignDetail) => void;
};

/** Same channel metrics + stop/resume as campaign monitoring detail (no chat). */
export function CampaignMonitorPerformance({
  campaign,
  onCampaignChange,
}: Props) {
  const [busyChannel, setBusyChannel] = useState<string | null>(null);
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [reasonText, setReasonText] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [openChannelId, setOpenChannelId] = useState<string | null>(
    () => campaign.channels[0]?.id ?? null,
  );
  const [busyAb, setBusyAb] = useState(false);
  const [sendFailures, setSendFailures] = useState<CampaignSendFailureRow[]>(
    [],
  );
  const [sendFailuresLoading, setSendFailuresLoading] = useState(false);

  const isPast = useMemo(() => {
    if (campaign.status === "completed" || campaign.status === "cancelled") {
      return true;
    }
    if (campaign.endsAt && new Date(campaign.endsAt).getTime() < Date.now()) {
      return true;
    }
    return false;
  }, [campaign]);

  const canControl = useMemo(() => {
    if (isPast) return false;
    return campaign.status === "live" || campaign.status === "scheduled";
  }, [campaign.status, isPast]);

  const launchPrefix =
    campaign.status === "scheduled" ? "Scheduled for" : "Launched on";
  const launchWhen = formatLaunchWhen(campaign.startsAt);
  const delivery = useMemo(
    () => computeCampaignPerformanceFromDetail(campaign).delivery,
    [campaign],
  );
  const summaryKind: "scheduled" | "live" | "past" =
    campaign.status === "scheduled"
      ? "scheduled"
      : isPast
        ? "past"
        : "live";

  useEffect(() => {
    setOpenChannelId(campaign.channels[0]?.id ?? null);
    setReasonFor(null);
    setReasonText("");
    setActionError(null);
  }, [campaign.id]);

  useEffect(() => {
    const needsDetail =
      delivery.failed > 0 ||
      delivery.bounced > 0 ||
      campaign.channels.some((ch) => (ch.failed ?? 0) > 0);
    if (!campaign.id || !needsDetail) {
      setSendFailures([]);
      setSendFailuresLoading(false);
      return;
    }
    let cancelled = false;
    setSendFailuresLoading(true);
    void fetchRecentSendFailures({ campaignId: campaign.id, limit: 10 })
      .then(({ failures }) => {
        if (!cancelled) setSendFailures(failures);
      })
      .catch(() => {
        if (!cancelled) setSendFailures([]);
      })
      .finally(() => {
        if (!cancelled) setSendFailuresLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    campaign.id,
    delivery.failed,
    delivery.bounced,
    campaign.channels.reduce((n, ch) => n + (ch.failed ?? 0), 0),
  ]);

  const resolvedOpenId = useMemo(() => {
    if (openChannelId === null) return null;
    if (campaign.channels.some((channel) => channel.id === openChannelId)) {
      return openChannelId;
    }
    return campaign.channels[0]?.id ?? null;
  }, [openChannelId, campaign.channels]);

  const applyStop = async (channel: string) => {
    if (!reasonText.trim()) {
      setActionError("Enter a reason to stop this channel.");
      return;
    }
    setBusyChannel(channel);
    setActionError(null);
    try {
      const next = await setChannelRunState(campaign.id, channel, {
        paused: true,
        reason: reasonText.trim(),
      });
      onCampaignChange(next);
      notifyCampaignChannelRunState({
        campaignId: campaign.id,
        campaignName: campaign.name || "Campaign",
        channel,
        paused: true,
        reason: reasonText.trim(),
      });
      setReasonFor(null);
      setReasonText("");
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Stop failed");
    } finally {
      setBusyChannel(null);
    }
  };

  const applyResume = async (channel: string) => {
    setBusyChannel(channel);
    setActionError(null);
    try {
      const next = await setChannelRunState(campaign.id, channel, {
        paused: false,
      });
      onCampaignChange(next);
      notifyCampaignChannelRunState({
        campaignId: campaign.id,
        campaignName: campaign.name || "Campaign",
        channel,
        paused: false,
      });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Resume failed");
    } finally {
      setBusyChannel(null);
    }
  };

  const applyAbWinner = async (winner: "a" | "b" | null) => {
    setBusyAb(true);
    setActionError(null);
    try {
      const result = await pickEmailAbWinner(campaign.id, {
        winner,
        force: true,
      });
      if (result.campaign) onCampaignChange(result.campaign);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "A/B winner failed");
    } finally {
      setBusyAb(false);
    }
  };

  return (
    <div className="space-y-4 p-4 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-lg font-semibold text-text-primary">
            {campaign.name}
          </p>
          <p
            className={`mt-0.5 text-xs capitalize ${
              isPast ? "text-emerald-700" : "text-text-caption"
            }`}
          >
            {campaign.status}
            {isPast ? " • Past (Cannot Resume)" : ""}
          </p>
        </div>
        <p className="flex shrink-0 items-center gap-1.5 text-xs text-text-caption">
          <CalendarDays className="size-3.5" strokeWidth={1.75} />
          {launchPrefix} {launchWhen}
        </p>
      </div>

      {actionError ? (
        <p className="rounded-lg border border-border-default bg-red-50 px-3 py-2 text-xs text-red-700">
          {actionError}
        </p>
      ) : null}

      <CampaignSummaryCard
        campaign={campaign}
        delivery={delivery}
        kind={summaryKind}
      />

      {summaryKind !== "scheduled" &&
      (delivery.failed > 0 ||
        delivery.bounced > 0 ||
        sendFailuresLoading ||
        sendFailures.length > 0) ? (
        <CampaignSendFailuresAlert
          failures={sendFailures}
          loading={sendFailuresLoading}
          fallbackFailedCount={
            sendFailures.length || sendFailuresLoading
              ? 0
              : delivery.failed + delivery.bounced
          }
        />
      ) : null}

      {summaryKind !== "scheduled" ? (
        <section>
          <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">
            Outcomes
          </p>
          <div className="mt-2">
            <OutcomesDonut
              selected={delivery.selected}
              sent={delivery.sent}
              failed={delivery.failed}
              bounced={delivery.bounced}
              pending={delivery.pending}
              showPending={summaryKind === "live" || delivery.pending > 0}
            />
          </div>
        </section>
      ) : null}

      <div className="space-y-2">
        {campaign.channels.map((ch) => {
          const Icon = channelIcon(ch.channel);
          const open = ch.id === resolvedOpenId;
          const showReasonForm = reasonFor === ch.channel;
          const isPpc = isPpcChannel(ch.channel);
          const isEmail = isEmailChannel(ch.channel);
          const when = formatLaunchWhen(
            ch.plannedLaunchAt || campaign.startsAt,
          );
          const emailAb =
            isEmail && campaign.emailAb?.enabled ? campaign.emailAb : null;

          return (
            <div
              key={ch.id}
              className="overflow-hidden rounded-xl border border-neutral-200 bg-white"
            >
              <div className="flex items-center gap-2 px-3">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-2.5 py-3 text-left"
                  aria-expanded={open}
                  onClick={() => setOpenChannelId(open ? null : ch.id)}
                >
                  <span
                    className={`inline-flex size-8 shrink-0 items-center justify-center rounded-lg ${channelIconClass(ch.channel)}`}
                  >
                    <Icon className="size-4" strokeWidth={1.75} />
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary">
                    {formatMonitorChannel(ch.channel)}
                    {isPpc && ch.network
                      ? ` · ${ch.network === "google" ? "Google" : "Meta"}`
                      : ""}
                    {ch.paused ? (
                      <span className="ml-2 text-xs font-medium text-amber-700">
                        Paused
                      </span>
                    ) : null}
                  </span>
                </button>
                {canControl ? (
                  ch.paused ? (
                    <Button
                      type="button"
                      variant="secondary"
                      className="h-8 shrink-0 px-2.5"
                      disabled={busyChannel === ch.channel}
                      onClick={() => void applyResume(ch.channel)}
                    >
                      {busyChannel === ch.channel ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Play className="size-3.5" strokeWidth={1.75} />
                      )}
                      Resume
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="secondary"
                      className="h-8 shrink-0 px-2.5"
                      disabled={busyChannel === ch.channel}
                      onClick={() => {
                        setOpenChannelId(ch.id);
                        setReasonFor(ch.channel);
                        setReasonText("");
                        setActionError(null);
                      }}
                    >
                      <Pause className="size-3.5" strokeWidth={1.75} />
                      Stop
                    </Button>
                  )
                ) : (
                  <span className="shrink-0 rounded-md bg-neutral-100 px-2 py-0.5 text-xs font-medium text-neutral-600">
                    {isPast ? "Ended" : "—"}
                  </span>
                )}
                <button
                  type="button"
                  className="shrink-0 p-1 text-text-caption"
                  aria-label={
                    open
                      ? `Collapse ${formatMonitorChannel(ch.channel)}`
                      : `Expand ${formatMonitorChannel(ch.channel)}`
                  }
                  aria-expanded={open}
                  onClick={() => setOpenChannelId(open ? null : ch.id)}
                >
                  <ChevronDown
                    className={`size-4 transition-transform ${
                      open ? "rotate-180" : ""
                    }`}
                    strokeWidth={1.75}
                  />
                </button>
              </div>

              {open ? (
                <div className="space-y-3 border-t border-neutral-200 px-3 py-3">
                  <ChannelKpiCard
                    launchLabel={launchPrefix}
                    launchWhen={when}
                    metrics={channelKpis(ch)}
                    extras={channelExtras(ch)}
                    menu={
                      canControl ? (
                        ch.paused ? (
                          <button
                            type="button"
                            className="block w-full px-3 py-1.5 text-left text-xs text-neutral-800 hover:bg-neutral-50"
                            onClick={() => void applyResume(ch.channel)}
                          >
                            Resume
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="block w-full px-3 py-1.5 text-left text-xs text-neutral-800 hover:bg-neutral-50"
                            onClick={() => {
                              setReasonFor(ch.channel);
                              setReasonText("");
                              setActionError(null);
                            }}
                          >
                            Stop
                          </button>
                        )
                      ) : undefined
                    }
                  />

                  {emailAb ? (
                    <div className="space-y-2">
                      <p className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">
                        A/B test
                      </p>
                      <p className="text-xs text-neutral-500">
                        {emailAb.pctA}% A · {emailAb.pctB}% B ·{" "}
                        {emailAb.pctHoldout}% holdout
                        {emailAb.winner
                          ? ` · winner ${emailAb.winner.toUpperCase()}`
                          : emailAb.auto
                            ? ` · auto winner after ${emailAb.decideAfterMinutes} min`
                            : ""}
                        {emailAb.remainderReleased ? " · remainder sent" : ""}
                        {` · holdout held ${emailAb.holdout.held} / sent ${emailAb.holdout.sent}`}
                      </p>
                      {emailAb.variants.map((v) => (
                        <ChannelKpiCard
                          key={v.variant}
                          title={`Variant ${v.variant.toUpperCase()}`}
                          winner={emailAb.winner === v.variant}
                          muted={
                            Boolean(emailAb.winner) &&
                            emailAb.winner !== v.variant
                          }
                          launchLabel={launchPrefix}
                          launchWhen={when}
                          metrics={[
                            {
                              label: "Sent",
                              value: v.sent.toLocaleString(),
                              tone: "sent",
                            },
                            {
                              label: "Failed",
                              value: v.failed.toLocaleString(),
                              tone: "failed",
                            },
                            {
                              label: "Opened",
                              value: v.opens.toLocaleString(),
                              tone: "opened",
                            },
                            {
                              label: "Clicked",
                              value: v.clicks.toLocaleString(),
                              tone: "clicked",
                            },
                          ]}
                          extras={
                            <p>
                              {v.opens.toLocaleString()} unique opens ·{" "}
                              {v.clicks.toLocaleString()} unique clicks
                              {v.held > 0
                                ? ` · ${v.held.toLocaleString()} held`
                                : ""}
                            </p>
                          }
                        />
                      ))}
                      {canControl && !emailAb.remainderReleased ? (
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="secondary"
                            className="h-8 px-2.5"
                            disabled={busyAb}
                            onClick={() => void applyAbWinner("a")}
                          >
                            Use A
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            className="h-8 px-2.5"
                            disabled={busyAb}
                            onClick={() => void applyAbWinner("b")}
                          >
                            Use B
                          </Button>
                          <Button
                            type="button"
                            variant="brand"
                            className="h-8 px-2.5"
                            disabled={busyAb}
                            onClick={() => void applyAbWinner(null)}
                          >
                            {busyAb ? (
                              <Loader2 className="size-3.5 animate-spin" />
                            ) : null}
                            Auto-pick remainder
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {ch.pauseReason ? (
                    <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900">
                      Stop reason: {ch.pauseReason}
                    </p>
                  ) : null}

                  {showReasonForm ? (
                    <div className="space-y-2 rounded-lg border border-border-default bg-subtle p-2.5">
                      <p className="text-xs font-medium text-text-primary">
                        Reason to stop {formatMonitorChannel(ch.channel)}
                      </p>
                      <textarea
                        value={reasonText}
                        onChange={(e) => setReasonText(e.target.value)}
                        rows={2}
                        placeholder="Why are you stopping this channel?"
                        className="w-full resize-none rounded-lg border border-border-default bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-border-strong"
                      />
                      <div className="flex justify-end gap-2">
                        <Button
                          type="button"
                          variant="secondary"
                          className="h-8 px-2.5"
                          onClick={() => setReasonFor(null)}
                        >
                          Cancel
                        </Button>
                        <Button
                          type="button"
                          variant="brand"
                          className="h-8 px-2.5"
                          disabled={
                            !reasonText.trim() || busyChannel === ch.channel
                          }
                          onClick={() => void applyStop(ch.channel)}
                        >
                          Confirm stop
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}

        {campaign.channels.length === 0 ? (
          <p className="text-sm text-text-caption">
            No channels on this campaign.
          </p>
        ) : null}
      </div>
    </div>
  );
}
