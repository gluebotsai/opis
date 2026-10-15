import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Calendar,
  CheckSquare,
  ChevronDown,
  Mail,
  MessageSquare,
  Phone,
  PhoneOff,
  StickyNote,
} from "lucide-react";
import { EmailComposeDialog } from "@/components/email/EmailComposeDialog";
import {
  getOutboundCallState,
  hangupOutboundCall,
  placeOutboundCall,
  subscribeOutboundCall,
} from "@/features/voice/sip-ua";
import { MeetingParticipantsField } from "@/components/email/MeetingParticipantsField";
import type { ComposeContactOption } from "@/components/email/types";
import {
  MEETING_PROVIDERS,
  meetingProviderLabel,
  type MeetingProvider,
} from "@/lib/meeting-provider";
import { createContactActivity, listTaskFormOptions } from "@/services/contacts";
import { createDealActivity } from "@/services/sales";
import { scheduleMeeting } from "@/services/calendar";
import { fetchEmailIntegrations } from "@/services/configuration";
import { Button } from "@/components/ui/Button";
import { DateTimeLocalInput } from "@/components/ui/DateTimeLocalInput";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { NoteComposer } from "@/components/contacts/NoteComposer";

export function ContactQuickActions({
  contactId,
  displayName,
  email,
  phone,
  compact = false,
  stretched = false,
  /** List rows: call / email / schedule only, no pill background.
   *  Toolbar: labeled Call / Email / Schedule Meeting plus a More menu.
   */
  variant = "default",
  dealId = null,
  assignableUsers = [],
  currentUserId = null,
  canAssignAssignee = false,
  onChanged,
  menuExtras = null,
}: {
  contactId: string;
  displayName: string;
  email: string;
  phone: string | null;
  /** Tighter padding for kanban cards */
  compact?: boolean;
  /** Full-width bar sized for deal/contact detail cards */
  stretched?: boolean;
  variant?: "default" | "list" | "toolbar";
  /** When set (deal detail), log note/call/task/SMS on the deal instead of the contact. */
  dealId?: string | null;
  assignableUsers?: Array<{ id: string; label: string }>;
  currentUserId?: string | null;
  canAssignAssignee?: boolean;
  /** Called after any activity is logged / meeting scheduled, so the parent can refetch. */
  onChanged?: () => void;
  /** Extra rows inside the toolbar More menu. Stays mounted so dialogs can open. */
  menuExtras?: ReactNode;
}) {
  const pending = false;
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const [modal, setModal] = useState<
    "note" | "schedule" | "email" | "task" | "sms" | null
  >(null);
  const call = useSyncExternalStore(
    subscribeOutboundCall,
    getOutboundCallState,
    getOutboundCallState,
  );
  const listVariant = variant === "list";
  const toolbarVariant = variant === "toolbar";
  const onCall = call.phase !== "idle";

  useEffect(() => {
    if (!moreOpen) return;
    const onPointer = (event: MouseEvent) => {
      if (!moreRef.current?.contains(event.target as Node)) setMoreOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  const contact: ComposeContactOption = {
    id: contactId,
    displayName,
    email,
    phone,
  };

  const digits = phone?.replace(/[^\d+]/g, "") ?? "";
  const smsHref = digits ? `sms:${digits}` : null;

  const logActivity = async (input: {
    type: "sms" | "note" | "call" | "task";
    subject: string;
    body?: string | null;
    dueAt?: string | null;
  }) => {
    if (dealId) {
      return createDealActivity(dealId, input);
    }
    return createContactActivity(contactId, input);
  };

  const openModal = (next: "note" | "schedule" | "email" | "task" | "sms") => {
    setMoreOpen(false);
    setModal(next);
  };

  const iconClass = stretched ? "size-4 sm:size-[1.125rem]" : "size-3.5";
  const iconStroke = stretched ? 1.9 : 1.75;
  const iconSize = stretched ? "lg" : "sm";

  return (
    <>
      {toolbarVariant ? (
        <div className="flex max-w-full flex-wrap items-center gap-2">
          <Button
            variant="primary"
            disabled={pending || (!phone && !onCall)}
            onClick={() => {
              if (onCall) {
                hangupOutboundCall();
                return;
              }
              void placeOutboundCall(phone ?? "", undefined, displayName);
            }}
          >
            {onCall ? (
              <PhoneOff className="size-4" strokeWidth={1.75} />
            ) : (
              <Phone className="size-4" strokeWidth={1.75} />
            )}
            {onCall ? "Hang up" : "Call"}
          </Button>
          <Button variant="secondary" disabled={pending} onClick={() => openModal("email")}>
            <Mail className="size-4" strokeWidth={1.75} />
            Email
          </Button>
          <Button variant="secondary" disabled={pending} onClick={() => openModal("schedule")}>
            <Calendar className="size-4" strokeWidth={1.75} />
            Schedule Meeting
          </Button>
          <div className="relative" ref={moreRef}>
            <Button
              variant="secondary"
              disabled={pending}
              aria-expanded={moreOpen}
              aria-haspopup="menu"
              onClick={() => setMoreOpen((open) => !open)}
            >
              More
              <ChevronDown className="size-4" strokeWidth={1.75} />
            </Button>
            <div
              role="menu"
              hidden={!moreOpen}
              className="absolute right-0 z-30 mt-1 min-w-[12.5rem] rounded-lg border border-border-default bg-surface py-1 shadow-lg"
            >
              <MoreItem
                label={`Log note for ${displayName}`}
                onClick={() => openModal("note")}
              >
                Log note
              </MoreItem>
              <MoreItem
                label={`Create task for ${displayName}`}
                onClick={() => openModal("task")}
              >
                Create task
              </MoreItem>
              <MoreItem
                label={phone ? `SMS ${displayName}` : "No phone number"}
                disabled={!smsHref || pending}
                onClick={() => openModal("sms")}
              >
                SMS
              </MoreItem>
              {menuExtras ? (
                <div
                  className="mt-1 border-t border-border-default pt-1"
                  onClick={() => setMoreOpen(false)}
                >
                  {menuExtras}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : listVariant ? (
        <>
          <ActionIcon
            label={onCall ? `Hang up ${displayName}` : `Call ${displayName}`}
            disabled={pending || (!phone && !onCall)}
            size={iconSize}
            onClick={() => {
              if (onCall) {
                hangupOutboundCall();
                return;
              }
              void placeOutboundCall(phone ?? "", undefined, displayName);
            }}
          >
            {onCall ? (
              <PhoneOff className={iconClass} strokeWidth={iconStroke} />
            ) : (
              <Phone className={iconClass} strokeWidth={iconStroke} />
            )}
          </ActionIcon>
          <ActionIcon
            label={`Email ${displayName}`}
            disabled={pending}
            size={iconSize}
            onClick={() => setModal("email")}
          >
            <Mail className={iconClass} strokeWidth={iconStroke} />
          </ActionIcon>
          <ActionIcon
            label={`Schedule with ${displayName}`}
            disabled={pending}
            size={iconSize}
            onClick={() => setModal("schedule")}
          >
            <Calendar className={iconClass} strokeWidth={iconStroke} />
          </ActionIcon>
        </>
      ) : (
        <div
          className={
            stretched
              ? "flex w-full max-w-full items-center justify-between gap-0.5 rounded-xl bg-subtle/80 px-1.5 py-1 sm:gap-1 sm:px-2 sm:py-1.5"
              : `inline-flex items-center gap-0.5 rounded-full bg-subtle/80 ${
                  compact ? "px-0.5 py-0" : "px-1 py-0.5"
                }`
          }
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <ActionIcon
            label={onCall ? `Hang up ${displayName}` : `Call ${displayName}`}
            disabled={pending || (!phone && !onCall)}
            size={iconSize}
            onClick={() => {
              if (onCall) {
                hangupOutboundCall();
                return;
              }
              void placeOutboundCall(phone ?? "", undefined, displayName);
            }}
          >
            {onCall ? (
              <PhoneOff className={iconClass} strokeWidth={iconStroke} />
            ) : (
              <Phone className={iconClass} strokeWidth={iconStroke} />
            )}
          </ActionIcon>
          <ActionIcon
            label={`Email ${displayName}`}
            disabled={pending}
            size={iconSize}
            onClick={() => setModal("email")}
          >
            <Mail className={iconClass} strokeWidth={iconStroke} />
          </ActionIcon>
          <ActionIcon
            label={phone ? `SMS ${displayName}` : "No phone number"}
            disabled={!smsHref || pending}
            size={iconSize}
            onClick={() => openModal("sms")}
          >
            <MessageSquare className={iconClass} strokeWidth={iconStroke} />
          </ActionIcon>
          <ActionIcon
            label={`Add note for ${displayName}`}
            disabled={pending}
            size={iconSize}
            onClick={() => setModal("note")}
          >
            <StickyNote className={iconClass} strokeWidth={iconStroke} />
          </ActionIcon>
          <ActionIcon
            label={`Add task for ${displayName}`}
            disabled={pending}
            size={iconSize}
            onClick={() => setModal("task")}
          >
            <CheckSquare className={iconClass} strokeWidth={iconStroke} />
          </ActionIcon>
          <ActionIcon
            label={`Schedule with ${displayName}`}
            disabled={pending}
            size={iconSize}
            onClick={() => setModal("schedule")}
          >
            <Calendar className={iconClass} strokeWidth={iconStroke} />
          </ActionIcon>
        </div>
      )}
      {modal === "sms" ? (
        <SmsSendDialog
          displayName={displayName}
          phone={phone}
          onClose={() => setModal(null)}
          onConfirmSent={async (body) => {
            const result = await logActivity({
              type: "sms",
              subject: `SMS to ${displayName}`,
              body,
            });
            if (result.ok) onChanged?.();
            return result.ok
              ? { ok: true }
              : { ok: false, error: result.error };
          }}
        />
      ) : modal === "email" ? (
        <EmailComposeDialog
          initialContact={contact}
          initialTo={email}
          onClose={() => setModal(null)}
          onSent={onChanged}
        />
      ) : modal === "task" ? (
        <TaskDialog
          contactId={contactId}
          dealId={dealId}
          displayName={displayName}
          assignableUsers={assignableUsers}
          currentUserId={currentUserId}
          canAssignAssignee={canAssignAssignee}
          onClose={() => setModal(null)}
          onChanged={onChanged}
        />
      ) : modal ? (
        <QuickActionDialog
          mode={modal}
          contactId={contactId}
          dealId={dealId}
          displayName={displayName}
          email={email}
          onClose={() => setModal(null)}
          onChanged={onChanged}
        />
      ) : null}
    </>
  );
}

export function ScheduleMeetingDialog({
  contactId,
  displayName,
  email,
  onClose,
  onChanged,
}: {
  contactId: string;
  displayName: string;
  email: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  return (
    <QuickActionDialog
      mode="schedule"
      contactId={contactId}
      displayName={displayName}
      email={email}
      onClose={onClose}
      onChanged={onChanged}
    />
  );
}

/** Rich note composer — same UI as the left-rail sticky-note icon. */
export function AddNoteDialog({
  contactId,
  dealId = null,
  displayName,
  onClose,
  onChanged,
}: {
  contactId: string;
  dealId?: string | null;
  displayName: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  return (
    <QuickActionDialog
      mode="note"
      contactId={contactId}
      dealId={dealId}
      displayName={displayName}
      email=""
      onClose={onClose}
      onChanged={onChanged}
    />
  );
}

export function AddTaskDialog({
  contactId,
  dealId = null,
  displayName,
  assignableUsers = [],
  currentUserId = null,
  canAssignAssignee = false,
  onClose,
  onChanged,
}: {
  contactId: string;
  dealId?: string | null;
  displayName: string;
  assignableUsers?: Array<{ id: string; label: string }>;
  currentUserId?: string | null;
  canAssignAssignee?: boolean;
  onClose: () => void;
  onChanged?: () => void;
}) {
  return (
    <TaskDialog
      contactId={contactId}
      dealId={dealId}
      displayName={displayName}
      assignableUsers={assignableUsers}
      currentUserId={currentUserId}
      canAssignAssignee={canAssignAssignee}
      onClose={onClose}
      onChanged={onChanged}
    />
  );
}

function TaskDialog({
  contactId,
  dealId = null,
  displayName,
  assignableUsers: initialUsers,
  currentUserId: initialUserId,
  canAssignAssignee: initialCanAssign,
  onClose,
  onChanged,
}: {
  contactId: string;
  dealId?: string | null;
  displayName: string;
  assignableUsers: Array<{ id: string; label: string }>;
  currentUserId: string | null;
  canAssignAssignee: boolean;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [subject, setSubject] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [body, setBody] = useState("");
  const [assignableUsers, setAssignableUsers] = useState(initialUsers);
  const [canAssignAssignee, setCanAssignAssignee] = useState(initialCanAssign);
  const [assigneeUserId, setAssigneeUserId] = useState(
    () =>
      (initialUserId && initialUsers.some((u) => u.id === initialUserId)
        ? initialUserId
        : initialUsers[0]?.id) ?? "",
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const opts = await listTaskFormOptions();
        if (cancelled) return;
        setAssignableUsers(opts.users);
        setCanAssignAssignee(opts.canAssignAssignee);
        setAssigneeUserId((prev) => {
          if (prev && opts.users.some((u) => u.id === prev)) return prev;
          if (
            opts.currentUserId &&
            opts.users.some((u) => u.id === opts.currentUserId)
          ) {
            return opts.currentUserId;
          }
          return opts.users[0]?.id ?? opts.currentUserId ?? "";
        });
      } catch {
        if (!cancelled) setError("Could not load task form options.");
      } finally {
        if (!cancelled) setLoadingOptions(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const onSave = () => {
    setError(null);
    const text = subject.trim();
    if (!text) {
      setError("Enter a task title.");
      return;
    }
    if (!dueAt) {
      setError("Pick a due date.");
      return;
    }
    if (!body.trim()) {
      setError("Enter a description.");
      return;
    }
    if (!dealId && canAssignAssignee && !assigneeUserId) {
      setError("Pick an assignee.");
      return;
    }
    setPending(true);
    void (dealId
      ? createDealActivity(dealId, {
          type: "task",
          subject: text,
          body: body.trim(),
          dueAt: new Date(dueAt).toISOString(),
        })
      : createContactActivity(contactId, {
          type: "task",
          subject: text,
          body: body.trim(),
          dueAt: new Date(dueAt).toISOString(),
          assigneeUserId: canAssignAssignee ? assigneeUserId : null,
        })
    ).then((result) => {
      setPending(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onChanged?.();
      onClose();
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-border-default bg-surface p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-text-primary">Add task</h3>
        <p className="mt-1 text-sm text-text-caption">{displayName}</p>
        <div className="mt-4 grid gap-3">
          <Input
            label="Task title"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Follow up on proposal…"
            required
          />
          <DateTimeLocalInput label="Due date" value={dueAt} onChange={setDueAt} />
          {!dealId && canAssignAssignee ? (
            <Select
              label="Assignee"
              value={assigneeUserId}
              onChange={(e) => setAssigneeUserId(e.target.value)}
              disabled={loadingOptions || assignableUsers.length === 0}
              options={
                assignableUsers.length > 0
                  ? assignableUsers.map((u) => ({ value: u.id, label: u.label }))
                  : [
                      {
                        value: "",
                        label: loadingOptions ? "Loading…" : "No users",
                      },
                    ]
              }
            />
          ) : null}
          <Textarea
            label="Description"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What needs to be done…"
            rows={3}
            required
          />
          {error ? <p className="text-sm text-text-danger">{error}</p> : null}
          <div className="flex gap-2">
            <Button
              variant="primary"
              disabled={pending || loadingOptions}
              onClick={onSave}
            >
              {pending ? "Saving…" : "Create task"}
            </Button>
            <Button variant="secondary" disabled={pending} onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export const QUICK_ACTION_MENU_ITEM_CLASS =
  "flex w-full items-center px-3 py-2 text-left text-sm text-text-primary hover:bg-subtle disabled:cursor-not-allowed disabled:text-text-caption";

function MoreItem({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      aria-label={label}
      disabled={disabled}
      className={QUICK_ACTION_MENU_ITEM_CLASS}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function ActionIcon({
  label,
  children,
  disabled,
  onClick,
  size = "sm",
  /** Escape overflow parents (contact list scroll panes). */
  tooltip = "float",
}: {
  label: string;
  children: ReactNode;
  disabled?: boolean;
  onClick?: () => void;
  size?: "sm" | "lg";
  tooltip?: "float" | "native" | "none";
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  const [tip, setTip] = useState<{ left: number; top: number } | null>(null);

  const className = `inline-flex shrink-0 items-center justify-center rounded-full text-text-secondary transition-colors ${
    size === "lg" ? "size-9 sm:size-10" : "size-7"
  } ${
    disabled
      ? "cursor-not-allowed opacity-35"
      : "hover:bg-neutral-100 hover:text-brand"
  }`;

  const showFloat = tooltip === "float";

  const updateTip = () => {
    if (!showFloat || !btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    setTip({
      left: rect.left + rect.width / 2,
      top: rect.top - 8,
    });
  };

  const hideTip = () => setTip(null);

  useEffect(() => {
    if (!tip) return;
    const onScroll = () => hideTip();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [tip]);

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={showFloat ? updateTip : undefined}
      onMouseLeave={showFloat ? hideTip : undefined}
      onFocus={showFloat ? updateTip : undefined}
      onBlur={showFloat ? hideTip : undefined}
    >
      <button
        ref={btnRef}
        type="button"
        className={className}
        aria-label={label}
        title={tooltip === "native" ? label : undefined}
        disabled={disabled}
        onClick={onClick}
      >
        {children}
      </button>
      {showFloat && tip
        ? createPortal(
            <span
              role="tooltip"
              className="pointer-events-none fixed z-[200] -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-md bg-neutral-900 px-2 py-1 text-[11px] font-medium text-white shadow-sm"
              style={{ left: tip.left, top: tip.top }}
            >
              {label}
            </span>,
            document.body,
          )
        : null}
    </span>
  );
}

function smsAppHref(phone: string, body: string): string {
  const digits = phone.replace(/[^\d+]/g, "");
  const text = body.trim();
  if (!text) return `sms:${digits}`;
  return `sms:${digits}?body=${encodeURIComponent(text)}`;
}

/** Opens the device SMS app. The CRM row is written only after the user confirms it was sent. */
export function SmsSendDialog({
  displayName,
  phone,
  initialMessage = "",
  onClose,
  onConfirmSent,
}: {
  displayName: string;
  phone: string | null;
  initialMessage?: string;
  onClose: () => void;
  onConfirmSent: (body: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [message, setMessage] = useState(initialMessage);
  const [opened, setOpened] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const digits = phone?.replace(/[^\d+]/g, "") ?? "";

  const openSmsApp = () => {
    const text = message.trim();
    if (!digits || !text) return;
    const link = document.createElement("a");
    link.href = smsAppHref(digits, text);
    link.rel = "noopener";
    link.click();
    setOpened(true);
    setError(null);
  };

  const saveSent = () => {
    const text = message.trim();
    if (!text || !opened) return;
    setPending(true);
    setError(null);
    void onConfirmSent(text).then((result) => {
      setPending(false);
      if (!result.ok) {
        setError(result.error || "Could not save the SMS activity.");
        return;
      }
      onClose();
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-2xl border border-border-default bg-surface p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-text-primary">Send SMS</h3>
        <p className="mt-1 text-sm text-text-caption">
          {digits
            ? `${displayName} · ${phone}`
            : "This contact has no phone number."}
        </p>
        {digits ? (
          <div className="mt-4 grid gap-3">
            <Textarea
              label="Message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Write the text you will send…"
              rows={4}
              required
            />
            <p className="text-xs text-text-caption">
              Open the messages app and send it. The activity is saved only after you confirm it was sent.
            </p>
            {error ? <p className="text-sm text-text-danger">{error}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                disabled={pending || !message.trim()}
                onClick={openSmsApp}
              >
                Open messages
              </Button>
              <Button
                variant="primary"
                disabled={pending || !opened || !message.trim()}
                onClick={saveSent}
              >
                {pending ? "Saving…" : "SMS was sent"}
              </Button>
              <Button variant="secondary" disabled={pending} onClick={onClose}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-4">
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

function QuickActionDialog({
  mode,
  contactId,
  dealId = null,
  displayName,
  email,
  onClose,
  onChanged,
}: {
  mode: "note" | "schedule";
  contactId: string;
  dealId?: string | null;
  displayName: string;
  email: string;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [when, setWhen] = useState("");
  const [integrationsLoading, setIntegrationsLoading] = useState(true);
  const [integrationsLoadError, setIntegrationsLoadError] = useState<string | null>(
    null,
  );
  const [topic, setTopic] = useState("");
  const [participants, setParticipants] = useState<string[]>([]);
  const [meetingProvider, setMeetingProvider] =
    useState<MeetingProvider>("google_meet");
  const [integrations, setIntegrations] = useState<{
    googleConfigured: boolean;
    googleConnected: boolean;
    googleCanSendMail: boolean;
    googleCanScheduleMeetings: boolean;
    googleEmail: string | null;
    canSendMail: boolean;
    zoomConfigured: boolean;
    teamsConfigured: boolean;
  } | null>(null);

  useEffect(() => {
    if (mode !== "schedule") return;
    let cancelled = false;
    setIntegrationsLoading(true);
    setIntegrationsLoadError(null);
    void fetchEmailIntegrations()
      .then((data) => {
        if (cancelled) return;
        setIntegrations(data);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setIntegrations(null);
        setIntegrationsLoadError(
          err instanceof Error
            ? err.message
            : "Could not load email settings — is the API running?",
        );
      })
      .finally(() => {
        if (!cancelled) setIntegrationsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [mode]);

  if (mode === "note") {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
        role="dialog"
        aria-modal="true"
        onClick={onClose}
      >
        <div
          className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-border-default bg-surface p-5 shadow-lg"
          onClick={(e) => e.stopPropagation()}
        >
          <h3 className="text-base font-semibold text-text-primary">Add note</h3>
          <p className="mt-1 text-sm text-text-caption">{displayName}</p>
          <div className="mt-4">
            <NoteComposer
              pending={pending}
              error={error}
              submitLabel="Save note"
              onCancel={onClose}
              onSubmit={(encodedBody) => {
                setError(null);
                setPending(true);
                void (dealId
                  ? createDealActivity(dealId, {
                      type: "note",
                      subject: "",
                      body: encodedBody,
                    })
                  : createContactActivity(contactId, {
                      type: "note",
                      subject: "",
                      body: encodedBody,
                    })
                ).then((result) => {
                  setPending(false);
                  if (!result.ok) {
                    setError(result.error);
                    return;
                  }
                  onChanged?.();
                  onClose();
                });
              }}
            />
          </div>
        </div>
      </div>
    );
  }

  const scheduleReady =
    meetingProvider === "google_meet"
      ? Boolean(integrations?.googleCanScheduleMeetings)
      : Boolean(integrations?.canSendMail);
  const providerReady =
    meetingProvider === "google_meet" ||
    (meetingProvider === "zoom" && integrations?.zoomConfigured) ||
    (meetingProvider === "teams" && integrations?.teamsConfigured);
  const integrationsLoaded = !integrationsLoading && integrations !== null;
  const canSchedule =
    Boolean(when) &&
    integrationsLoaded &&
    scheduleReady &&
    providerReady &&
    Boolean(email);

  const onSave = () => {
    setError(null);
    if (integrationsLoading) {
      setError("Still checking your Google / email connection. Try again in a moment.");
      return;
    }
    if (integrationsLoadError) {
      setError(integrationsLoadError);
      return;
    }
    if (!when) {
      setError("Pick a date and time.");
      return;
    }
    if (!email) {
      setError("This contact needs an email address.");
      return;
    }
    if (!scheduleReady) {
      setError(
        meetingProvider === "google_meet"
          ? integrations?.googleConnected && integrations?.googleCanSendMail
            ? "Reconnect Google in Configuration → Email to grant Calendar access for Google Meet."
            : "Connect Google in Configuration → Email to schedule Google Meet."
          : "Connect an email account (Google or Microsoft) in Configuration → Email to send the invite.",
      );
      return;
    }
    if (!providerReady) {
      setError(
        meetingProvider === "zoom"
          ? "Zoom is not configured on the server. Ask your admin to add Zoom API credentials."
          : "Microsoft Teams is not configured on the server. Ask your admin to add Microsoft Graph credentials.",
      );
      return;
    }

    setPending(true);
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    void scheduleMeeting({
      contactId,
      when,
      whenIso: new Date(when).toISOString(),
      timeZone,
      topic: topic.trim() || undefined,
      durationMinutes: 30,
      participants: participants.length > 0 ? participants.join(", ") : undefined,
      participantEmails: participants,
      meetingProvider,
    })
      .then((result) => {
        if (!result?.ok) {
          setError(
            result?.needsConnect
              ? `${result.error || "Could not schedule."} Open Configuration → Email.`
              : result?.error || "Could not schedule meeting.",
          );
          return;
        }
        if (!result.confirmationSent) {
          setError(
            result.emailError ||
              "Meeting saved on your calendar, but the invite email could not be sent.",
          );
          onChanged?.();
          return;
        }
        if (result.warning) {
          setError(result.warning);
          onChanged?.();
          return;
        }
        onChanged?.();
        onClose();
      })
      .catch((err: unknown) => {
        const msg =
          err instanceof Error
            ? err.message
            : "Network error — check that the API is running on port 4000.";
        setError(msg);
      })
      .finally(() => {
        setPending(false);
      });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl border border-border-default bg-surface p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-text-primary">
          Schedule meeting
        </h3>
        <p className="mt-1 text-sm text-text-caption">{displayName}</p>

        <div className="mt-4 grid gap-3">
          <DateTimeLocalInput
            label="When"
            value={when}
            onChange={setWhen}
            emptyHint="Pick date & time"
          />
          <p className="-mt-1 text-xs text-text-caption">
            Choose when the meeting starts (must be in the future).
          </p>
          <Input
            label="Topic (optional)"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Demo, discovery call…"
          />

          <div className="flex w-full flex-col gap-2">
            <span className="text-sm font-medium text-text-primary">
              Meeting platform
            </span>
            <div className="grid grid-cols-3 gap-2">
              {MEETING_PROVIDERS.map((provider) => {
                const disabled =
                  pending ||
                  (provider === "zoom" && !integrations?.zoomConfigured) ||
                  (provider === "teams" && !integrations?.teamsConfigured);
                const active = meetingProvider === provider;
                return (
                  <button
                    key={provider}
                    type="button"
                    disabled={disabled}
                    onClick={() => setMeetingProvider(provider)}
                    className={`rounded-lg border px-2 py-2.5 text-xs font-medium transition-colors ${
                      active
                        ? "border-brand bg-violet-0 text-brand"
                        : "border-border-default bg-surface text-text-secondary hover:bg-subtle"
                    } ${disabled ? "cursor-not-allowed opacity-45" : ""}`}
                  >
                    {meetingProviderLabel(provider)}
                  </button>
                );
              })}
            </div>
            {meetingProvider === "zoom" && !integrations?.zoomConfigured ? (
              <p className="text-xs text-text-caption">
                Zoom requires server credentials (ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID,
                ZOOM_CLIENT_SECRET).
              </p>
            ) : null}
            {meetingProvider === "teams" && !integrations?.teamsConfigured ? (
              <p className="text-xs text-text-caption">
                Teams requires Microsoft Graph credentials on the server.
              </p>
            ) : null}
          </div>

          <MeetingParticipantsField
            primaryEmail={email}
            primaryLabel={displayName}
            emails={participants}
            onEmailsChange={setParticipants}
            disabled={pending}
          />

          <div className="rounded-xl border border-border-default bg-subtle/40 p-3 text-sm text-text-secondary">
            <p className="text-xs font-medium tracking-wide text-text-caption uppercase">
              Notifications
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-text-caption">
              <li>Saved on your Worktual calendar</li>
              <li>
                {meetingProvider === "google_meet"
                  ? "Google Calendar invite with Google Meet link"
                  : integrations?.googleCanScheduleMeetings
                    ? `Invite via Google Calendar with ${meetingProviderLabel(meetingProvider)} link (if Google is connected)`
                    : `Invite email with ${meetingProviderLabel(meetingProvider)} link via your connected email`}
              </li>
              {participants.length > 0 ? (
                <li>Additional participants are included on the invite</li>
              ) : null}
              <li>
                CRM reminds you (AI brief) and every CRM contact/lead participant
                at 24 hours and 1 hour before
              </li>
            </ul>
            {integrationsLoading ? (
              <p className="mt-2 text-xs text-text-caption">
                Checking email & calendar connection…
              </p>
            ) : integrationsLoadError ? (
              <p className="mt-2 text-xs text-text-danger">{integrationsLoadError}</p>
            ) : scheduleReady ? (
              <p className="mt-2 text-xs text-text-caption">
                {meetingProvider === "google_meet"
                  ? "Using Google for Meet + Calendar"
                  : "Email invites use your connected Google or Microsoft account"}
                {integrations?.googleEmail ? ` · Google: ${integrations.googleEmail}` : null}
              </p>
            ) : (
              <p className="mt-2 text-xs text-text-danger">
                {meetingProvider === "google_meet"
                  ? integrations?.googleConnected && integrations?.googleCanSendMail
                    ? "Reconnect Google in Configuration → Email to grant Calendar access for Meet."
                    : "Connect Google (with Calendar) for Meet."
                  : "Connect any email account in Configuration → Email."}{" "}
                <a
                  href="/configuration/email"
                  className="font-medium text-text-link hover:underline"
                >
                  Open Email settings
                </a>
              </p>
            )}
          </div>
        </div>

        {error ? <p className="mt-3 text-sm text-text-danger">{error}</p> : null}

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            onClick={onSave}
            disabled={pending || !canSchedule}
          >
            {pending
              ? "Saving…"
              : integrationsLoading
                ? "Checking connection…"
                : !when
                  ? "Pick date & time"
                  : scheduleReady && providerReady
                    ? "Schedule & send invite"
                    : "Connect email to schedule"}
          </Button>
        </div>
      </div>
    </div>
  );
}
