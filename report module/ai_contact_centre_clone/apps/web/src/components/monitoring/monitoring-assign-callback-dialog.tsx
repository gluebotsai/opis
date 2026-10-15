import { useEffect, useMemo, useRef, useState } from "react";
import { Calendar, LoaderCircle, X } from "lucide-react";

import { channelLabel } from "@/components/monitoring/monitoring-utils";
import { nativeSelectSmClassName } from "@/components/ui/native-select";
import type {
  CallbackChannelOption,
  ContactCallbackChannels,
  MonitoringSnapshot,
} from "@/features/monitoring/api";
import { monitoringApi } from "@/features/monitoring/api";
import {
  CALLBACK_DUE_OPTIONS,
  DEFAULT_CALLBACK_DUE_PRESET,
  formatCallbackDuePreview,
  resolveCallbackDueAt,
  resolveQueueCloseAt,
  toDatetimeLocalValue,
  type CallbackDuePreset,
} from "@/features/monitoring/callback-due";
import {
  callbackAgentsFromSnapshot,
  isCallbackEligibleChannel,
  type CallbackAssignmentTarget,
} from "@/features/monitoring/map-monitoring-snapshot";

type MonitoringAssignCallbackDialogProps = {
  open: boolean;
  snapshot: MonitoringSnapshot | null;
  target: CallbackAssignmentTarget | null;
  onClose: () => void;
  onAssigned: () => void;
};

function asCallbackChannel(value: string | null | undefined): CallbackChannelOption | null {
  if (
    value === "whatsapp" ||
    value === "instagram" ||
    value === "facebook" ||
    value === "email"
  ) {
    return value;
  }
  return null;
}

function pickDefaultChannel(
  options: ContactCallbackChannels | null,
  hintChannel: string,
): CallbackChannelOption | "" {
  const hint = asCallbackChannel(hintChannel);
  if (!options) return hint ?? "";

  const preferred = options.preferredChannel;
  if (preferred && options.availableChannels.includes(preferred)) {
    return preferred;
  }
  if (hint && options.availableChannels.includes(hint)) {
    return hint;
  }
  return options.availableChannels[0] ?? hint ?? "";
}

