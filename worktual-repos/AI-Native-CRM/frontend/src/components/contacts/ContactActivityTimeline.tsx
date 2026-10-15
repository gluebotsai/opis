import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Calendar, Check, Plus, User, X } from "lucide-react";
import {
  ActivityTypeBadge,
  ActivityTypeIcon,
  ACTIVITY_TYPE_LABELS,
  ACTIVITY_TYPE_OPTIONS,
} from "@/lib/activity-type-style";
import { ScheduleMeetingDialog, SmsSendDialog } from "@/components/contacts/ContactQuickActions";
import { CallLogDialog } from "@/components/email/CallLogDialog";
import { CALL_LOGGED_EVENT } from "@/lib/call-logged-event";
import { EmailComposeDialog } from "@/components/email/EmailComposeDialog";
import { NoteComposer } from "@/components/contacts/NoteComposer";
import { NoteActivityDetails } from "@/components/contacts/NoteActivityDetails";
import { MeetingActivityDetails } from "@/components/contacts/MeetingActivityDetails";
import { CallActivityDetails } from "@/components/contacts/CallActivityDetails";
import { DispositionTag } from "@/components/contacts/DispositionTag";
import { RichStructuredContent } from "@/components/content/RichStructuredContent";
import { Button } from "@/components/ui/Button";
import { ConfirmDeleteButton } from "@/components/ui/ConfirmDeleteButton";
import { DateTimeLocalInput } from "@/components/ui/DateTimeLocalInput";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import {
  deriveTaskDisplayStatus,
  TASK_DISPLAY_STATUS_LABELS,
} from "@/lib/task-status";
import {
  createContactActivity,
  deleteActivity as deleteContactActivity,
  updateTaskStatus,
} from "@/services/contacts";
import { deleteDealActivity } from "@/services/sales";
import {
  EmailBodyContent,
} from "@/components/inbox/EmailBodyContent";
import {
  isManuallyLoggedCall,
  sanitizeActivityDisplayText,
} from "@/lib/activity-display";
import { normalizeEmailDisplayText } from "@/lib/email-body";

const ACTIVITY_FILTER_OPTIONS = [
  { value: "all", label: "All activities" },
  ...ACTIVITY_TYPE_OPTIONS,
];

export type ContactActivityRow = {
  id: string;
  type: string;
  subject: string;
  body: string | null;
  dueAt: string | null;
  assigneeUserId?: string | null;
  taskStatus?: "open" | "in_progress" | "completed" | "cancelled" | null;
  completedAt?: string | null;
  createdAt: string;
  transcriptText?: string | null;
  transcriptSource?: string | null;
  disposition?: string | null;
};

export type RelatedDealActivityRow = {
  id: string;
  dealId: string;
  dealTitle: string;
  type: string;
  subject: string;
  body: string | null;
  dueAt: string | null;
  createdAt: string;
};

type TimelineItem =
  | (ContactActivityRow & {
      source: "contact";
      rowKey: string;
    })
  | (RelatedDealActivityRow & {
      source: "deal";
      rowKey: string;
      assigneeUserId?: null;
      taskStatus?: null;
    });

export type AssigneeOption = {
  id: string;
  label: string;
};

