import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import axios from "axios";
import { Plus, RefreshCw, Send, Upload } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { ConfirmDeleteButton } from "@/components/ui/ConfirmDeleteButton";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import { Select } from "@/components/ui/Select";
import { AgentChatComposer } from "@/components/chat/AgentChatComposer";
import { ChannelTemplatePreview } from "@/components/campaigns/ChannelTemplatePreview";
import { Skeleton } from "@/components/skeleton/Skeleton";
import { SkeletonCard } from "@/components/skeleton/SkeletonCard";
import { SkeletonGrid } from "@/components/skeleton/SkeletonGrid";
import {
  createRegulatedTemplateApi,
  deleteRegulatedTemplateApi,
  fetchRegulatedTemplates,
  fetchSmsConfigReady,
  fetchWhatsAppConfigReady,
  refreshWhatsAppStatusApi,
  sendRegulatedTemplateApi,
  setRegulatedStatusApi,
  submitWhatsAppApprovalApi,
  syncMetaWhatsAppTemplatesApi,
  updateRegulatedTemplateApi,
  type RegulatedApprovalStatus,
  type RegulatedChannel,
  type RegulatedTemplateDto,
} from "@/services/regulatedTemplates.api";

type StatusFilter = "all" | RegulatedApprovalStatus;
type FormMode = "closed" | "create" | "upload_approved" | "view" | "run";
type ChatMsg = { id: string; role: "user" | "assistant"; text: string };

function buttonsToPreview(raw: string): Array<{ label: string }> {
  return String(raw || "")
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((label) => ({ label }));
}

function extractPhoneDigits(text: string): string | null {
  const digits = text.replace(/\D/g, "");
  if (/^\d{8,15}$/.test(digits)) return digits;
  return null;
}

function isAffirmative(text: string): boolean {
  return /^(yes|y|ok|okay|confirm|send|run|go)\b/i.test(text.trim());
}

function isNegative(text: string): boolean {
  return /^(no|n|cancel|stop|abort)\b/i.test(text.trim());
}

const STATUS_LABEL: Record<RegulatedApprovalStatus, string> = {
  draft: "Draft",
  pending: "Pending",
  approved: "Approved",
  rejected: "Rejected",
  paused: "Paused",
  disabled: "Disabled",
};

const STATUS_BADGE: Record<RegulatedApprovalStatus, string> = {
  draft: "bg-neutral-100 text-neutral-700",
  pending: "bg-amber-100 text-amber-900",
  approved: "bg-emerald-100 text-emerald-800",
  rejected: "bg-red-100 text-red-800",
  paused: "bg-orange-100 text-orange-900",
  disabled: "bg-neutral-200 text-neutral-700",
};

type FormState = {
  name: string;
  externalId: string;
  language: string;
  category: string;
  header: string;
  body: string;
  footer: string;
  buttons: string;
};

const EMPTY_FORM: FormState = {
  name: "",
  externalId: "",
  language: "en",
  category: "MARKETING",
  header: "",
  body: "",
  footer: "",
  buttons: "",
};

function toForm(row: RegulatedTemplateDto): FormState {
  return {
    name: row.name,
    externalId: row.externalId,
    language: row.language,
    category: row.category || "MARKETING",
    header: row.header,
    body: row.body,
    footer: row.footer,
    buttons: row.buttons,
  };
}

function apiErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { message?: string } | undefined;
    return data?.message || err.message || "Request failed";
  }
  return err instanceof Error ? err.message : "Request failed";
}