export function MonitoringAssignCallbackDialog({
  open,
  snapshot,
  target,
  onClose,
  onAssigned,
}: MonitoringAssignCallbackDialogProps) {
  const [assignedUserId, setAssignedUserId] = useState("");
  const [channel, setChannel] = useState<CallbackChannelOption | "">("");
  const [availableChannels, setAvailableChannels] = useState<CallbackChannelOption[]>([]);
  const [preferredChannel, setPreferredChannel] = useState<CallbackChannelOption | null>(null);
  const [channelsLoading, setChannelsLoading] = useState(false);
  const [duePreset, setDuePreset] = useState<CallbackDuePreset>(DEFAULT_CALLBACK_DUE_PRESET);
  const [customDue, setCustomDue] = useState("");
  const customDueRef = useRef<HTMLInputElement>(null);
  const openPickerOnCustom = useRef(false);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!open || !target) return;

    let cancelled = false;
    setAssignedUserId("");
    setDuePreset(DEFAULT_CALLBACK_DUE_PRESET);
    setCustomDue("");
    setNotes("");
    setError(null);
    setSuccess(false);

    const hint = asCallbackChannel(target.channel);
    const contactId = target.contactId?.trim() || null;

    if (!contactId) {
      setPreferredChannel(hint);
      setAvailableChannels(hint ? [hint] : []);
      setChannel(hint ?? "");
      setChannelsLoading(false);
      return;
    }

    setChannelsLoading(true);
    void monitoringApi
      .getContactCallbackChannels(contactId, hint ?? undefined)
      .then((options) => {
        if (cancelled) return;
        setPreferredChannel(options.preferredChannel);
        setAvailableChannels(options.availableChannels);
        setChannel(pickDefaultChannel(options, target.channel));
      })
      .catch((reason) => {
        if (cancelled) return;
        setPreferredChannel(hint);
        setAvailableChannels(hint ? [hint] : []);
        setChannel(hint ?? "");
        setError(
          reason instanceof Error
            ? reason.message
            : "Unable to load preferred channel; using missed channel.",
        );
      })
      .finally(() => {
        if (!cancelled) setChannelsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, target]);

  const agents = useMemo(() => {
    if (!snapshot) return [];
    const eligible = callbackAgentsFromSnapshot(snapshot);
    if (!channel) return eligible;
    return eligible.filter((agent) =>
      agent.capacity.some(
        (row) => row.channel === channel && row.active < row.max,
      ),
    );
  }, [snapshot, channel]);

  useEffect(() => {
    if (!assignedUserId) return;
    if (agents.some((agent) => agent.id === assignedUserId)) return;
    setAssignedUserId("");
  }, [agents, assignedUserId]);

  const queueCloseTime = useMemo(() => {
    const queueId = target?.queueId?.trim();
    if (!queueId || !snapshot) return null;
    return snapshot.queues.find((queue) => queue.id === queueId)?.closeTime ?? null;
  }, [snapshot, target?.queueId]);

  const dueAt = useMemo(() => {
    return resolveCallbackDueAt(duePreset, {
      closeTime: queueCloseTime,
      customValue: customDue,
    });
  }, [customDue, duePreset, queueCloseTime]);

  const duePreview = useMemo(() => {
    const usedQueueClose =
      duePreset === "eod" && resolveQueueCloseAt(new Date(), queueCloseTime).usedQueueClose;
    return formatCallbackDuePreview(dueAt, { preset: duePreset, usedQueueClose });
  }, [dueAt, duePreset, queueCloseTime]);

  useEffect(() => {
    if (duePreset !== "custom" || !openPickerOnCustom.current) return;
    openPickerOnCustom.current = false;
    const input = customDueRef.current;
    if (!input) return;
    input.focus();
    if (typeof input.showPicker === "function") {
      input.showPicker();
    }
  }, [customDue, duePreset]);

  function clearCustomDue() {
    openPickerOnCustom.current = false;
    setCustomDue("");
    setDuePreset(DEFAULT_CALLBACK_DUE_PRESET);
  }

  function openCustomPicker() {
    if (duePreset === "custom") {
      const input = customDueRef.current;
      input?.focus();
      if (input && typeof input.showPicker === "function") {
        input.showPicker();
      }
      return;
    }
    openPickerOnCustom.current = true;
    setDuePreset("custom");
    setCustomDue((current) => current || toDatetimeLocalValue(dueAt ?? new Date()));
  }

  if (!open || !target) return null;

  const channelOk =
    channelsLoading ||
    Boolean(channel) ||
    availableChannels.length > 0 ||
    isCallbackEligibleChannel(target.channel);

  async function handleSubmit() {
    if (!target || !assignedUserId || !channel || !dueAt) return;
    setBusy(true);
    setError(null);
    try {
      await monitoringApi.createCallbackTask({
        assignedUserId,
        conversationId: target.conversationId ?? undefined,
        contactId: target.contactId ?? undefined,
        channel,
        title: target.title,
        summary: target.summary,
        notes: notes.trim() || undefined,
        dueAt: dueAt.toISOString(),
      });
      setSuccess(true);
      onAssigned();
      window.setTimeout(() => {
        setSuccess(false);
        setNotes("");
        setAssignedUserId("");
        setChannel("");
        setDuePreset(DEFAULT_CALLBACK_DUE_PRESET);
        setCustomDue("");
        onClose();
      }, 900);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Unable to assign callback");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        aria-label="Close callback dialog"
        className="fixed inset-0 z-40 bg-black/20"
        onClick={onClose}
      />
      <div className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white p-4 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-neutral-900">Assign callback</p>
            <p className="mt-0.5 text-sm text-neutral-600">
              {target.customerName}
              {channel ? ` · ${channelLabel(channel)}` : ""}
              {preferredChannel && channel === preferredChannel ? " · preferred" : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
          >
            <X className="size-4" />
          </button>
        </div>

        {!channelOk && !channelsLoading ? (
          <p className="mt-4 text-sm text-amber-700">
            No callback channel is available for this contact. Add WhatsApp, Instagram, Facebook, or
            email on the profile.
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            <label className="block text-xs font-medium text-neutral-700">
              Channel
              <select
                value={channel}
                onChange={(event) =>
                  setChannel(asCallbackChannel(event.target.value) ?? "")
                }
                disabled={channelsLoading || availableChannels.length === 0}
                className={nativeSelectSmClassName("mt-1 w-full py-2 text-sm")}
              >
                {channelsLoading ? <option value="">Loading channels…</option> : null}
                {!channelsLoading && availableChannels.length === 0 ? (
                  <option value="">No available channels</option>
                ) : null}
                {availableChannels.map((option) => (
                  <option key={option} value={option}>
                    {channelLabel(option)}
                    {preferredChannel === option ? " (preferred)" : ""}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-xs font-medium text-neutral-700">
              Assign to agent
              <select
                value={assignedUserId}
                onChange={(event) => setAssignedUserId(event.target.value)}
                className={nativeSelectSmClassName("mt-1 w-full py-2 text-sm")}
              >
                <option value="">Select agent…</option>
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                    {agent.queueNames.length ? ` · ${agent.queueNames.join(", ")}` : ""}
                  </option>
                ))}
              </select>
            </label>

            <div>
              <span className="block text-xs font-medium text-neutral-700">Due</span>
              <div className="mt-1 flex items-center gap-2">
                {duePreset === "custom" ? (
                  <div className="relative min-w-0 flex-1">
                    <input
                      ref={customDueRef}
                      type="datetime-local"
                      value={customDue}
                      onChange={(event) => setCustomDue(event.target.value)}
                      aria-label="Callback due date and time"
                      className="h-9 w-full rounded-lg border-[0.6px] border-[#bfbfbf] bg-white py-0 pr-8 pl-3 text-sm outline-none focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200 [&::-webkit-calendar-picker-indicator]:hidden"
                    />
                    <button
                      type="button"
                      onClick={clearCustomDue}
                      aria-label="Clear custom due date"
                      title="Clear and use a preset"
                      className="absolute top-1/2 right-1.5 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                ) : (
                  <select
                    value={duePreset}
                    onChange={(event) => {
                      setDuePreset(event.target.value as CallbackDuePreset);
                      setCustomDue("");
                    }}
                    aria-label="Callback due time"
                    className={nativeSelectSmClassName("h-9 w-full py-2 text-sm")}
                  >
                    {CALLBACK_DUE_OPTIONS.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  onClick={openCustomPicker}
                  aria-label="Pick a custom due date"
                  title="Pick date and time"
                  className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border-[0.6px] border-[#bfbfbf] text-neutral-600 hover:bg-neutral-50 hover:text-neutral-900"
                >
                  <Calendar className="size-4" />
                </button>
              </div>
              {duePreset === "custom" ? null : (
                <p className="mt-1 text-xs text-neutral-600">{duePreview}</p>
              )}
            </div>

            <label className="block text-xs font-medium text-neutral-700">
              Notes for agent
              <textarea
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                rows={3}
                placeholder="Optional context for the callback"
                className="mt-1 w-full rounded-lg border-[0.6px] border-[#bfbfbf] px-3 py-2 text-sm outline-none focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200"
              />
            </label>

            {agents.length === 0 && !channelsLoading ? (
              <p className="text-xs text-neutral-600">
                {channel
                  ? `No logged-in agents with ${channelLabel(channel)} capacity right now.`
                  : "No logged-in agents with social channel capacity right now."}
              </p>
            ) : null}

            {error ? <p className="text-xs text-rose-600">{error}</p> : null}
            {success ? (
              <p className="text-xs font-medium text-emerald-700">Callback assigned to agent.</p>
            ) : null}

            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border-[0.6px] border-[#bfbfbf] px-3 py-1.5 text-xs font-medium text-neutral-700"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  busy ||
                  channelsLoading ||
                  !assignedUserId ||
                  !channel ||
                  !dueAt ||
                  agents.length === 0
                }
                onClick={() => void handleSubmit()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
              >
                {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
                Assign callback
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