export function ContactActivityTimeline({
  contactId,
  displayName,
  email,
  phone = null,
  activities,
  relatedDealActivities = [],
  assignableUsers = [],
  currentUserId = null,
  canAssignAssignee = false,
  onChanged,
  focusActivityId = null,
  lockedType = null,
  title = "Activity",
  embedded = false,
  suppressEmptyState = false,
  leadingContent,
}: {
  contactId: string;
  displayName: string;
  email: string;
  phone?: string | null;
  activities: ContactActivityRow[];
  relatedDealActivities?: RelatedDealActivityRow[];
  assignableUsers?: AssigneeOption[];
  currentUserId?: string | null;
  canAssignAssignee?: boolean;
  onChanged?: () => void;
  /** Scroll this contact activity into view after the list renders. */
  focusActivityId?: string | null;
  /** When set, the list stays on this type and the filter control is hidden. */
  lockedType?: string | null;
  title?: string;
  /** Drop the page-grid span so the timeline can sit inside a tab. */
  embedded?: boolean;
  /** Skip the "nothing here yet" row when the caller already shows content. */
  suppressEmptyState?: boolean;
  /** Rendered under the heading, above the list. Keeps one section, one header. */
  leadingContent?: ReactNode;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [specialDialog, setSpecialDialog] = useState<
    "meeting" | "call" | "email" | "sms" | null
  >(null);
  const [activityTypeFilter, setActivityTypeFilter] = useState<string>(
    lockedType ?? "all",
  );

  // A finished call writes its own activity server-side, so nothing here knows
  // about it. Refetch when the call reports it ended, or the call log only
  // turns up on the next page load.
  const onChangedRef = useRef(onChanged);
  useEffect(() => {
    onChangedRef.current = onChanged;
  }, [onChanged]);
  useEffect(() => {
    const refetch = () => onChangedRef.current?.();
    window.addEventListener(CALL_LOGGED_EVENT, refetch);
    return () => window.removeEventListener(CALL_LOGGED_EVENT, refetch);
  }, []);

  const timelineItems: TimelineItem[] = [
    ...activities.map((activity) => ({
      ...activity,
      source: "contact" as const,
      rowKey: `contact-${activity.id}`,
    })),
    ...relatedDealActivities.map((activity) => ({
      ...activity,
      source: "deal" as const,
      rowKey: `deal-${activity.id}`,
      assigneeUserId: null,
      taskStatus: null,
    })),
  ].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const filteredActivities =
    activityTypeFilter === "all"
      ? timelineItems
      : timelineItems.filter((activity) => activity.type === activityTypeFilter);

  useEffect(() => {
    if (!focusActivityId) return;
    const node = document.getElementById(`contact-activity-${focusActivityId}`);
    if (node) {
      node.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    if (activityTypeFilter !== "all" && !lockedType) {
      setActivityTypeFilter("all");
    }
  }, [focusActivityId, activityTypeFilter, lockedType, filteredActivities.length]);

  const assigneeLabel = (id: string | null | undefined) => {
    if (!id) return null;
    return assignableUsers.find((u) => u.id === id)?.label ?? "Assigned user";
  };

  const onAdd = (input: {
    type: string;
    subject: string;
    body?: string | null;
    dueAt?: string | null;
    assigneeUserId?: string | null;
  }) => {
    setError(null);
    setPending(true);
    void createContactActivity(contactId, input).then((result) => {
      setPending(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setOpen(false);
      setError(null);
      onChanged?.();
    });
  };

  const onCompleteTask = (activityId: string) => {
    setPending(true);
    void updateTaskStatus(activityId, "completed").then((result) => {
      setPending(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onChanged?.();
    });
  };

  return (
    <section
      className={`rounded-xl border border-border-default bg-surface p-6 ${
        embedded ? "" : "lg:col-span-2"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-text-primary">{title}</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {lockedType ? null : (
            <div className="w-[11.5rem]">
              <Select
                value={activityTypeFilter}
                onChange={(e) => setActivityTypeFilter(e.target.value)}
                options={ACTIVITY_FILTER_OPTIONS}
                aria-label="Filter activities by type"
                className="h-10"
              />
            </div>
          )}
          <Button
            type="button"
            variant="primary"
            onClick={() => {
              setError(null);
              setOpen(true);
            }}
          >
            <Plus className="size-4" strokeWidth={2} />
            Log activity
          </Button>
        </div>
      </div>

      {error && !open ? (
        <p className="mt-3 text-sm text-text-danger" role="alert">
          {error}
        </p>
      ) : null}

      {leadingContent ? <div className="mt-4">{leadingContent}</div> : null}

      {suppressEmptyState && filteredActivities.length === 0 ? null : (
      <ul className="mt-5 divide-y divide-border-default overflow-hidden rounded-xl border border-border-default">
        {timelineItems.length === 0 ? (
          <li className="px-5 py-8 text-center text-sm text-text-caption">
            {lockedType === "task"
              ? "No tasks yet."
              : "No activities yet. Use quick actions or log one."}
          </li>
        ) : filteredActivities.length === 0 ? (
          <li className="px-5 py-8 text-center text-sm text-text-caption">
            {lockedType === "task"
              ? "No tasks yet."
              : `No ${(ACTIVITY_TYPE_LABELS[activityTypeFilter] ?? activityTypeFilter).toLowerCase()} activities for this filter.`}
          </li>
        ) : (
          filteredActivities.map((activity) => {
            const displayStatus =
              activity.source === "contact"
                ? deriveTaskDisplayStatus(activity.taskStatus, activity.dueAt)
                : null;
            return (
              <li
                key={activity.rowKey}
                id={
                  activity.source === "contact"
                    ? `contact-activity-${activity.id}`
                    : undefined
                }
                className={`flex scroll-mt-24 items-start justify-between gap-4 px-5 py-4 ${
                  focusActivityId && activity.id === focusActivityId
                    ? "rounded-md bg-neutral-50 ring-1 ring-neutral-300"
                    : ""
                }`}
              >
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <ActivityTypeIcon type={activity.type} className="mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <ActivityTypeBadge
                        type={activity.type}
                        label={
                          activity.source === "contact" &&
                          isManuallyLoggedCall({
                            type: activity.type,
                            subject: activity.subject,
                            transcriptSource: activity.transcriptSource,
                          })
                            ? "Logged call"
                            : undefined
                        }
                      />
                      {displayStatus ? (
                        <span
                          className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                            displayStatus === "completed"
                              ? "bg-emerald-50 text-emerald-700"
                              : displayStatus === "overdue"
                                ? "bg-red-50 text-red-700"
                                : displayStatus === "in_progress"
                                  ? "bg-amber-50 text-amber-800"
                                  : "bg-neutral-100 text-text-secondary"
                          }`}
                        >
                          {TASK_DISPLAY_STATUS_LABELS[displayStatus]}
                        </span>
                      ) : null}
                      <span className="text-xs text-text-caption">
                        {new Date(activity.createdAt).toLocaleString()}
                      </span>
                      {activity.source === "contact" ? (
                        <DispositionTag label={activity.disposition} />
                      ) : null}
                    </div>
                    {activity.type === "note" ? (
                      <NoteActivityDetails body={activity.body || activity.subject} />
                    ) : activity.type === "meeting" ? (
                      <MeetingActivityDetails
                        activityId={activity.id}
                        contactId={contactId}
                        subject={activity.subject}
                        body={activity.body}
                        dueAt={activity.dueAt}
                        disposition={
                          activity.source === "contact" ? activity.disposition : null
                        }
                        superseded={Boolean(
                          activity.source === "contact" && activity.completedAt,
                        )}
                      />
                    ) : activity.type === "call" && activity.source === "contact" ? (
                      <CallActivityDetails
                        activityId={activity.id}
                        subject={activity.subject}
                        body={activity.body}
                        transcriptText={activity.transcriptText}
                        transcriptSource={activity.transcriptSource}
                        contactDisplayName={displayName}
                        disposition={activity.disposition}
                      />
                    ) : activity.type === "email" ? (
                      <>
                        <p className="mt-1.5 text-sm font-medium text-text-primary">
                          {normalizeEmailDisplayText(activity.subject)}
                        </p>
                        {activity.source === "contact" ? (
                          <div className="mt-1.5">
                            <DispositionTag label={activity.disposition} />
                          </div>
                        ) : null}
                        <div className="mt-1 min-w-0 w-full">
                          <EmailBodyContent
                            text={activity.body ?? ""}
                            subject={normalizeEmailDisplayText(activity.subject)}
                          />
                        </div>
                      </>
                    ) : (
                      <>
                        <p className="mt-1.5 text-sm font-medium text-text-primary">
                          {sanitizeActivityDisplayText(activity.subject)}
                        </p>
                        {activity.type === "sms" && activity.source === "contact" ? (
                          <div className="mt-1.5">
                            <DispositionTag label={activity.disposition} />
                          </div>
                        ) : null}
                        {activity.body ? (
                          <RichStructuredContent
                            className="mt-1.5"
                            text={sanitizeActivityDisplayText(activity.body)}
                            variant="feed"
                          />
                        ) : null}
                      </>
                    )}
                    {activity.type === "task" && activity.source === "contact" ? (
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-caption">
                        {activity.dueAt ? (
                          <span className="inline-flex items-center gap-1.5">
                            <Calendar
                              className="size-3.5 shrink-0 text-text-secondary"
                              strokeWidth={1.75}
                              aria-hidden
                            />
                            <span>
                              <span className="font-medium text-text-secondary">
                                Due
                              </span>{" "}
                              {new Date(activity.dueAt).toLocaleString()}
                            </span>
                          </span>
                        ) : null}
                        {assigneeLabel(activity.assigneeUserId) ? (
                          <span className="inline-flex items-center gap-1.5">
                            <User
                              className="size-3.5 shrink-0 text-text-secondary"
                              strokeWidth={1.75}
                              aria-hidden
                            />
                            <span>
                              <span className="font-medium text-text-secondary">
                                Assignee
                              </span>{" "}
                              {assigneeLabel(activity.assigneeUserId)}
                            </span>
                          </span>
                        ) : null}
                      </div>
                    ) : activity.type !== "meeting" &&
                      activity.type !== "note" &&
                      activity.type !== "call" &&
                      activity.dueAt ? (
                      <p className="mt-1 inline-flex items-center gap-1.5 text-xs text-text-caption">
                        <Calendar
                          className="size-3.5 shrink-0 text-text-secondary"
                          strokeWidth={1.75}
                          aria-hidden
                        />
                        Due {new Date(activity.dueAt).toLocaleString()}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  {activity.source === "contact" &&
                  activity.type === "task" &&
                  activity.taskStatus !== "completed" ? (
                    <Button
                      variant="secondary"
                      className="text-xs"
                      disabled={pending}
                      onClick={() => onCompleteTask(activity.id)}
                    >
                      <Check className="size-3.5" strokeWidth={2} />
                      Complete
                    </Button>
                  ) : null}
                  <ConfirmDeleteButton
                    name={activity.subject}
                    entityLabel="activity"
                    compact
                    confirmLabel="Remove activity"
                    consequence={
                      activity.source === "deal"
                        ? "This permanently removes the activity from the deal."
                        : "This permanently removes the activity from this contact."
                    }
                    disabled={pending}
                    onConfirm={async () => {
                      if (activity.source === "deal") {
                        const result = await deleteDealActivity(
                          activity.dealId,
                          activity.id,
                        );
                        if (!result.ok) {
                          return {
                            ok: false,
                            error: result.error ?? "Failed to delete activity.",
                          };
                        }
                        return { ok: true };
                      }
                      const result = await deleteContactActivity(
                        contactId,
                        activity.id,
                      );
                      if (!result.ok) {
                        return {
                          ok: false,
                          error: result.error ?? "Failed to delete activity.",
                        };
                      }
                      return { ok: true };
                    }}
                    onSuccess={() => onChanged?.()}
                  />
                </div>
              </li>
            );
          })
        )}
      </ul>
      )}

      {open ? (
        <LogActivityDialog
          pending={pending}
          error={error}
          assignableUsers={assignableUsers}
          currentUserId={currentUserId}
          canAssignAssignee={canAssignAssignee}
          onClose={() => {
            if (pending) return;
            setOpen(false);
            setError(null);
          }}
          onSpecialType={(type) => {
            setOpen(false);
            setError(null);
            setSpecialDialog(type);
          }}
          onSubmit={onAdd}
        />
      ) : null}

      {specialDialog === "meeting" ? (
        <ScheduleMeetingDialog
          contactId={contactId}
          displayName={displayName}
          email={email}
          onClose={() => setSpecialDialog(null)}
          onChanged={onChanged}
        />
      ) : null}

      {specialDialog === "call" ? (
        <CallLogDialog
          initialContact={{
            id: contactId,
            displayName,
            email,
            phone,
          }}
          initialPhone={phone ?? ""}
          onClose={() => setSpecialDialog(null)}
          onLogged={onChanged}
        />
      ) : null}

      {specialDialog === "email" ? (
        <EmailComposeDialog
          initialContact={{
            id: contactId,
            displayName,
            email,
            phone,
          }}
          initialTo={email}
          onClose={() => setSpecialDialog(null)}
          onSent={onChanged}
        />
      ) : null}

      {specialDialog === "sms" ? (
        <SmsSendDialog
          displayName={displayName}
          phone={phone ?? null}
          onClose={() => setSpecialDialog(null)}
          onConfirmSent={async (body) => {
            const result = await createContactActivity(contactId, {
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
      ) : null}
    </section>
  );
}

function LogActivityDialog({
  pending,
  error,
  assignableUsers,
  currentUserId,
  canAssignAssignee,
  onClose,
  onSpecialType,
  onSubmit,
}: {
  pending: boolean;
  error: string | null;
  assignableUsers: AssigneeOption[];
  currentUserId: string | null;
  canAssignAssignee: boolean;
  onClose: () => void;
  onSpecialType: (type: "meeting" | "call" | "email" | "sms") => void;
  onSubmit: (input: {
    type: string;
    subject: string;
    body?: string | null;
    dueAt?: string | null;
    assigneeUserId?: string | null;
  }) => void;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [type, setType] = useState("note");
  const [dueAt, setDueAt] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [assigneeUserId, setAssigneeUserId] = useState(
    () =>
      (currentUserId && assignableUsers.some((u) => u.id === currentUserId)
        ? currentUserId
        : assignableUsers[0]?.id) ?? "",
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>("select, input, textarea")?.focus();
  }, []);

  const isNote = type === "note";
  const isTask = type === "task";

  const submitNonNote = () => {
    if (isTask) {
      if (!subject.trim() || !dueAt || !body.trim()) return;
      onSubmit({
        type,
        subject: subject.trim(),
        body: body.trim(),
        dueAt: new Date(dueAt).toISOString(),
        assigneeUserId: canAssignAssignee ? assigneeUserId : null,
      });
      return;
    }
    if (!subject.trim()) return;
    onSubmit({
      type,
      subject: subject.trim(),
      body: body.trim() || null,
      dueAt: dueAt ? new Date(dueAt).toISOString() : null,
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-xl rounded-xl border border-border-default bg-surface p-5 shadow-lg"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 id={titleId} className="text-base font-semibold text-text-primary">
              Log activity
            </h3>
            <p className="mt-1 text-sm text-text-caption">
              {isNote
                ? "Write a formatted note and attach files. Notes stay on this contact."
                : isTask
                  ? "Tasks need a title, due date, and description."
                  : "Add a call, meeting, email, note, or task to this contact."}
            </p>
          </div>
          <button
            type="button"
            aria-label="Close"
            className="inline-flex size-9 items-center justify-center rounded-lg text-text-caption hover:bg-subtle hover:text-text-primary"
            onClick={onClose}
            disabled={pending}
          >
            <X className="size-4" strokeWidth={1.75} />
          </button>
        </div>

        <div className="mt-5">
          <Select
            label="Type"
            name="type"
            value={type}
            onChange={(e) => {
              const next = e.target.value;
              if (
                next === "meeting" ||
                next === "call" ||
                next === "email" ||
                next === "sms"
              ) {
                onSpecialType(next);
                return;
              }
              setType(next);
            }}
            options={ACTIVITY_TYPE_OPTIONS}
          />

          {isNote ? (
            <div className="mt-3">
              <NoteComposer
                pending={pending}
                error={error}
                submitLabel="Save note"
                onCancel={onClose}
                onSubmit={(encodedBody) => {
                  onSubmit({ type: "note", subject: "", body: encodedBody });
                }}
              />
            </div>
          ) : (
            <div className="mt-3">
              {isTask ? (
                <div className="grid gap-3">
                  <Input
                    label="Task title"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    required
                    placeholder="Follow up on proposal…"
                  />
                  <DateTimeLocalInput
                    label="Due date"
                    value={dueAt}
                    onChange={setDueAt}
                  />
                  {canAssignAssignee ? (
                    <Select
                      label="Assignee"
                      value={assigneeUserId}
                      onChange={(e) => setAssigneeUserId(e.target.value)}
                      options={assignableUsers.map((u) => ({
                        value: u.id,
                        label: u.label,
                      }))}
                    />
                  ) : null}
                  <Textarea
                    label="Description"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                    required
                    placeholder="What needs to be done…"
                    rows={3}
                  />
                </div>
              ) : (
                <div className="grid gap-3">
                  <DateTimeLocalInput
                    label="Due at (optional)"
                    value={dueAt}
                    onChange={setDueAt}
                  />
                  <Input
                    label="Subject"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    required
                  />
                  <Textarea
                    label="Details"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                  />
                </div>
              )}

              {error ? (
                <p className="mt-3 text-sm text-text-danger" role="alert">
                  {error}
                </p>
              ) : null}
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  disabled={pending}
                  onClick={onClose}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  disabled={pending}
                  onClick={submitNonNote}
                >
                  {pending ? "Saving…" : isTask ? "Create task" : "Log activity"}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