export function RegulatedTemplateApprovalsPanel({
  channel,
}: {
  channel: RegulatedChannel;
}) {
  const navigate = useNavigate();
  const [rows, setRows] = useState<RegulatedTemplateDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [mode, setMode] = useState<FormMode>("closed");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [channelReady, setChannelReady] = useState<{
    ready: boolean;
    message: string;
  } | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [chatMsgs, setChatMsgs] = useState<ChatMsg[]>([]);
  const [pendingPhone, setPendingPhone] = useState<string | null>(null);
  const [useConfirmRow, setUseConfirmRow] =
    useState<RegulatedTemplateDto | null>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let list: RegulatedTemplateDto[] = [];
      if (channel === "whatsapp") {
        // Sync Meta catalog (names + components) into Pending / Approved / Rejected.
        try {
          const synced = await syncMetaWhatsAppTemplatesApi();
          list = synced.templates || [];
        } catch (syncErr) {
          list = await fetchRegulatedTemplates({ channel });
          // Surface sync failure — otherwise an empty DB looks like "no templates exist".
          setError(
            `Could not sync from Meta via social-service: ${apiErrorMessage(syncErr)}. Showing saved templates only (${list.length}).`,
          );
        }
        const pending = list.filter((r) => r.status === "pending");
        if (pending.length) {
          await Promise.allSettled(
            pending.map((row) => refreshWhatsAppStatusApi(row.id)),
          );
          list = await fetchRegulatedTemplates({ channel });
        }
        setChannelReady(await fetchWhatsAppConfigReady());
      } else if (channel === "sms") {
        list = await fetchRegulatedTemplates({ channel });
        setChannelReady(await fetchSmsConfigReady());
      } else {
        list = await fetchRegulatedTemplates({ channel });
        setChannelReady(null);
      }
      setRows(list);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [channel]);

  useEffect(() => {
    void load();
    setMode("closed");
    setActiveId(null);
    setForm(EMPTY_FORM);
    setChatMsgs([]);
    setChatInput("");
    setPendingPhone(null);
  }, [load]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMsgs]);

  const statusCounts = useMemo(() => {
    const counts: Record<StatusFilter, number> = {
      all: rows.length,
      draft: 0,
      pending: 0,
      approved: 0,
      rejected: 0,
      paused: 0,
      disabled: 0,
    };
    for (const r of rows) {
      counts[r.status] = (counts[r.status] || 0) + 1;
    }
    return counts;
  }, [rows]);

  const filtered = useMemo(() => {
    if (statusFilter === "all") return rows;
    return rows.filter((r) => r.status === statusFilter);
  }, [rows, statusFilter]);

  const refreshWaiting = async () => {
    if (channel !== "whatsapp") return;
    setBusy(true);
    setError(null);
    try {
      const synced = await syncMetaWhatsAppTemplatesApi();
      let list = synced.templates || [];
      const pending = list.filter((r) => r.status === "pending");
      if (pending.length) {
        await Promise.allSettled(
          pending.map((row) => refreshWhatsAppStatusApi(row.id)),
        );
        list = await fetchRegulatedTemplates({ channel });
      }
      setRows(list);
      setChannelReady(await fetchWhatsAppConfigReady());
    } catch (err) {
      setError(apiErrorMessage(err));
      try {
        setRows(await fetchRegulatedTemplates({ channel }));
      } catch {
        /* keep current rows */
      }
    } finally {
      setBusy(false);
    }
  };

  const active = activeId ? rows.find((r) => r.id === activeId) || null : null;
  const fieldDisabled = Boolean(active?.locked && mode === "view");

  const pushChat = (role: ChatMsg["role"], text: string) => {
    setChatMsgs((m) => [
      ...m,
      { id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, role, text },
    ]);
  };

  const openCreate = () => {
    setError(null);
    setActiveId(null);
    setUseConfirmRow(null);
    setChatMsgs([]);
    setPendingPhone(null);
    setForm({
      ...EMPTY_FORM,
      category: channel === "sms" ? "Transactional" : "MARKETING",
    });
    setMode("create");
  };

  const openUploadApproved = () => {
    setError(null);
    setActiveId(null);
    setChatMsgs([]);
    setPendingPhone(null);
    setForm({
      ...EMPTY_FORM,
      category: channel === "sms" ? "Transactional" : "MARKETING",
    });
    setMode("upload_approved");
  };

  const openRunChat = (row: RegulatedTemplateDto) => {
    setError(null);
    setActiveId(row.id);
    setForm(toForm(row));
    setPendingPhone(null);
    setChatInput("");
    setChatMsgs([
      {
        id: "intro",
        role: "assistant",
        text: `Ready to run “${row.name}”. Reply with the recipient phone (digits with country code, e.g. 919876543210). I'll ask you to confirm before sending.`,
      },
    ]);
    setMode("run");
  };

  const confirmUseApproved = () => {
    if (!useConfirmRow) return;
    const row = useConfirmRow;
    setUseConfirmRow(null);
    navigate(`/campaigns/create/whatsapp/approved/${row.id}`, {
      state: { template: row },
    });
  };

  const openRow = (row: RegulatedTemplateDto) => {
    if (channel === "sms" && row.status === "approved") {
      openRunChat(row);
      return;
    }
    if (channel === "whatsapp" && row.status === "approved") {
      setUseConfirmRow(row);
      return;
    }
    if (channel === "whatsapp" && row.status === "rejected") {
      navigate(`/campaigns/create/whatsapp/rejected/${row.id}`, {
        state: { template: row },
      });
      return;
    }
    setError(null);
    setActiveId(row.id);
    setForm(toForm(row));
    setChatMsgs([]);
    setPendingPhone(null);
    setMode("view");
  };

  const closeForm = () => {
    setMode("closed");
    setActiveId(null);
    setForm(EMPTY_FORM);
    setError(null);
    setChatMsgs([]);
    setChatInput("");
    setPendingPhone(null);
    setUseConfirmRow(null);
  };

  const validateLocal = (requireExternal: boolean): string | null => {
    if (!form.name.trim()) return "Template name is required.";
    if (channel === "whatsapp" && !/^[a-z0-9_]+$/.test(form.name.trim())) {
      return "WhatsApp name must be lowercase letters, numbers, and underscores only.";
    }
    if (!form.body.trim()) return "Message body is required.";
    if (requireExternal && !form.externalId.trim()) {
      return "DLT Template ID is required for approved SMS.";
    }
    return null;
  };

  const saveDraft = async () => {
    const err = validateLocal(false);
    if (err) {
      setError(err);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (activeId && active && !active.locked) {
        const updated = await updateRegulatedTemplateApi(activeId, {
          name: form.name.trim(),
          externalId: form.externalId.trim(),
          language: form.language.trim() || "en",
          category: form.category.trim(),
          header: form.header.trim(),
          body: form.body.trim(),
          footer: form.footer.trim(),
          buttons: form.buttons.trim(),
        });
        setForm(toForm(updated));
        setActiveId(updated.id);
        setMode("view");
      } else {
        const created = await createRegulatedTemplateApi({
          channel,
          name: form.name.trim(),
          externalId: form.externalId.trim(),
          language: form.language.trim() || "en",
          category: form.category.trim(),
          header: form.header.trim(),
          body: form.body.trim(),
          footer: form.footer.trim(),
          buttons: form.buttons.trim(),
        });
        setForm(toForm(created));
        setActiveId(created.id);
        setMode("view");
      }
      await load();
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const submitWaiting = async () => {
    const err = validateLocal(false);
    if (err) {
      setError(err);
      return;
    }
    if (channel === "whatsapp" && channelReady && !channelReady.ready) {
      setError(channelReady.message);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let id = activeId;
      if (!id || (active && !active.locked)) {
        if (!id) {
          const created = await createRegulatedTemplateApi({
            channel,
            name: form.name.trim(),
            externalId: form.externalId.trim(),
            language: form.language.trim() || "en",
            category: form.category.trim(),
            header: form.header.trim(),
            body: form.body.trim(),
            footer: form.footer.trim(),
            buttons: form.buttons.trim(),
          });
          id = created.id;
        } else {
          await updateRegulatedTemplateApi(id, {
            name: form.name.trim(),
            externalId: form.externalId.trim(),
            language: form.language.trim() || "en",
            category: form.category.trim(),
            header: form.header.trim(),
            body: form.body.trim(),
            footer: form.footer.trim(),
            buttons: form.buttons.trim(),
          });
        }
      }

      if (channel === "whatsapp") {
        const res = await submitWhatsAppApprovalApi(id!);
        setForm(toForm(res.template));
        setActiveId(res.template.id);
        // Land in the correct library section immediately after Meta submit.
        setStatusFilter(
          res.template.status === "approved"
            ? "approved"
            : res.template.status === "rejected"
              ? "rejected"
              : "pending",
        );
      } else {
        const updated = await setRegulatedStatusApi(id!, "pending");
        setForm(toForm(updated));
        setActiveId(updated.id);
        setStatusFilter("pending");
      }
      setMode("view");
      await load();
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const saveApprovedUpload = async () => {
    const err = validateLocal(true);
    if (err) {
      setError(err);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const created = await createRegulatedTemplateApi({
        channel: "sms",
        name: form.name.trim(),
        externalId: form.externalId.trim(),
        language: form.language.trim() || "en",
        category: form.category.trim(),
        header: form.header.trim(),
        body: form.body.trim(),
        footer: form.footer.trim(),
        buttons: form.buttons.trim(),
        asApproved: true,
      });
      setForm(toForm(created));
      setActiveId(created.id);
      setMode("view");
      await load();
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const markSmsStatus = async (status: "approved" | "rejected" | "pending") => {
    if (!activeId) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await setRegulatedStatusApi(
        activeId,
        status,
        status === "rejected" ? "Marked rejected manually" : undefined,
      );
      setForm(toForm(updated));
      await load();
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const refreshMeta = async () => {
    if (!activeId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await refreshWhatsAppStatusApi(activeId);
      setForm(toForm(res.template));
      await load();
    } catch (e) {
      setError(apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const sendSmsToPhone = async (to: string) => {
    if (!activeId) return;
    setBusy(true);
    try {
      if (channelReady && !channelReady.ready) {
        pushChat("assistant", `${channelReady.message} Open Configuration → SMS first.`);
        return;
      }
      const res = await sendRegulatedTemplateApi(activeId, to);
      const stubNote = res.stub ? " (stub — no live gateway)" : "";
      pushChat(
        "assistant",
        res.providerMessageId
          ? `Sent to ${to}. Message id: ${res.providerMessageId}${stubNote}`
          : `Sent to ${to}.${stubNote}`,
      );
      setPendingPhone(null);
    } catch (e) {
      pushChat("assistant", apiErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const onRunChatSend = () => {
    const text = chatInput.trim();
    if (!text || busy || !activeId) return;
    setChatInput("");
    pushChat("user", text);

    if (isNegative(text)) {
      setPendingPhone(null);
      pushChat(
        "assistant",
        "Cancelled. Reply with another phone number when you want to try again.",
      );
      return;
    }

    if (pendingPhone && isAffirmative(text)) {
      void sendSmsToPhone(pendingPhone);
      return;
    }

    const phone = extractPhoneDigits(text);
    if (phone) {
      setPendingPhone(phone);
      pushChat(
        "assistant",
        `Send “${active?.name || "template"}” to ${phone}? Reply yes to confirm, or cancel.`,
      );
      return;
    }

    if (pendingPhone) {
      pushChat(
        "assistant",
        `Still waiting — reply yes to send to ${pendingPhone}, cancel to abort, or a new phone number.`,
      );
      return;
    }

    pushChat(
      "assistant",
      "I need a phone number with country code (digits only), e.g. 919876543210.",
    );
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
        <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {(
            [
              ["all", "All"],
              ["draft", "Draft"],
              ["pending", "Pending"],
              ["approved", "Approved"],
              ["rejected", "Rejected"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              disabled={loading}
              onClick={() => {
                setStatusFilter(value);
                // Leave create/edit/run form so tabs feel like navigation, not a stuck overlay.
                if (mode !== "closed") closeForm();
              }}
              className={`inline-flex h-8 shrink-0 items-center rounded-full border px-3 text-xs font-medium ${
                statusFilter === value
                  ? "border-brand bg-brand text-text-on-dark"
                  : "border-border-default bg-canvas text-text-primary hover:bg-subtle"
              } ${loading ? "cursor-default opacity-80" : ""}`}
            >
              {label}
              {loading ? (
                <Skeleton
                  width={18}
                  height={10}
                  borderRadius={4}
                  className="ml-1.5 inline-block align-middle"
                />
              ) : (
                <span className="ml-1 opacity-70">{statusCounts[value]}</span>
              )}
            </button>
          ))}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {channel === "sms" ? (
            <Button type="button" variant="secondary" onClick={openUploadApproved}>
              <Upload className="size-3.5" strokeWidth={1.75} />
              Upload approved
            </Button>
          ) : null}
          {channel === "whatsapp" ? (
            <Button
              type="button"
              variant="secondary"
              className="!h-8 !rounded-full !px-3 !text-xs"
              disabled={busy || loading}
              onClick={() => void refreshWaiting()}
            >
              <RefreshCw
                className={`size-3.5 ${busy || loading ? "animate-spin" : ""}`}
                strokeWidth={1.75}
              />
              Sync from Meta
            </Button>
          ) : null}
          <Button
            type="button"
            variant="brand"
            className="!h-8 !rounded-full !px-3 !text-xs"
            onClick={openCreate}
          >
            <Plus className="size-3.5" strokeWidth={1.75} />
            {channel === "sms" ? "New waiting / draft" : "Create template"}
          </Button>
        </div>
      </div>

      {error && mode === "closed" ? (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {mode === "run" && active ? (
        <section className="overflow-hidden rounded-xl border border-border-default bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-default px-4 py-3">
            <div>
              <h3 className="text-sm font-semibold text-text-primary">
                Run: {active.name}
              </h3>
              <p className="mt-0.5 line-clamp-1 text-xs text-text-caption">
                {active.body}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setMode("view");
                  setChatMsgs([]);
                  setPendingPhone(null);
                }}
              >
                View details
              </Button>
              <button
                type="button"
                onClick={closeForm}
                className="text-xs text-text-caption hover:text-text-primary"
              >
                Close
              </button>
            </div>
          </div>
          <div className="flex max-h-[360px] flex-col gap-2 overflow-y-auto px-4 py-3">
            {chatMsgs.map((m) => (
              <div
                key={m.id}
                className={`max-w-[90%] rounded-2xl px-3 py-2 text-sm ${
                  m.role === "user"
                    ? "ml-auto bg-neutral-900 text-white"
                    : "bg-subtle text-text-primary"
                }`}
              >
                {m.text}
              </div>
            ))}
            <div ref={chatEndRef} />
          </div>
          <AgentChatComposer
            value={chatInput}
            onChange={setChatInput}
            onSend={onRunChatSend}
            busy={busy}
            placeholder="Phone number or yes / cancel"
            maxWidthClass="max-w-none"
            className="shrink-0 border-t border-border-default px-3 pt-2 pb-3"
          />
        </section>
      ) : null}

      {mode !== "closed" && mode !== "run" ? (
        <section className="rounded-xl border border-border-default bg-surface p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-text-primary">
              {mode === "upload_approved"
                ? "Upload approved template"
                : mode === "create"
                  ? channel === "sms"
                    ? "New waiting SMS template"
                    : "New WhatsApp template"
                  : active?.locked
                    ? "Template (locked after submit)"
                    : "Edit draft"}
            </h3>
            <button
              type="button"
              onClick={closeForm}
              className="text-xs text-text-caption hover:text-text-primary"
            >
              Close
            </button>
          </div>

          {error ? (
            <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {error}
            </p>
          ) : null}

          {active ? (
            <p className="mb-3">
              <span
                className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS_BADGE[active.status]}`}
              >
                {STATUS_LABEL[active.status]}
              </span>
            </p>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field
              label={
                channel === "whatsapp"
                  ? "Template name (a-z, 0-9, _)"
                  : "Template name"
              }
            >
              <Input
                value={form.name}
                disabled={fieldDisabled || busy}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder={
                  channel === "whatsapp" ? "summer_sale_2026" : "Promo OTP"
                }
              />
            </Field>
            <Field
              label={
                channel === "sms"
                  ? "DLT Template ID"
                  : "External name (filled after Meta submit)"
              }
            >
              <Input
                value={form.externalId}
                disabled={fieldDisabled || busy || channel === "whatsapp"}
                onChange={(e) =>
                  setForm((f) => ({ ...f, externalId: e.target.value }))
                }
                placeholder={channel === "sms" ? "PROMO_SALE_12" : "—"}
              />
            </Field>
            <Field label="Language">
              <Input
                value={form.language}
                disabled={fieldDisabled || busy}
                onChange={(e) =>
                  setForm((f) => ({ ...f, language: e.target.value }))
                }
                placeholder="en"
              />
            </Field>
            <Field label="Category">
              <Select
                value={form.category}
                disabled={fieldDisabled || busy}
                onChange={(e) =>
                  setForm((f) => ({ ...f, category: e.target.value }))
                }
                options={
                  channel === "whatsapp"
                    ? [
                        { value: "MARKETING", label: "MARKETING" },
                        { value: "UTILITY", label: "UTILITY" },
                        { value: "AUTHENTICATION", label: "AUTHENTICATION" },
                      ]
                    : [
                        { value: "Transactional", label: "Transactional" },
                        { value: "Promotional", label: "Promotional" },
                        { value: "OTP", label: "OTP" },
                      ]
                }
              />
            </Field>
            {channel === "whatsapp" ? (
              <Field label="Header (optional)" className="sm:col-span-2">
                <Input
                  value={form.header}
                  disabled={fieldDisabled || busy}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, header: e.target.value }))
                  }
                  placeholder="Summer Sale"
                />
              </Field>
            ) : null}
            <Field label="Body" className="sm:col-span-2">
              <Textarea
                rows={4}
                value={form.body}
                disabled={fieldDisabled || busy}
                onChange={(e) =>
                  setForm((f) => ({ ...f, body: e.target.value }))
                }
                placeholder={
                  channel === "whatsapp"
                    ? "Hi {{1}}, get {{2}}% off until {{3}}."
                    : "Hi {{name}}, your code is {{otp}}."
                }
              />
            </Field>
            {channel === "whatsapp" ? (
              <>
                <Field label="Footer (optional)">
                  <Input
                    value={form.footer}
                    disabled={fieldDisabled || busy}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, footer: e.target.value }))
                    }
                    placeholder="Reply STOP to unsubscribe"
                  />
                </Field>
                <Field label="Buttons (one per line, quick reply)">
                  <Textarea
                    rows={3}
                    value={form.buttons}
                    disabled={fieldDisabled || busy}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, buttons: e.target.value }))
                    }
                    placeholder={"Shop Now\nNot interested"}
                  />
                </Field>
              </>
            ) : null}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {mode === "upload_approved" ? (
              <Button
                type="button"
                variant="brand"
                disabled={busy}
                onClick={() => void saveApprovedUpload()}
              >
                Save as approved
              </Button>
            ) : null}

            {(mode === "create" ||
              (mode === "view" && active && !active.locked)) && (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => void saveDraft()}
                >
                  Save draft
                </Button>
                <Button
                  type="button"
                  variant="brand"
                  disabled={busy}
                  onClick={() => void submitWaiting()}
                >
                  {channel === "whatsapp"
                    ? "Submit for approval"
                    : "Mark waiting for approval"}
                </Button>
              </>
            )}

            {mode === "view" &&
            active &&
            channel === "whatsapp" &&
            active.status === "pending" ? (
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() => void refreshMeta()}
              >
                <RefreshCw className="size-3.5" strokeWidth={1.75} />
                Refresh status
              </Button>
            ) : null}

            {mode === "view" &&
            active &&
            channel === "sms" &&
            (active.status === "pending" || active.status === "draft") ? (
              <>
                <Button
                  type="button"
                  variant="brand"
                  disabled={busy}
                  onClick={() => void markSmsStatus("approved")}
                >
                  Mark approved
                </Button>
                {active.status === "pending" ? (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => void markSmsStatus("rejected")}
                  >
                    Mark rejected
                  </Button>
                ) : null}
              </>
            ) : null}
          </div>

          {mode === "view" &&
          active &&
          channel === "sms" &&
          active.status === "approved" ? (
            <div className="mt-4">
              <Button
                type="button"
                variant="brand"
                disabled={busy}
                onClick={() => openRunChat(active)}
              >
                <Send className="size-3.5" strokeWidth={1.75} />
                Run in chat
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}

      {useConfirmRow ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="use-wa-template-title"
            className="w-full max-w-md rounded-2xl border border-border-default bg-surface p-5 shadow-xl"
          >
            <h3
              id="use-wa-template-title"
              className="text-base font-semibold text-text-primary"
            >
              Use this approved template?
            </h3>
            <p className="mt-2 text-sm text-text-caption">
              Start the Approved WhatsApp agent with{" "}
              <span className="font-medium text-text-primary">
                {useConfirmRow.name}
              </span>
              . Overview shows name, goal, and objective. Chat collects contacts
              or phones, then sends the approved template as-is (no edits).
            </p>
            <div className="mt-4 max-h-64 overflow-y-auto rounded-xl border border-border-default bg-subtle p-3">
              <p className="mb-2 text-xs font-semibold text-text-primary">
                {useConfirmRow.name}
              </p>
              <ChannelTemplatePreview
                channel="whatsapp"
                fields={{
                  header: useConfirmRow.header,
                  body: useConfirmRow.body,
                  footer: useConfirmRow.footer,
                  buttons: buttonsToPreview(useConfirmRow.buttons),
                }}
              />
            </div>
            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setUseConfirmRow(null)}
              >
                Cancel
              </Button>
              <Button type="button" variant="brand" onClick={confirmUseApproved}>
                Use template
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div
          className="mt-1"
          aria-busy="true"
          aria-label="Loading templates"
        >
          <SkeletonGrid columns={3} gap="gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonCard key={i} padding="p-3" className="rounded-2xl shadow-sm">
                <div className="mb-2 flex items-center gap-2">
                  <Skeleton width="45%" height={14} />
                  <Skeleton width={56} height={16} borderRadius={999} />
                </div>
                <Skeleton
                  width="100%"
                  height={220}
                  borderRadius={16}
                  className="mx-auto max-w-[200px]"
                />
              </SkeletonCard>
            ))}
          </SkeletonGrid>
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-default px-6 py-12 text-center">
          <p className="text-sm font-medium text-text-primary">
            {statusFilter === "all"
              ? `No ${channel === "sms" ? "SMS" : "WhatsApp"} templates yet`
              : `No ${STATUS_LABEL[statusFilter as RegulatedApprovalStatus] || statusFilter} templates`}
          </p>
          <p className="mt-1 text-sm text-text-caption">
            {channel === "whatsapp"
              ? statusFilter === "pending"
                ? "Submit a template to Meta, or Sync from Meta to pull Pending templates here."
                : statusFilter === "approved"
                  ? "Approved Meta templates appear here after Sync from Meta (or status poll)."
                  : statusFilter === "rejected"
                    ? "Rejected Meta submissions appear here after Sync from Meta."
                    : statusFilter === "draft"
                      ? "Create a draft template to get started."
                      : "Create a draft, or Sync from Meta to load WhatsApp templates into Pending / Approved / Rejected."
              : "Create a draft template to get started."}
          </p>
        </div>
      ) : channel === "whatsapp" ? (
        <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((row) => (
            <li
              key={row.id}
              className="relative flex flex-col overflow-hidden rounded-2xl border border-border-default bg-surface p-3 shadow-sm"
            >
              <button
                type="button"
                onClick={() => openRow(row)}
                className="min-w-0 flex-1 text-left"
              >
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-text-primary">
                    {row.name}
                  </p>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_BADGE[row.status]}`}
                  >
                    {STATUS_LABEL[row.status]}
                  </span>
                </div>
                <ChannelTemplatePreview
                  channel="whatsapp"
                  fields={{
                    header: row.header,
                    body: row.body,
                    footer: row.footer,
                    buttons: buttonsToPreview(row.buttons),
                  }}
                />
              </button>
              <div className="mt-2 flex justify-end">
                <ConfirmDeleteButton
                  name={row.name}
                  entityLabel="template"
                  compact
                  consequence="Removes this template from approvals."
                  onConfirm={async () => {
                    await deleteRegulatedTemplateApi(row.id);
                    if (activeId === row.id) closeForm();
                    await load();
                    return { ok: true as const };
                  }}
                  onSuccess={() => void load()}
                />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="divide-y divide-border-default overflow-hidden rounded-xl border border-border-default bg-surface">
          {filtered.map((row, index) => (
            <li key={row.id} className="flex items-stretch gap-1">
              <button
                type="button"
                onClick={() => openRow(row)}
                className="min-w-0 flex-1 px-4 py-3 text-left hover:bg-subtle"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-text-caption">{index + 1}.</span>
                  <p className="text-sm font-medium text-text-primary">
                    {row.name}
                  </p>
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_BADGE[row.status]}`}
                  >
                    {STATUS_LABEL[row.status]}
                  </span>
                </div>
                {row.externalId ? (
                  <p className="mt-0.5 font-mono text-[11px] text-text-caption">
                    ID: {row.externalId}
                  </p>
                ) : null}
                <p className="mt-1 line-clamp-2 text-xs text-text-caption">
                  {row.body}
                </p>
              </button>
              <div className="flex items-center pr-3">
                <ConfirmDeleteButton
                  name={row.name}
                  entityLabel="template"
                  compact
                  consequence="Removes this template from approvals."
                  onConfirm={async () => {
                    await deleteRegulatedTemplateApi(row.id);
                    if (activeId === row.id) closeForm();
                    await load();
                    return { ok: true as const };
                  }}
                  onSuccess={() => void load()}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-medium text-text-caption">
        {label}
      </span>
      {children}
    </label>
  );
}
