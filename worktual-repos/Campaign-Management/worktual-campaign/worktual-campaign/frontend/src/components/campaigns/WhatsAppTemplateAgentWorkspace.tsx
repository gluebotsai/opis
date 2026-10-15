/**
 * Dedicated WhatsApp approved / rejected template agent workspace
 * (not create-campaign). Chat left · template + campaign fields right.
 * Named export is required by AppRouter.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, Plus } from "lucide-react";
import { parseContactsCsv } from "@/lib/parse-contacts-csv";
import { AgentChatComposer } from "@/components/chat/AgentChatComposer";
import { AgentThinkingIndicator } from "@/components/chat/AgentThinkingIndicator";
import { ChatBubbleText } from "@/components/chat/ChatBubbleText";
import { CampaignGuidedPreview } from "@/components/campaigns/CampaignGuidedPreview";
import { ChannelTemplatePreview } from "@/components/campaigns/ChannelTemplatePreview";
import { ModuleSplitWorkspace } from "@/components/layout/ModuleSplitWorkspace";
import {
  inferNextKeyFromAssistantQuestion,
  snapshotFromCampaignState,
} from "@/lib/campaign-guided-fields";
import { chatBubbleClass } from "@/lib/chat-bubbles";
import { looksLikeChatHtml } from "@/lib/chat-html";
import { sanitizeAssistantChatText } from "@/lib/chat-user-facing";
import { getCampaignProfile } from "@/lib/industry-packs";
import { getToken } from "@/services/api";
import { getAgentsSocket } from "@/services/agents.socket";
import {
  createRegulatedTemplateApi,
  fetchRegulatedTemplates,
  submitWhatsAppApprovalApi,
  type RegulatedTemplateDto,
} from "@/services/regulatedTemplates.api";
import type { CampaignDraftStatus } from "@/lib/campaign-drafts";
import { syncApprovedWhatsAppMirrorDraft } from "@/lib/whatsapp-approved-draft-bridge";
import type { CampaignAgentState } from "@/services/agents.socket";

type Mode = "approved" | "rejected";

type ChatMsg = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
};

function WaMessageBubble({ msg }: { msg: ChatMsg }) {
  const displayText =
    msg.role === "assistant"
      ? sanitizeAssistantChatText(msg.text)
      : msg.text;
  if (!displayText?.trim()) return null;
  const html = msg.role === "assistant" && looksLikeChatHtml(displayText);
  return (
    <div
      className={
        msg.role === "user" ? "flex justify-end" : "flex justify-start"
      }
    >
      <div className={chatBubbleClass(msg.role, undefined, { html })}>
        <ChatBubbleText text={displayText} role={msg.role} />
      </div>
    </div>
  );
}

function buttonsToPreview(raw: string): Array<{ label: string }> {
  return String(raw || "")
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((label) => ({ label }));
}

function snapshotFromRow(row: RegulatedTemplateDto) {
  return {
    id: row.id,
    name: row.name,
    header: row.header,
    body: row.body,
    footer: row.footer,
    buttons: row.buttons,
    language: row.language,
    category: row.category,
    status: row.status,
    rejected_reason: row.rejectedReason,
    provider_template_id: row.providerTemplateId || row.externalId || "",
    campaign_name: row.campaignName || "",
    goal: row.goal || "",
    objective: row.objective || "",
    source_campaign_id: row.sourceCampaignId,
  };
}

export function WhatsAppTemplateAgentWorkspace({ mode }: { mode: Mode }) {
  const { templateId = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const seeded = (location.state as { template?: RegulatedTemplateDto } | null)
    ?.template;

  const [template, setTemplate] = useState<RegulatedTemplateDto | null>(
    seeded || null,
  );
  const [loading, setLoading] = useState(!seeded);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [mirrorStatus, setMirrorStatus] = useState<CampaignDraftStatus | undefined>();
  const [mirrorLaunchedAs, setMirrorLaunchedAs] = useState<
    "scheduled" | "live" | undefined
  >();
  const [linkedCampaignId, setLinkedCampaignId] = useState<string | null>(null);
  const [overviewState, setOverviewState] =
    useState<CampaignAgentState | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const csvInputRef = useRef<HTMLInputElement>(null);
  const messagesRef = useRef<ChatMsg[]>([]);

  const module = mode === "approved" ? "whatsapp_approved" : "whatsapp_rejected";
  const sessionId =
    mode === "approved"
      ? `wa-approved-${templateId}`
      : `wa-rejected-${templateId}`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (seeded) {
        setTemplate(seeded);
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const list = await fetchRegulatedTemplates({ channel: "whatsapp" });
        const row = list.find((r) => r.id === templateId) || null;
        if (!cancelled) setTemplate(row);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load template");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [templateId, seeded]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, busy]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    if (mode !== "approved" || !template) return;
    const timer = window.setTimeout(() => {
      void syncApprovedWhatsAppMirrorDraft({
        template,
        messages: messagesRef.current,
        status: mirrorStatus,
        launchedAs: mirrorLaunchedAs,
        linkedCampaignId,
      }).catch(() => {
        /* offline — local cache only */
      });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [
    mode,
    template,
    messages,
    mirrorStatus,
    mirrorLaunchedAs,
    linkedCampaignId,
  ]);

  useEffect(() => {
    if (!template) return;
    const token = getToken();
    if (!token) {
      setError("Sign in required");
      return;
    }
    const socket = getAgentsSocket();
    setMessages([]);
    setBusy(true);

    const onReady = (payload: {
      messages?: Array<{ role?: string; text?: string; content?: string }>;
      state?: CampaignAgentState;
    }) => {
      const rows = (payload.messages || [])
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m, i) => ({
          id: `m-${i}`,
          role: m.role as "user" | "assistant",
          text: String(m.text || m.content || ""),
          createdAt: new Date().toISOString(),
        }));
      if (rows.length) setMessages(rows);
      if (payload.state && typeof payload.state === "object") {
        setOverviewState(payload.state);
      }
      setBusy(false);
    };
    const onAgent = (payload: { text?: string; role?: string }) => {
      const text = String(payload.text || "").trim();
      if (!text) return;
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          role: (payload.role as "assistant") || "assistant",
          text,
          createdAt: new Date().toISOString(),
        },
      ]);
      setBusy(false);
    };
    const onTyping = (payload: { typing?: boolean }) => {
      setBusy(Boolean(payload.typing));
    };
    const onUi = async (payload: {
      type?: string;
      payload?: {
        template?: Record<string, unknown>;
        source_template_id?: string;
        sent?: boolean;
        recipient_count?: number;
        failed_count?: number;
        providerMessageId?: string | null;
        phone_count?: number;
        contact_id_count?: number;
        error?: string;
      };
    }) => {
      const type = payload.type;
      if (type === "whatsapp_audience_updated" && mode === "approved") {
        const phones = payload.payload?.phone_count ?? 0;
        const contacts = payload.payload?.contact_id_count ?? 0;
        setNote(
          contacts
            ? `Audience: ${contacts} contact(s)${phones ? `, ${phones} phone(s)` : ""}.`
            : `Audience: ${phones} phone number(s).`,
        );
      }
      if (type === "whatsapp_approved_launched" && mode === "approved") {
        const cid = payload.payload?.campaign_id;
        const scheduleMode = String(
          (payload.payload as { schedule_mode?: string } | undefined)
            ?.schedule_mode || "now",
        ).toLowerCase();
        setError(null);
        setLinkedCampaignId(cid ? String(cid) : null);
        setMirrorLaunchedAs(
          scheduleMode === "scheduled" ? "scheduled" : "live",
        );
        setMirrorStatus(scheduleMode === "scheduled" ? "scheduled" : "live");
        setNote(
          cid
            ? `Campaign launched (id ${cid}). WhatsApp sends follow your schedule.`
            : "Campaign launched. WhatsApp sends follow your schedule.",
        );
      }
      if (type === "whatsapp_approved_sent" && mode === "approved") {
        const n = payload.payload?.recipient_count ?? 0;
        const failed = payload.payload?.failed_count ?? 0;
        const mid = payload.payload?.providerMessageId;
        const errMsg = String(payload.payload?.error || "").trim();
        if (payload.payload?.sent) {
          setError(null);
          setMirrorStatus("live");
          setMirrorLaunchedAs("live");
          setNote(
            failed
              ? `Sent with ${failed} failure(s) across ${n} recipient(s).`
              : `Sent to ${n} recipient(s)${mid ? ` (id: ${mid})` : ""}.`,
          );
        } else {
          setError(
            errMsg ||
              "Send failed for one or more recipients. Check chat for details.",
          );
        }
      }
      if (type === "whatsapp_template_updated" && payload.payload?.template) {
        const t = payload.payload.template;
        setTemplate((prev) =>
          prev
            ? {
                ...prev,
                name: String(t.name ?? prev.name),
                header: String(t.header ?? prev.header),
                body: String(t.body ?? prev.body),
                footer: String(t.footer ?? prev.footer),
                buttons: String(t.buttons ?? prev.buttons),
              }
            : prev,
        );
      }
      if (type === "whatsapp_template_submit" && mode === "rejected") {
        const t = payload.payload?.template || {};
        try {
          setBusy(true);
          const name = String(t.name || template.name).trim();
          const created = await createRegulatedTemplateApi({
            channel: "whatsapp",
            name,
            language: template.language || "en",
            category: template.category || "MARKETING",
            header: String(t.header ?? template.header),
            body: String(t.body ?? template.body),
            footer: String(t.footer ?? template.footer),
            buttons: String(t.buttons ?? template.buttons),
          });
          const submitted = await submitWhatsAppApprovalApi(created.id);
          setNote(
            `Submitted “${submitted.template.name}” for Meta approval (status: ${submitted.template.status}).`,
          );
          setTemplate(submitted.template);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Submit failed");
        } finally {
          setBusy(false);
        }
      }
    };
    const onErr = (payload: { message?: string }) => {
      setError(payload.message || "Agent error");
      setBusy(false);
    };
    const onState = (payload: {
      session_id?: string;
      state?: CampaignAgentState;
    }) => {
      if (payload.session_id && payload.session_id !== sessionId) return;
      if (!payload.state || typeof payload.state !== "object") return;
      setOverviewState(payload.state);
      const camp = payload.state.campaign;
      if (!camp || typeof camp !== "object") return;
      setTemplate((prev) => {
        if (!prev) return prev;
        const name = String(camp.name || "").trim();
        const goal = String(camp.goal || "").trim();
        const objective = String(camp.objective || "").trim();
        return {
          ...prev,
          ...(name ? { campaignName: name } : {}),
          ...(goal ? { goal } : {}),
          ...(objective ? { objective } : {}),
        };
      });
      if (payload.state.launch_confirmed && payload.state.campaign_id) {
        setLinkedCampaignId(String(payload.state.campaign_id));
      }
    };

    socket.on("session_ready", onReady);
    socket.on("agent_message", onAgent);
    socket.on("agent_typing", onTyping);
    socket.on("ui_event", onUi);
    socket.on("state_update", onState);
    socket.on("error", onErr);

    const join = () => {
      socket.emit("join_session", {
        session_id: sessionId,
        token,
        module,
        whatsapp_template_snapshot: snapshotFromRow(template),
        campaign_profile: getCampaignProfile(),
      });
    };
    if (socket.connected) join();
    else socket.on("connect", join);

    return () => {
      socket.off("session_ready", onReady);
      socket.off("agent_message", onAgent);
      socket.off("agent_typing", onTyping);
      socket.off("ui_event", onUi);
      socket.off("state_update", onState);
      socket.off("error", onErr);
      socket.off("connect", join);
    };
  }, [template?.id, mode, module, sessionId]);

  const emitUserMessage = (text: string, extra?: Record<string, unknown>) => {
    const token = getToken();
    if (!token || !template) return;
    const now = new Date().toISOString();
    setMessages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), role: "user", text, createdAt: now },
    ]);
    setBusy(true);
    getAgentsSocket().emit("user_message", {
      session_id: sessionId,
      token,
      module,
      text,
      whatsapp_template_snapshot: snapshotFromRow(template),
      ...extra,
    });
  };

  const send = () => {
    const text = input.trim();
    if (!text || !template || busy) return;
    setInput("");
    emitUserMessage(text);
  };

  const onCsvSelected = (file: File) => {
    if (mode !== "approved" || busy) return;
    const lower = file.name.toLowerCase();
    if (
      !lower.endsWith(".csv") &&
      file.type !== "text/csv" &&
      file.type !== "application/vnd.ms-excel"
    ) {
      setError("Upload a CSV (.csv) for temporary contacts.");
      return;
    }
    void file.text().then((text) => {
      const rows = parseContactsCsv(text);
      if (!rows.length) {
        setError("No contact rows found. Use headers like firstName, email, phone.");
        return;
      }
      if (rows.length > 2000) {
        setError("Temporary upload is limited to 2000 rows.");
        return;
      }
      const msg = `Uploaded temporary contact sheet “${file.name}” (${rows.length} rows) for this approved template run.`;
      emitUserMessage(msg, { temporary_contact_rows: rows });
      setNote(`Uploading ${rows.length} temporary contacts…`);
    });
  };

  const campaignName = useMemo(
    () =>
      overviewState?.campaign?.name?.trim() ||
      template?.campaignName ||
      template?.name ||
      "—",
    [template, overviewState],
  );

  const approvedGuidedSnap = useMemo(() => {
    if (mode !== "approved" || !template) return null;
    const base = snapshotFromCampaignState({
      agentState: overviewState,
      draftName: template.campaignName || "",
      draftGoal: template.goal,
      draftObjective: template.objective,
      templateCount: 1,
      selectedChannelLabels: ["WhatsApp"],
    });
    const tplName = String(template.name || "").trim();
    return tplName ? { ...base, templatesLabel: tplName } : base;
  }, [mode, overviewState, template]);

  const approvedNextQuestion = useMemo(() => {
    if (mode !== "approved") return null;
    const lastAssistant = [...messages]
      .reverse()
      .find((m) => m.role === "assistant" && m.text.trim());
    if (!lastAssistant?.text.includes("?")) return null;
    return lastAssistant.text;
  }, [mode, messages]);

  const approvedNextKeyOverride = useMemo(
    () =>
      approvedNextQuestion
        ? inferNextKeyFromAssistantQuestion(approvedNextQuestion)
        : null,
    [approvedNextQuestion],
  );

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-text-caption">
        <Loader2 className="size-4 animate-spin" /> Loading template…
      </div>
    );
  }

  if (!template) {
    return (
      <div className="p-6 text-sm text-text-caption">
        Template not found.{" "}
        <Link to="/campaigns/create/whatsapp" className="underline">
          Back to WhatsApp approvals
        </Link>
      </div>
    );
  }

  const left = (
    <div className="chat-scroll min-h-0 flex-1 overflow-y-auto px-4 py-4">
      <div className="flex flex-col gap-3">
          {messages.map((m) => (
            <WaMessageBubble key={m.id} msg={m} />
          ))}
          {busy ? <AgentThinkingIndicator /> : null}
          <div ref={bottomRef} />
      </div>
    </div>
  );

  const leftFooter = (
    <>
      {mode === "approved" ? (
        <input
          ref={csvInputRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) onCsvSelected(f);
          }}
        />
      ) : null}
      <AgentChatComposer
        value={input}
        onChange={setInput}
        onSend={send}
        busy={busy}
        placeholder={
          mode === "approved"
            ? "Audience, timing, or confirm…"
            : "Describe changes to the template…"
        }
        className="w-full"
        maxWidthClass=""
        leading={
          mode === "approved" ? (
            <button
              type="button"
              title="Upload temporary contact CSV"
              onClick={() => csvInputRef.current?.click()}
              disabled={busy}
              className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-neutral-600 hover:bg-neutral-100 disabled:opacity-40"
            >
              <Plus className="size-5" strokeWidth={1.75} />
            </button>
          ) : undefined
        }
      />
    </>
  );

  const right =
    mode === "approved" && approvedGuidedSnap ? (
      <div className="flex h-full min-h-0 flex-col">
        {error ? (
          <p className="mx-4 mt-4 shrink-0 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}
        {note ? (
          <p className="mx-4 mt-4 shrink-0 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {note}
          </p>
        ) : null}
        <div className="min-h-0 flex-1 p-4">
          <CampaignGuidedPreview
            snap={approvedGuidedSnap}
            nextQuestion={approvedNextQuestion}
            nextKeyOverride={approvedNextKeyOverride}
            hiddenKeys={["goal", "objective", "channels", "other"]}
            channelReadyById={{ whatsapp: true }}
            extras={
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">
                  Template preview
                </p>
                <ChannelTemplatePreview
                  channel="whatsapp"
                  fields={{
                    header: template.header,
                    body: template.body,
                    footer: template.footer,
                    buttons: buttonsToPreview(template.buttons),
                  }}
                />
              </div>
            }
          />
        </div>
      </div>
    ) : (
      <div className="space-y-4 p-4 text-sm">
        {error ? (
          <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}
        {note ? (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            {note}
          </p>
        ) : null}
        <dl className="space-y-3 text-xs">
          <div>
            <dt className="text-text-caption">Name</dt>
            <dd className="mt-0.5 font-medium text-text-primary">{campaignName}</dd>
          </div>
          <div>
            <dt className="text-text-caption">Goal</dt>
            <dd className="mt-0.5 font-medium text-text-primary">
              {overviewState?.campaign?.goal?.trim() || template.goal || "—"}
            </dd>
          </div>
          <div>
            <dt className="text-text-caption">Objective</dt>
            <dd className="mt-0.5 font-medium text-text-primary">
              {overviewState?.campaign?.objective?.trim() ||
                template.objective ||
                "—"}
            </dd>
          </div>
          <div>
            <dt className="text-text-caption">Template</dt>
            <dd className="mt-0.5 font-medium text-text-primary">{template.name}</dd>
          </div>
          <div>
            <dt className="mb-2 text-text-caption">Preview</dt>
            <dd>
              <ChannelTemplatePreview
                channel="whatsapp"
                fields={{
                  header: template.header,
                  body: template.body,
                  footer: template.footer,
                  buttons: buttonsToPreview(template.buttons),
                }}
              />
            </dd>
          </div>
        </dl>
      </div>
    );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-3 border-b border-border-default px-4 py-3">
        <button
          type="button"
          onClick={() => navigate("/campaigns/create/whatsapp")}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-text-caption hover:text-text-primary"
        >
          <ArrowLeft className="size-3.5" strokeWidth={1.75} />
          WhatsApp approvals
        </button>
        <p className="text-sm font-semibold text-text-primary">
          {mode === "approved"
            ? "Approved WhatsApp template"
            : "Fix rejected WhatsApp template"}
        </p>
      </div>
      <ModuleSplitWorkspace
        leftTitle={mode === "approved" ? "Run template" : "Modify template"}
        rightTitle={mode === "approved" ? "Campaign overview" : "Overview"}
        left={left}
        leftFooter={leftFooter}
        right={right}
      />
    </div>
  );
}
