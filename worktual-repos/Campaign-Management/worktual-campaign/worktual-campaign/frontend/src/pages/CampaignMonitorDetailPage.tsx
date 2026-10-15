import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Bell,
  Globe,
  Loader2,
  Mail,
  Megaphone,
  MessageSquare,
  Pause,
  Play,
  Smartphone,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AgentChatComposer } from "@/components/chat/AgentChatComposer";
import { AgentThinkingIndicator } from "@/components/chat/AgentThinkingIndicator";
import { CampaignPerformanceCharts } from "@/components/campaigns/CampaignPerformanceCharts";
import { Button } from "@/components/ui/Button";
import { ContentFadeIn } from "@/components/skeleton";
import { ModuleSplitWorkspace } from "@/components/layout/ModuleSplitWorkspace";
import { chatBubbleClass } from "@/lib/chat-bubbles";
import { CampaignMonitorDetailSkeleton } from "@/pages/CampaignMonitorDetailSkeleton";
import { getParentHref } from "@/lib/nav-hierarchy";
import { getCampaignProfile } from "@/lib/industry-packs";
import { getToken } from "@/services/api";
import {
  fetchCampaignById,
  fetchCampaignRecipients,
  pickEmailAbWinner,
  setChannelRunState,
  type CampaignDetail,
  type CampaignRecipientsReport,
} from "@/services/campaigns.service";
import { notifyCampaignChannelRunState } from "@/lib/campaign-activity-notifications";
import { formatCampaignListMetrics } from "@/components/campaigns/CampaignMonitoringList";
import {
  formatWhatsAppMetaBadge,
  readWhatsAppLaunchMeta,
} from "@/lib/whatsapp-campaign-meta";
import { formatMonitorChannelMetricsLine } from "@/lib/campaign-monitoring-summary";
import {
  isClickTrackedChannel,
  isOpenTrackedChannel,
} from "@/lib/dashboard-metrics";
import { getAgentsSocket } from "@/services/agents.socket";

type ChatMsg = { id: string; role: "user" | "assistant"; text: string };

function monitorDetailWelcome(campaignName?: string | null): ChatMsg {
  const name = (campaignName || "").trim() || "this campaign";
  return {
    id: crypto.randomUUID(),
    role: "assistant",
    text: `Ask — I can report on ${name}: who was selected, who was sent, who was stubbed (not delivered), who missed, stop/resume a channel, or pick an email A/B winner early.`,
  };
}

function channelIcon(channel: string) {
  const c = channel.toLowerCase();
  if (c === "email") return Mail;
  if (c === "sms") return MessageSquare;
  if (c === "whatsapp") return MessageSquare;
  if (c === "push" || c === "apppush") return Bell;
  if (c === "web") return Globe;
  if (c === "ppc") return Megaphone;
  return Smartphone;
}

function formatChannel(channel: string) {
  const c = channel.toLowerCase();
  if (c === "push" || c === "apppush") return "App push";
  if (c === "ppc") return "PPC";
  return c.charAt(0).toUpperCase() + c.slice(1);
}

function formatMoney(amount: number, currency?: string | null) {
  const cur = (currency || "INR").trim() || "INR";
  return `${cur} ${Math.round(amount).toLocaleString()}`;
}

export function CampaignMonitorDetailPage() {
  const { campaignId = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const from = new URLSearchParams(location.search).get("from");
  const backHref =
    getParentHref({
      pathname: location.pathname,
      search: location.search,
      from,
      entryHref: (location.state as { listHref?: string } | null)?.listHref,
    }) || "/campaigns";
  const [campaign, setCampaign] = useState<CampaignDetail | null>(null);
  const [recipients, setRecipients] = useState<CampaignRecipientsReport | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyChannel, setBusyChannel] = useState<string | null>(null);
  const [busyAb, setBusyAb] = useState(false);
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [reasonText, setReasonText] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const [messages, setMessages] = useState<ChatMsg[]>(() => [
    monitorDetailWelcome(),
  ]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [typing, setTyping] = useState(false);
  const [socketError, setSocketError] = useState<string | null>(null);
  const sessionIdRef = useRef(crypto.randomUUID());
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    if (!campaignId) return;
    setLoading(true);
    setError(null);
    try {
      const [row, recs] = await Promise.all([
        fetchCampaignById(campaignId),
        fetchCampaignRecipients(campaignId).catch(() => null),
      ]);
      setCampaign(row);
      setRecipients(recs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load campaign");
      setCampaign(null);
    } finally {
      setLoading(false);
    }
  }, [campaignId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!campaignId) return;
    const token = getToken();
    if (!token) {
      setSocketError("Sign in required for monitoring chat.");
      return;
    }
    // Fresh monitoring session per campaign open — never reuse create-campaign history.
    sessionIdRef.current = crypto.randomUUID();
    const socket = getAgentsSocket();
    const sessionId = sessionIdRef.current;
    setSocketError(null);
    setMessages([monitorDetailWelcome()]);

    const sameSession = (payload: {
      session_id?: string;
      module?: string;
    }) => {
      if (!payload.session_id || payload.session_id !== sessionId) return false;
      if (payload.module && payload.module !== "monitoring") return false;
      return true;
    };

    const onReady = (payload: {
      session_id?: string;
      module?: string;
      messages?: Array<{ id?: string; role?: string; text?: string }>;
      state?: { focus_campaign_name?: string | null };
    }) => {
      if (!sameSession(payload)) return;
      const rows = (payload.messages || [])
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => ({
          id: m.id || crypto.randomUUID(),
          role: m.role as "user" | "assistant",
          text: m.text || "",
        }));
      if (rows.length) {
        setMessages(rows);
      } else {
        setMessages([monitorDetailWelcome(payload.state?.focus_campaign_name)]);
      }
    };

    const onAgentMessage = (payload: {
      session_id?: string;
      module?: string;
      text?: string;
    }) => {
      if (!sameSession(payload)) return;
      const text = payload.text || "";
      if (!text) return;
      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "assistant", text },
      ]);
      setSending(false);
      setTyping(false);
    };

    const onTyping = (payload: {
      session_id?: string;
      module?: string;
      typing?: boolean;
    }) => {
      if (!sameSession(payload)) return;
      setTyping(Boolean(payload.typing));
      if (!payload.typing) setSending(false);
    };

    const onStopped = (payload: {
      session_id?: string;
      module?: string;
    }) => {
      if (!sameSession(payload)) return;
      setTyping(false);
      setSending(false);
    };

    const onError = (payload: { message?: string }) => {
      setSocketError(payload.message || "Monitoring agent error");
      setSending(false);
      setTyping(false);
    };

    const onUi = (payload: {
      session_id?: string;
      module?: string;
      type?: string;
      payload?: { campaign?: CampaignDetail };
    }) => {
      if (!sameSession(payload)) return;
      if (payload.type === "campaign_report" && payload.payload?.campaign) {
        setCampaign(payload.payload.campaign);
      }
    };

    socket.on("session_ready", onReady);
    socket.on("agent_message", onAgentMessage);
    socket.on("agent_typing", onTyping);
    socket.on("generation_stopped", onStopped);
    socket.on("ui_event", onUi);
    socket.on("error", onError);

    const join = () => {
      socket.emit("join_session", {
        session_id: sessionId,
        token,
        module: "monitoring",
        focus_campaign_id: campaignId,
        campaign_profile: getCampaignProfile(),
      });
    };
    if (socket.connected) join();
    else socket.on("connect", join);

    return () => {
      socket.off("session_ready", onReady);
      socket.off("agent_message", onAgentMessage);
      socket.off("agent_typing", onTyping);
      socket.off("generation_stopped", onStopped);
      socket.off("ui_event", onUi);
      socket.off("error", onError);
      socket.off("connect", join);
    };
  }, [campaignId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length, sending, typing]);

  const isPast = useMemo(() => {
    if (!campaign) return true;
    if (campaign.status === "completed" || campaign.status === "cancelled") {
      return true;
    }
    if (campaign.endsAt && new Date(campaign.endsAt).getTime() < Date.now()) {
      return true;
    }
    return false;
  }, [campaign]);

  const canControl = useMemo(() => {
    if (!campaign || isPast) return false;
    return campaign.status === "live" || campaign.status === "scheduled";
  }, [campaign, isPast]);

  const listMetrics = useMemo(() => {
    if (!campaign) {
      return formatCampaignListMetrics({});
    }
    const sent =
      campaign.sent ??
      campaign.channels.reduce((n, c) => n + (c.sent || 0), 0);
    const email = campaign.channels.find(
      (c) => c.channel.toLowerCase() === "email",
    );
    const opens = campaign.channels.reduce((n, c) => {
      return isOpenTrackedChannel(c.channel) ? n + (c.opens || 0) : n;
    }, 0);
    const clicks = campaign.channels.reduce((n, c) => {
      return isClickTrackedChannel(c.channel) ? n + (c.clicks || 0) : n;
    }, 0);
    const impressions = campaign.channels.reduce(
      (n, c) => n + (c.impressions || 0),
      0,
    );
    const spend = campaign.channels.reduce((n, c) => n + (c.spend || 0), 0);
    const conversions = campaign.channels.reduce(
      (n, c) => n + (c.conversions || 0),
      0,
    );
    const hasPpc = campaign.channels.some(
      (c) => c.channel.toLowerCase() === "ppc",
    );
    const currency =
      campaign.channels.find((c) => c.currency)?.currency ?? null;
    const emailSent = campaign.emailSent ?? email?.sent ?? 0;
    const clickTrackedSent = campaign.channels.reduce((n, c) => {
      return isClickTrackedChannel(c.channel)
        ? n + (c.delivered ?? c.sent ?? 0)
        : n;
    }, 0);
    return formatCampaignListMetrics({
      hasPpc,
      spend,
      impressions,
      clicks,
      conversions,
      currency,
      sent,
      opens,
      channelMetrics: campaign.channels.map((c) => ({
        channel: c.channel,
        selected: c.selected,
        sent: c.sent,
        failed: c.failed,
        bounced: c.bounced,
        opens: c.opens,
        clicks: c.clicks,
      })),
      openRate:
        campaign.openRate ?? (emailSent > 0 ? opens / emailSent : null),
      clickRate:
        campaign.clickRate ??
        (clickTrackedSent > 0 ? clicks / clickTrackedSent : null),
    });
  }, [campaign]);

  const applyStop = async (channel: string) => {
    if (!campaignId || !reasonText.trim()) {
      setActionError("Enter a reason to stop this channel.");
      return;
    }
    setBusyChannel(channel);
    setActionError(null);
    try {
      const next = await setChannelRunState(campaignId, channel, {
        paused: true,
        reason: reasonText.trim(),
      });
      setCampaign(next);
      notifyCampaignChannelRunState({
        campaignId,
        campaignName: next.name || campaign?.name || "Campaign",
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

  const applyAbWinner = async (winner: "a" | "b" | null) => {
    if (!campaignId) return;
    setBusyAb(true);
    setActionError(null);
    try {
      const result = await pickEmailAbWinner(campaignId, {
        winner,
        force: true,
      });
      if (result.campaign) setCampaign(result.campaign);
      else await load();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "A/B winner failed");
    } finally {
      setBusyAb(false);
    }
  };

  const applyResume = async (channel: string) => {
    if (!campaignId) return;
    setBusyChannel(channel);
    setActionError(null);
    try {
      const next = await setChannelRunState(campaignId, channel, {
        paused: false,
      });
      setCampaign(next);
      notifyCampaignChannelRunState({
        campaignId,
        campaignName: next.name || campaign?.name || "Campaign",
        channel,
        paused: false,
      });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : "Resume failed");
    } finally {
      setBusyChannel(null);
    }
  };

  const onChatSend = () => {
    const text = input.trim();
    const token = getToken();
    if (!text || sending || typing || !token) return;
    setInput("");
    setSending(true);
    setTyping(true);
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "user", text },
    ]);
    getAgentsSocket().emit("user_message", {
      session_id: sessionIdRef.current,
      token,
      module: "monitoring",
      text,
    });
  };

  const stopGeneration = () => {
    getAgentsSocket().emit("stop_generation", {
      session_id: sessionIdRef.current,
    });
    setTyping(false);
    setSending(false);
  };

  const chatBusy = sending || typing;

  const whatsappLaunchMeta = useMemo(
    () => readWhatsAppLaunchMeta(campaign?.launchPlan ?? null),
    [campaign?.launchPlan],
  );
  const whatsappMetaLine = whatsappLaunchMeta
    ? formatWhatsAppMetaBadge(whatsappLaunchMeta)
    : null;

  if (loading) {
    return <CampaignMonitorDetailSkeleton />;
  }

  if (error || !campaign) {
    return (
      <div className="px-6 py-10">
        <p className="text-sm text-text-danger">{error || "Not found"}</p>
        <Button
          type="button"
          variant="secondary"
          className="mt-4"
          onClick={() => navigate(backHref)}
        >
          Back
        </Button>
      </div>
    );
  }

  const toolbar = (
    <>
      <header className="flex h-14 shrink-0 items-center justify-between gap-3 rounded-2xl border border-neutral-200 bg-white px-3 shadow-sm sm:px-4">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            to={backHref}
            className="inline-flex size-9 items-center justify-center rounded-lg text-icon-on-light hover:bg-state-hover"
            aria-label="Back"
          >
            <ArrowLeft className="size-5" strokeWidth={1.75} />
          </Link>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-text-primary">
              {campaign.name}
            </p>
            <p className="truncate text-xs capitalize text-text-caption">
              {campaign.status}
              {isPast ? " · past (cannot resume)" : ""}
              {campaign.channels.length
                ? ` · ${campaign.channels.map((c) => formatChannel(c.channel)).join(", ")}`
                : ""}
            </p>
          </div>
        </div>
      </header>

      {actionError ? (
        <p className="mt-2 rounded-xl border border-border-default bg-red-50 px-4 py-2 text-sm text-red-700">
          {actionError}
        </p>
      ) : null}
      {socketError ? (
        <p className="mt-2 rounded-xl border border-border-default bg-red-50 px-4 py-2 text-sm text-red-700">
          {socketError}
        </p>
      ) : null}
      {whatsappMetaLine ? (
        <p className="mt-2 rounded-xl border border-border-default bg-emerald-50 px-4 py-2 text-sm text-emerald-900">
          {whatsappMetaLine}
        </p>
      ) : null}
    </>
  );

  const leftPane = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="chat-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6">
        <div className="mx-auto max-w-3xl space-y-3">
          {campaign.channels.map((ch) => {
            const Icon = channelIcon(ch.channel);
            const showReasonForm = reasonFor === ch.channel;
            const isPpc = ch.channel.toLowerCase() === "ppc";
            return (
              <div
                key={ch.id}
                className="rounded-xl border border-border-default bg-surface p-4"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <span className="inline-flex size-10 items-center justify-center rounded-lg bg-neutral-900 text-white">
                    <Icon className="size-5" strokeWidth={1.75} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-text-primary">
                      {formatChannel(ch.channel)}
                      {isPpc && ch.network
                        ? ` · ${ch.network === "google" ? "Google" : "Meta"}`
                        : ""}
                    </p>
                    <p className="mt-0.5 text-xs text-text-caption">
                      {isPpc ? (
                        <>
                          {(ch.impressions ?? 0).toLocaleString()} impr ·{" "}
                          {ch.clicks ?? 0} clicks
                          {ch.ctr != null
                            ? ` (${(ch.ctr * 100).toFixed(2)}% CTR)`
                            : ""}
                          {" · "}
                          {formatMoney(ch.spend || 0, ch.currency)} spend
                          {ch.cpc != null
                            ? ` · ${formatMoney(ch.cpc, ch.currency)} CPC`
                            : ""}
                          {(ch.conversions ?? 0) > 0
                            ? ` · ${ch.conversions} conv`
                            : ""}
                          {ch.cpa != null
                            ? ` · ${formatMoney(ch.cpa, ch.currency)} CPA`
                            : ""}
                          {ch.dailyBudget != null
                            ? ` · budget ${formatMoney(ch.dailyBudget, ch.currency)}/day`
                            : ""}
                          {ch.paused ? " · Paused" : ""}
                        </>
                      ) : (
                        formatMonitorChannelMetricsLine({
                          channel: ch.channel,
                          selected: ch.selected,
                          totalToSend: ch.totalToSend,
                          sent: ch.sent,
                          failed: ch.failed,
                          bounced: ch.bounced,
                          opens: ch.opens,
                          clicks: ch.clicks,
                          openRate: ch.openRate,
                          clickRate: ch.clickRate,
                          stubSent: ch.stubSent,
                          fromLiveSends: ch.fromLiveSends,
                          paused: ch.paused,
                          status: campaign?.status,
                        })
                      )}
                    </p>
                  </div>
                  {canControl ? (
                    ch.paused ? (
                      <Button
                        type="button"
                        variant="secondary"
                        className="h-9 px-3"
                        disabled={busyChannel === ch.channel}
                        onClick={() => void applyResume(ch.channel)}
                      >
                        {busyChannel === ch.channel ? (
                          <Loader2 className="size-4 animate-spin" />
                        ) : (
                          <Play className="size-4" strokeWidth={1.75} />
                        )}
                        Resume
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        variant="secondary"
                        className="h-9 px-3"
                        disabled={busyChannel === ch.channel}
                        onClick={() => {
                          setReasonFor(ch.channel);
                          setReasonText("");
                          setActionError(null);
                        }}
                      >
                        <Pause className="size-4" strokeWidth={1.75} />
                        Stop
                      </Button>
                    )
                  ) : (
                    <span className="text-xs text-text-caption">
                      {isPast ? "Ended" : "—"}
                    </span>
                  )}
                </div>

                <p className="mt-3 text-sm text-text-secondary">
                  {ch.howItWorks?.trim() ||
                    campaign.goal ||
                    campaign.objective ||
                    "No channel description yet."}
                </p>
                {isPpc && ch.planSummary ? (
                  <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    Plan: {ch.planSummary}
                    <span className="text-amber-800/70"> · synthetic outcomes</span>
                  </p>
                ) : null}
                {ch.pauseReason ? (
                  <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                    Stop reason: {ch.pauseReason}
                  </p>
                ) : null}

                {showReasonForm ? (
                  <div className="mt-3 space-y-2 rounded-lg border border-border-default bg-subtle p-3">
                    <p className="text-xs font-medium text-text-primary">
                      Reason to stop {formatChannel(ch.channel)}
                    </p>
                    <textarea
                      value={reasonText}
                      onChange={(e) => setReasonText(e.target.value)}
                      rows={2}
                      placeholder="Why are you stopping this channel?"
                      className="w-full resize-none rounded-lg border border-border-default bg-surface px-3 py-2 text-sm outline-none focus:border-border-strong"
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        className="h-8 px-3"
                        onClick={() => setReasonFor(null)}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        variant="brand"
                        className="h-8 px-3"
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
            );
          })}

          {campaign.channels.length === 0 ? (
            <p className="text-sm text-text-caption">
              No channels on this campaign.
            </p>
          ) : null}

          {campaign.emailAb?.enabled ? (
            <div className="rounded-xl border border-border-default bg-surface p-4">
              <p className="text-sm font-semibold text-text-primary">
                Email A/B
              </p>
              <p className="mt-0.5 text-xs text-text-caption">
                {campaign.emailAb.pctA}% A · {campaign.emailAb.pctB}% B ·{" "}
                {campaign.emailAb.pctHoldout}% holdout
                {campaign.emailAb.winner
                  ? ` · winner ${campaign.emailAb.winner.toUpperCase()}`
                  : campaign.emailAb.auto
                    ? ` · auto winner after ${campaign.emailAb.decideAfterMinutes} min`
                    : ""}
                {campaign.emailAb.remainderReleased ? " · remainder sent" : ""}
              </p>
              {(() => {
                const a = campaign.emailAb.variants.find((v) => v.variant === "a");
                const b = campaign.emailAb.variants.find((v) => v.variant === "b");
                const barData = [
                  {
                    name: "A",
                    openPct: a?.openRate != null ? Math.round(a.openRate * 1000) / 10 : 0,
                    clickPct: a?.clickRate != null ? Math.round(a.clickRate * 1000) / 10 : 0,
                    sent: a?.sent ?? 0,
                  },
                  {
                    name: "B",
                    openPct: b?.openRate != null ? Math.round(b.openRate * 1000) / 10 : 0,
                    clickPct: b?.clickRate != null ? Math.round(b.clickRate * 1000) / 10 : 0,
                    sent: b?.sent ?? 0,
                  },
                ];
                return (
                  <div className="mt-3 h-40">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={barData} barGap={6}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="name" tickLine={false} />
                        <YAxis
                          tickLine={false}
                          width={32}
                          unit="%"
                          domain={[0, 100]}
                        />
                        <Tooltip
                          formatter={(value, key) => [
                            `${value}%`,
                            key === "openPct" ? "Open rate" : "Click rate",
                          ]}
                        />
                        <Bar dataKey="openPct" name="Open rate" fill="#2563eb" radius={4} />
                        <Bar dataKey="clickPct" name="Click rate" fill="#7c3aed" radius={4} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                );
              })()}
              <div className="mt-3 grid gap-2 sm:grid-cols-3">
                {campaign.emailAb.variants.map((v) => (
                  <div
                    key={v.variant}
                    className="rounded-lg border border-border-default bg-subtle px-3 py-2"
                  >
                    <p className="text-xs font-semibold uppercase text-text-caption">
                      Variant {v.variant.toUpperCase()}
                    </p>
                    <p className="mt-1 text-sm text-text-primary">
                      Sent {v.sent} · Opens {v.opens}
                      {v.openRate != null
                        ? ` (${(v.openRate * 100).toFixed(1)}%)`
                        : ""}
                    </p>
                    <p className="text-xs text-text-caption">
                      Clicks {v.clicks}
                      {v.clickRate != null
                        ? ` (${(v.clickRate * 100).toFixed(1)}%)`
                        : ""}
                    </p>
                  </div>
                ))}
                <div className="rounded-lg border border-border-default bg-subtle px-3 py-2">
                  <p className="text-xs font-semibold uppercase text-text-caption">
                    Holdout
                  </p>
                  <p className="mt-1 text-sm text-text-primary">
                    Held {campaign.emailAb.holdout.held} · Sent{" "}
                    {campaign.emailAb.holdout.sent}
                  </p>
                </div>
              </div>
              {canControl && !campaign.emailAb.remainderReleased ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-8 px-3"
                    disabled={busyAb}
                    onClick={() => void applyAbWinner("a")}
                  >
                    Use A
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    className="h-8 px-3"
                    disabled={busyAb}
                    onClick={() => void applyAbWinner("b")}
                  >
                    Use B
                  </Button>
                  <Button
                    type="button"
                    variant="brand"
                    className="h-8 px-3"
                    disabled={busyAb}
                    onClick={() => void applyAbWinner(null)}
                  >
                    {busyAb ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : null}
                    Auto-pick & send remainder
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="mt-6 space-y-3 border-t border-border-default pt-4">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div className={chatBubbleClass(m.role)}>
                  {m.text}
                </div>
              </div>
            ))}
            {chatBusy ? <AgentThinkingIndicator /> : null}
            <div ref={bottomRef} />
          </div>
        </div>
      </div>

      <AgentChatComposer
        value={input}
        onChange={setInput}
        onSend={onChatSend}
        busy={chatBusy}
        onStop={stopGeneration}
        inputRef={inputRef}
        placeholder="Ask for a report or channel status…"
        className="w-full"
        maxWidthClass=""
      />
    </div>
  );

  const overviewPane = (
    <div className="chat-scroll-xs h-full min-h-0 flex-1 overflow-y-auto p-4 text-sm">
      <dl className="space-y-3 text-xs">
        {(
          [
            ["Name", campaign.name],
            [
              campaign.status === "scheduled"
                ? "Scheduled date"
                : "Launched date",
              campaign.startsAt
                ? new Date(campaign.startsAt).toLocaleString()
                : "—",
            ],
            ["Status", campaign.status],
            ["Activity", listMetrics.activity],
            ["Engagement", listMetrics.engagement],
            ["Efficiency", listMetrics.efficiency],
            ["Source", campaign.sourceChannel],
            ["Goal", campaign.goal],
            ["Objective", campaign.objective],
            [
              "Audience",
              recipients
                ? `${recipients.totals.selected} selected · ${recipients.totals.sent} sent · ${recipients.totals.stub} stub · ${recipients.totals.failed + recipients.totals.skipped + recipients.totals.not_sent + recipients.totals.pending} missed`
                : `${campaign.audienceCount} contacts`,
            ],
            [
              "Channels",
              campaign.channels.map((c) => formatChannel(c.channel)).join(", ") ||
                "—",
            ],
          ] as const
        ).map(([label, value]) => (
          <div key={label}>
            <dt className="text-text-caption">{label}</dt>
            <dd className="mt-0.5 font-medium text-text-primary">
              {(value || "—").toString().trim() || "—"}
            </dd>
          </div>
        ))}
      </dl>

      {recipients?.recipients?.length ? (
        <div className="mt-6 border-t border-border-default pt-4">
          <p className="text-xs font-semibold tracking-wide text-text-caption uppercase">
            Audience contacts
          </p>
          {(campaign.stubSent || recipients.totals.stub) > 0 ? (
            <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-950">
              Stub send is not inbox delivery. Contacts marked stub did not
              receive the live ESP email.
            </p>
          ) : null}
          {campaign.audienceSummary ? (
            <p className="mt-2 text-xs text-text-caption">
              {campaign.audienceSummary}
            </p>
          ) : null}
          <ul className="mt-3 max-h-64 space-y-2 overflow-y-auto text-xs">
            {recipients.recipients.map((r) => (
              <li
                key={`${r.contact_id || r.email || r.name}`}
                className="rounded-lg border border-border-default bg-subtle/60 px-3 py-2"
              >
                <p className="font-medium text-text-primary">
                  {r.name}
                  {r.email ? (
                    <span className="ml-1 font-normal text-text-caption">
                      · {r.email}
                    </span>
                  ) : null}
                </p>
                <p className="mt-0.5 text-text-caption">
                  {r.outcome === "stub"
                    ? "Stub — not delivered"
                    : r.outcome === "sent"
                      ? "Sent"
                      : r.outcome === "failed"
                        ? `Failed${r.channels[0]?.skip_fail_reason ? ` · ${r.channels[0].skip_fail_reason}` : ""}`
                        : r.outcome === "skipped"
                          ? "Skipped"
                          : r.outcome === "pending"
                            ? "Pending"
                            : "Missed / not run"}
                  {r.channels[0]?.opened ? " · opened" : ""}
                  {r.channels[0]?.clicked ? " · clicked" : ""}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {campaign ? (
        <CampaignPerformanceCharts channels={campaign.channels} campaign={campaign} />
      ) : null}
    </div>
  );

  return (
    <ContentFadeIn className="flex h-full min-h-0 flex-col overflow-hidden">
      <ModuleSplitWorkspace
        toolbar={toolbar}
        leftTitle="Monitoring"
        rightTitle="Campaign overview"
        left={leftPane}
        right={overviewPane}
      />
    </ContentFadeIn>
  );
}
