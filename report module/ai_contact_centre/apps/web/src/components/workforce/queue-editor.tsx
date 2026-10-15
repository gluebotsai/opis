import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { LoaderCircle } from "lucide-react";

import { contactInputClassName } from "@/components/contacts/contact-form-fields";
import { QueueStaffingForm } from "@/components/workforce/queue-staffing-form";
import { formatShownContactName } from "@/features/contacts/contacts-utils";
import { profileAvatarClassName, profileInitials } from "@/lib/avatar-utils";
import { queuesApi } from "@/features/workforce/queues/api";
import {
  ASSISTANT_QUEUE_DRAFT_APPLY,
  useQueueDraft,
} from "@/features/workforce/queues/queue-draft-context";
import { StatusToggle } from "@/features/workforce/queues/status-toggle";
import {
  formatClock,
  type BusinessHourShift,
  type BusinessHours,
  type EligibleAgent,
  type Queue,
  type QueueAgent,
  type QueueStatus,
  type ShiftType,
  type Team,
  MISSED_CALLBACK_GRACE_OPTIONS,
  graceMinutesToOption,
  optionToGraceMinutes,
  type MissedCallbackGraceOptionValue,
} from "@/features/workforce/queues/types";
import { cn } from "@/lib/utils";
import { NativeSelect, nativeSelectClassName } from "@/components/ui/native-select";
import { StatusBanner } from "@/components/ui/status-banner";

function FormSection({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border-[0.6px] border-[#bfbfbf] bg-white px-5 py-5">
      <div>
        <h3 className="text-base font-semibold text-neutral-900">{title}</h3>
        <p className="mt-1 text-sm text-neutral-600">{description}</p>
      </div>
      <div className="mt-4 w-full">{children}</div>
    </section>
  );
}

const fieldGroupClassName = "grid w-full gap-[16px]";
const selectClassName =
  "h-[38px] rounded-lg bg-white text-neutral-800 focus:ring-2 focus:ring-neutral-200";

function FieldLabel({
  children,
  required,
}: {
  children: ReactNode;
  required?: boolean;
}) {
  return (
    <span className="flex items-center gap-1.5 text-sm font-medium text-neutral-900">
      {children}
      {required ? <span className="text-red-500">*</span> : null}
    </span>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  placeholder,
  required,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label htmlFor={id} className="block min-w-0 space-y-2">
      <FieldLabel required={required}>{label}</FieldLabel>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        className={contactInputClassName}
      />
    </label>
  );
}

type FormState = {
  name: string;
  description: string;
  teamId: string;
  businessHoursId: string;
  shiftTypes: ShiftType[];
  skills: string[];
  status: QueueStatus;
  missedCallbackGrace: MissedCallbackGraceOptionValue;
  agents: QueueAgent[];
};

function formStateFromQueue(queue: Queue): FormState {
  return {
    name: queue.name,
    description: queue.description ?? "",
    teamId: queue.teamId,
    businessHoursId: queue.businessHoursId ?? "",
    shiftTypes: queue.shiftTypes,
    skills: queue.skills ?? [],
    status: queue.status,
    missedCallbackGrace: graceMinutesToOption(queue.missedCallbackGraceMinutes),
    agents: queue.agents,
  };
}

export type QueueEditorHandle = {
  save: () => Promise<void>;
  saving: boolean;
};

type QueueEditorProps = {
  queueId?: string;
  mode?: "create" | "edit";
  embedded?: boolean;
  onSaved?: (queueId: string) => void;
  onQueueNameChange?: (name: string) => void;
  onDirtyChange?: (dirty: boolean) => void;
};

export const QueueEditor = forwardRef<QueueEditorHandle, QueueEditorProps>(
  function QueueEditor(
    { queueId, mode = queueId ? "edit" : "create", embedded = false, onSaved, onQueueNameChange, onDirtyChange },
    ref,
  ) {
    const isCreate = mode === "create";
    const { draft, setDraft } = useQueueDraft();
    const [teams, setTeams] = useState<Team[]>([]);
    const [schedules, setSchedules] = useState<BusinessHours[]>([]);
    const [eligibleAgents, setEligibleAgents] = useState<EligibleAgent[]>([]);
    const [form, setForm] = useState<FormState>({
      name: "",
      description: "",
      teamId: "",
      businessHoursId: "",
      shiftTypes: [],
      skills: [],
      status: "active",
      missedCallbackGrace: "off",
      agents: [],
    });
    const [initialSnapshot, setInitialSnapshot] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [activeShiftType, setActiveShiftType] = useState<ShiftType | null>(null);

    useEffect(() => {
      onQueueNameChange?.(form.name);
    }, [form.name, onQueueNameChange]);

    useEffect(() => {
      const snapshot = JSON.stringify(form);
      onDirtyChange?.(initialSnapshot !== "" && snapshot !== initialSnapshot);
    }, [form, initialSnapshot, onDirtyChange]);

    useEffect(() => {
      function onDraftApply(event: Event) {
        const detail = (event as CustomEvent<Partial<FormState>>).detail;
        if (!detail) return;
        setForm((prev) => ({
          ...prev,
          ...(detail.name !== undefined ? { name: detail.name } : {}),
          ...(detail.description !== undefined ? { description: detail.description } : {}),
          ...(detail.teamId !== undefined ? { teamId: detail.teamId } : {}),
          ...(detail.businessHoursId !== undefined
            ? { businessHoursId: detail.businessHoursId }
            : {}),
          ...(detail.shiftTypes !== undefined ? { shiftTypes: detail.shiftTypes } : {}),
          ...(detail.skills !== undefined ? { skills: detail.skills } : {}),
          ...(detail.status !== undefined ? { status: detail.status } : {}),
        }));
        if (detail.shiftTypes?.[0]) {
          setActiveShiftType(detail.shiftTypes[0]);
        }
      }
      window.addEventListener(ASSISTANT_QUEUE_DRAFT_APPLY, onDraftApply);
      return () => window.removeEventListener(ASSISTANT_QUEUE_DRAFT_APPLY, onDraftApply);
    }, []);

    useEffect(() => {
      if (!isCreate || loading || !draft.guided) return;
      setForm((prev) => ({
        ...prev,
        ...(draft.name !== undefined ? { name: draft.name } : {}),
        ...(draft.description !== undefined ? { description: draft.description } : {}),
        ...(draft.teamId !== undefined ? { teamId: draft.teamId } : {}),
        ...(draft.businessHoursId !== undefined
          ? { businessHoursId: draft.businessHoursId }
          : {}),
        ...(draft.shiftTypes !== undefined ? { shiftTypes: draft.shiftTypes } : {}),
        ...(draft.skills !== undefined ? { skills: draft.skills } : {}),
        ...(draft.status !== undefined ? { status: draft.status } : {}),
      }));
      if (draft.shiftTypes?.[0]) {
        setActiveShiftType(draft.shiftTypes[0]);
      }
    }, [draft, isCreate, loading]);

    useEffect(() => {
      if (!isCreate || loading || !draft.guided) return;
      setDraft({
        agentCount: form.agents.length,
        ...(form.agents.length > 0 && draft.step === "agents" ? { step: "review" as const } : {}),
      });
    }, [draft.guided, draft.step, form.agents.length, isCreate, loading, setDraft]);

    useEffect(() => {
      let cancelled = false;

      async function load() {
        setLoading(true);
        setError(null);
        try {
          const [teamsRes, agentsRes, hoursRes] = await Promise.all([
            queuesApi.listTeams(),
            queuesApi.listEligibleAgents(isCreate ? undefined : queueId),
            queuesApi.listBusinessHours(),
          ]);
          if (cancelled) return;
          setTeams(teamsRes.teams);
          setEligibleAgents(agentsRes.agents);
          setSchedules(hoursRes.schedules);

          if (isCreate) {
            const defaultTeam = teamsRes.teams[0];
            const defaultHoursId =
              defaultTeam?.businessHoursId || hoursRes.schedules[0]?.id || "";
            setForm({
              name: "",
              description: "",
              teamId: defaultTeam?.id || "",
              businessHoursId: defaultHoursId,
              shiftTypes: [],
              skills: [],
              status: "active",
              missedCallbackGrace: "off",
              agents: [],
            });
            setInitialSnapshot(
              JSON.stringify({
                name: "",
                description: "",
                teamId: defaultTeam?.id || "",
                businessHoursId: defaultHoursId,
                shiftTypes: [],
                skills: [],
                status: "active",
                agents: [],
              }),
            );
            setActiveShiftType(null);
          } else if (queueId) {
            const { queue } = await queuesApi.getQueue(queueId);
            if (cancelled) return;
            const nextForm = formStateFromQueue(queue);
            setForm(nextForm);
            setInitialSnapshot(JSON.stringify(nextForm));
            setActiveShiftType(queue.shiftTypes[0] ?? null);
          }
        } catch (err) {
          if (!cancelled) {
            setError(err instanceof Error ? err.message : "Failed to load queue");
          }
        } finally {
          if (!cancelled) setLoading(false);
        }
      }

      void load();
      return () => {
        cancelled = true;
      };
    }, [isCreate, queueId]);

    const selectedSchedule = useMemo(
      () => schedules.find((item) => item.id === form.businessHoursId) ?? null,
      [schedules, form.businessHoursId],
    );

    const availableShiftTypes = useMemo(() => {
      if (!selectedSchedule) return [];
      return uniqueShiftTypes(selectedSchedule.shifts.map((shift) => shift.shiftType));
    }, [selectedSchedule]);

    useEffect(() => {
      if (availableShiftTypes.length === 0) {
        if (activeShiftType !== null) setActiveShiftType(null);
        return;
      }
      if (!activeShiftType || !availableShiftTypes.includes(activeShiftType)) {
        setActiveShiftType(availableShiftTypes[0] ?? null);
      }
    }, [activeShiftType, availableShiftTypes]);

    const shiftsByType = useMemo(() => {
      const map = new Map<ShiftType, BusinessHourShift[]>();
      if (!selectedSchedule) return map;
      for (const shift of selectedSchedule.shifts) {
        const list = map.get(shift.shiftType) ?? [];
        list.push(shift);
        map.set(shift.shiftType, list);
      }
      return map;
    }, [selectedSchedule]);

    const agentsOnQueue = useMemo(
      () => new Set(form.agents.map((agent) => agent.userId)),
      [form.agents],
    );

    function onTeamChange(teamId: string) {
      const team = teams.find((item) => item.id === teamId);
      const nextHoursId = team?.businessHoursId || form.businessHoursId;
      setForm((prev) => {
        const nextShiftTypes = allShiftsForHours(schedules, nextHoursId);
        return {
          ...prev,
          teamId,
          businessHoursId: nextHoursId,
          shiftTypes: nextShiftTypes,
          agents: prev.agents.filter((agent) => nextShiftTypes.includes(agent.shiftType)),
        };
      });
      setActiveShiftType(null);
    }

    function onBusinessHoursChange(businessHoursId: string) {
      setForm((prev) => {
        const nextShiftTypes = allShiftsForHours(schedules, businessHoursId);
        return {
          ...prev,
          businessHoursId,
          shiftTypes: nextShiftTypes,
          agents: prev.agents.filter((agent) => nextShiftTypes.includes(agent.shiftType)),
        };
      });
      setActiveShiftType(null);
    }

    function onShiftSelect(shiftType: ShiftType) {
      if (!form.shiftTypes.includes(shiftType)) {
        setForm((prev) => ({
          ...prev,
          shiftTypes: [...prev.shiftTypes, shiftType],
        }));
      }
      setActiveShiftType(shiftType);
    }

    const save = useCallback(async () => {
      setSaving(true);
      setError(null);
      try {
        if (!form.name.trim()) {
          throw new Error("Queue name is required");
        }
        if (!form.teamId) {
          throw new Error("Team is required");
        }
        if (!form.businessHoursId) {
          throw new Error("Business hours are required");
        }
        const shiftTypesToSave = allShiftsForHours(schedules, form.businessHoursId);
        if (shiftTypesToSave.length === 0) {
          throw new Error("The selected hours template has no shifts");
        }
        const agentsToSave = form.agents.filter((agent) =>
          shiftTypesToSave.includes(agent.shiftType),
        );

        if (isCreate) {
          const { queue } = await queuesApi.createQueue({
            name: form.name.trim(),
            description: form.description,
            teamId: form.teamId,
            businessHoursId: form.businessHoursId,
            shiftTypes: shiftTypesToSave,
            skills: form.skills,
            status: form.status,
            missedCallbackGraceMinutes: optionToGraceMinutes(form.missedCallbackGrace),
          });
          if (agentsToSave.length > 0) {
            await queuesApi.replaceQueueAgents(queue.id, agentsToSave);
          }
          onSaved?.(queue.id);
          return;
        }

        if (!queueId) return;

        await queuesApi.updateQueue(queueId, {
          name: form.name.trim(),
          description: form.description,
          teamId: form.teamId,
          businessHoursId: form.businessHoursId,
          shiftTypes: shiftTypesToSave,
          skills: form.skills,
          status: form.status,
          missedCallbackGraceMinutes: optionToGraceMinutes(form.missedCallbackGrace),
        });
        await queuesApi.replaceQueueAgents(queueId, agentsToSave);
        const { queue: savedQueue } = await queuesApi.getQueue(queueId);
        const savedForm = formStateFromQueue(savedQueue);
        setForm(savedForm);
        setInitialSnapshot(JSON.stringify(savedForm));
        onSaved?.(queueId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save queue");
        throw err;
      } finally {
        setSaving(false);
      }
    }, [form, isCreate, onSaved, queueId, schedules]);

    useImperativeHandle(ref, () => ({ save, saving }), [save, saving]);

    if (loading) {
      return (
        <div className="flex min-h-[280px] items-center justify-center gap-2 text-sm text-neutral-600">
          <LoaderCircle className="size-4 animate-spin" />
          Loading queue…
        </div>
      );
    }

    const shiftCards = selectedSchedule ? (
      <QueueStaffingForm
        variant="editor"
        queueName={form.name.trim() || (isCreate ? "this new queue" : "this queue")}
        shiftTypes={availableShiftTypes}
        shiftRowsByType={shiftsByType}
        agents={form.agents}
        eligibleAgents={eligibleAgents}
        onAgentsChange={(nextAgents) => setForm((prev) => ({ ...prev, agents: nextAgents }))}
        onSelectShift={onShiftSelect}
      />
    ) : (
      <div className="flex flex-col items-center justify-center px-2 py-10 text-center">
        <p className="text-sm font-medium text-neutral-800">No business hours selected</p>
        <p className="mt-1 text-sm text-neutral-600">
          Choose a hours template above to assign shifts and agents.
        </p>
      </div>
    );

    if (embedded) {
      const queueTitle = form.name.trim() || (isCreate ? "New queue" : "Queue");

      return (
        <>
        <div className="space-y-[16px]">
          {error ? <StatusBanner tone="error">{error}</StatusBanner> : null}

          <div className="flex items-start gap-4 rounded-xl border-[0.6px] border-[#bfbfbf] bg-white px-5 py-4">
            <div className={profileAvatarClassName(queueId ?? "new-queue", "size-12 shrink-0 text-sm")}>
              {profileInitials(queueTitle)}
            </div>
            <div className="min-w-0 flex-1">
              <p
                className={cn(
                  "text-[18px] font-semibold break-words",
                  form.name.trim() ? "text-neutral-900" : "text-neutral-400",
                )}
              >
                {form.name.trim() ? formatShownContactName(queueTitle) : queueTitle}
              </p>
              {!form.name.trim() ? (
                <p className="mt-0.5 text-sm text-neutral-600">Add a queue name below</p>
              ) : form.description.trim() ? (
                <p className="mt-0.5 truncate text-sm text-neutral-600">
                  {formatShownContactName(form.description)}
                </p>
              ) : null}
            </div>
            <StatusToggle
              id="queue-status"
              checked={form.status === "active"}
              compact
              showLabel
              className="shrink-0"
              onChange={(status) => setForm((prev) => ({ ...prev, status }))}
            />
          </div>

          <FormSection
            title="Queue details"
            description="Add the basic information about this queue."
          >
            <div className={`${fieldGroupClassName} grid-cols-1 sm:grid-cols-2`}>
              <TextField
                id="queue-name"
                label="Queue name"
                value={form.name}
                onChange={(name) => setForm((prev) => ({ ...prev, name }))}
                placeholder="e.g. Support, Billing, Gold Purchase"
                required
              />
              <div className="min-w-0 space-y-2">
                <FieldLabel required>Team</FieldLabel>
                <NativeSelect
                  id="queue-team"
                  className={selectClassName}
                  value={form.teamId}
                  onChange={(event) => onTeamChange(event.target.value)}
                >
                  <option value="">Select team</option>
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </NativeSelect>
              </div>
              <label htmlFor="queue-skills" className="block min-w-0 space-y-2 sm:col-span-2">
                <FieldLabel>Required skills</FieldLabel>
                <input
                  id="queue-skills"
                  value={form.skills.join(", ")}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      skills: event.target.value
                        .split(",")
                        .map((skill) => skill.trim())
                        .filter(Boolean),
                    }))
                  }
                  placeholder="e.g. billing, refunds, gold"
                  className={contactInputClassName}
                />
                <p className="text-xs text-neutral-600">
                  Agents must have at least one matching skill to be assigned.
                </p>
              </label>
            </div>
          </FormSection>

          <FormSection
            title="Description"
            description="Add a short note about what this queue handles."
          >
            <textarea
              id="queue-description"
              value={form.description}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, description: event.target.value }))
              }
              rows={5}
              placeholder="Write a note (optional)"
              className={cn(
                contactInputClassName,
                "min-h-[132px] resize-y py-3 leading-relaxed",
              )}
            />
          </FormSection>

          <FormSection
            title="Business hours"
            description="Set the operating window and missed-contact recovery."
          >
            <div className={`${fieldGroupClassName} grid-cols-1 sm:grid-cols-2`}>
              <div className="min-w-0 space-y-2">
                <FieldLabel required>Business hours</FieldLabel>
                <NativeSelect
                  id="queue-hours"
                  className={selectClassName}
                  value={form.businessHoursId}
                  onChange={(event) => onBusinessHoursChange(event.target.value)}
                >
                  <option value="">Select business hours</option>
                  {schedules.map((schedule) => (
                    <option key={schedule.id} value={schedule.id}>
                      {schedule.name}
                    </option>
                  ))}
                </NativeSelect>
                {selectedSchedule ? (
                  <p className="text-xs text-neutral-600">
                    {formatClock(selectedSchedule.openTime)} – {formatClock(selectedSchedule.closeTime)}
                    {" · "}
                    {selectedSchedule.workingDays.map((day) => day.slice(0, 3)).join(", ")}
                    {" · "}
                    {selectedSchedule.timezone}
                  </p>
                ) : null}
              </div>
              <div className="min-w-0 space-y-2">
                <FieldLabel>Proactive recovery</FieldLabel>
                <NativeSelect
                  id="queue-proactive-recovery"
                  className={selectClassName}
                  value={form.missedCallbackGrace}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      missedCallbackGrace: event.target.value as MissedCallbackGraceOptionValue,
                    }))
                  }
                >
                  {MISSED_CALLBACK_GRACE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </NativeSelect>
                <p className="text-xs text-neutral-600">
                  After a missed contact, auto-assign a callback once this grace period passes.
                </p>
              </div>
            </div>
          </FormSection>

          <FormSection
            title="Shifts & agents"
            description="Choose who covers this queue and on which channels."
          >
            {shiftCards}
          </FormSection>
        </div>
        </>
      );
    }

    const sectionClass = embedded
      ? "py-8 first:pt-0"
      : "rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white p-4 shadow-sm sm:p-5";
    const sectionTitleClass = cn(
      "font-semibold tracking-tight text-neutral-900",
      embedded ? "mb-6 text-base" : "mb-4 text-lg",
    );
    const fieldGridClass = cn("grid sm:grid-cols-2", embedded ? "gap-5" : "gap-4");
    const fieldLabelClass = embedded ? "space-y-2" : "space-y-1.5";
    const fieldLabelTextClass = embedded
      ? "text-xs font-medium tracking-[0.08em] text-neutral-600 uppercase"
      : "text-sm font-medium text-neutral-800";
    const blockGapClass = embedded ? "mt-6" : "mt-4";

    return (
      <>
      <div className={embedded ? undefined : "space-y-4"}>
        {error ? <StatusBanner tone="error" className={cn(embedded && "mb-4")}>{error}</StatusBanner> : null}

        <div className={cn("grid gap-5", !embedded && "xl:grid-cols-[minmax(0,1fr)_280px]")}>
          <div className={cn(embedded ? "divide-y divide-[#bfbfbf]" : "space-y-5")}>
            <section className={sectionClass}>
              <h2 className={sectionTitleClass}>Queue details</h2>
              <div className={fieldGridClass}>
                <div className={cn(fieldLabelClass, "sm:col-span-2")}>
                  <label htmlFor="queue-name" className={fieldLabelTextClass}>
                    Queue name
                  </label>
                  <input
                    id="queue-name"
                    value={form.name}
                    onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                    placeholder="e.g. Support, Billing, Gold Purchase"
                    className="h-11 w-full rounded-xl border-[0.6px] border-[#bfbfbf] px-3 text-sm outline-none focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200"
                  />
                </div>

                <div className={cn(fieldLabelClass, "sm:col-span-2")}>
                  <label htmlFor="queue-description" className={fieldLabelTextClass}>
                    Description
                    <span className="ml-1 font-normal normal-case text-neutral-400">(optional)</span>
                  </label>
                  <textarea
                    id="queue-description"
                    value={form.description}
                    onChange={(e) =>
                      setForm((prev) => ({ ...prev, description: e.target.value }))
                    }
                    rows={3}
                    placeholder="Short note for admins — what this queue handles and who it serves."
                    className="w-full resize-y rounded-xl border-[0.6px] border-[#bfbfbf] px-3 py-2.5 text-sm outline-none focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200"
                  />
                </div>

                <div className={cn(fieldLabelClass, "sm:col-span-2")}>
                  <label htmlFor="queue-skills" className={fieldLabelTextClass}>
                    Required skills
                    <span className="ml-1 font-normal normal-case text-neutral-400">(comma-separated)</span>
                  </label>
                  <input
                    id="queue-skills"
                    value={form.skills.join(", ")}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        skills: e.target.value
                          .split(",")
                          .map((skill) => skill.trim())
                          .filter(Boolean),
                      }))
                    }
                    placeholder="e.g. billing, refunds, gold"
                    className="h-11 w-full rounded-xl border-[0.6px] border-[#bfbfbf] px-3 text-sm outline-none focus:border-neutral-400 focus:ring-2 focus:ring-neutral-200"
                  />
                  <p className="text-xs text-neutral-600">
                    Agents must have at least one matching skill to be assigned.
                  </p>
                </div>

                <div
                  className={cn(
                    "sm:col-span-2 grid items-end gap-5 sm:grid-cols-[minmax(12rem,20rem)_auto]",
                    embedded && "sm:gap-8",
                  )}
                >
                  <div className={fieldLabelClass}>
                    <label htmlFor="queue-team" className={fieldLabelTextClass}>
                      Team
                    </label>
                    <select
                      id="queue-team"
                      value={form.teamId}
                      onChange={(e) => onTeamChange(e.target.value)}
                      className={nativeSelectClassName("h-11")}
                    >
                      <option value="">Select team</option>
                      {teams.map((team) => (
                        <option key={team.id} value={team.id}>
                          {team.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className={fieldLabelClass}>
                    <span className={fieldLabelTextClass}>Status</span>
                    <div className="flex h-11 items-center">
                      <StatusToggle
                        id="queue-status"
                        checked={form.status === "active"}
                        onChange={(status) => setForm((prev) => ({ ...prev, status }))}
                        compact={embedded}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <section className={sectionClass}>
              <h2 className={sectionTitleClass}>Business hours & shifts</h2>

              <div className={fieldGridClass}>
                <div className={cn(fieldLabelClass, "sm:col-span-2")}>
                  <label htmlFor="queue-hours" className={fieldLabelTextClass}>
                    Business hours
                  </label>
                  <select
                    id="queue-hours"
                    value={form.businessHoursId}
                    onChange={(e) => onBusinessHoursChange(e.target.value)}
                    className={nativeSelectClassName("h-11")}
                  >
                    <option value="">Select business hours</option>
                    {schedules.map((schedule) => (
                      <option key={schedule.id} value={schedule.id}>
                        {schedule.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {selectedSchedule ? (
                <div
                  className={cn(
                    embedded
                      ? "mt-5 space-y-1 text-xs leading-relaxed text-neutral-600"
                      : "mt-4 rounded-xl border-[0.6px] border-[#bfbfbf] bg-neutral-50 px-4 py-3 text-sm text-neutral-600",
                  )}
                >
                  <p>
                    <span className="font-medium text-neutral-800">{selectedSchedule.name}</span>
                    {" · "}
                    {selectedSchedule.timezone}
                  </p>
                  <p className="mt-1">
                    Window {formatClock(selectedSchedule.openTime)} –{" "}
                    {formatClock(selectedSchedule.closeTime)}
                    {" · "}
                    {selectedSchedule.workingDays.map((day) => day.slice(0, 3)).join(", ")}
                  </p>
                </div>
              ) : null}

              <div className={cn(blockGapClass, "space-y-2")}>
                <p className={fieldLabelTextClass}>Proactive recovery</p>
                <p className="text-xs text-neutral-600">
                  After a missed contact, the Co-worker can auto-assign a callback once this grace
                  period passes.
                </p>
                <NativeSelect
                  id="queue-proactive-recovery"
                  className="h-11 rounded-lg"
                  value={form.missedCallbackGrace}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      missedCallbackGrace: event.target.value as MissedCallbackGraceOptionValue,
                    }))
                  }
                >
                  {MISSED_CALLBACK_GRACE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </NativeSelect>
              </div>

              <div className={cn(blockGapClass, "space-y-3")}>
                <p className={fieldLabelTextClass}>Shifts</p>
                {shiftCards}
              </div>
            </section>
          </div>

          {!embedded ? (
            <aside className="space-y-4">
              <div className="rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white p-5 shadow-sm">
                <p className="text-[11px] font-medium tracking-[0.12em] text-neutral-400 uppercase">
                  Queue summary
                </p>
                <dl className="mt-4 space-y-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-neutral-600">Shifts</dt>
                    <dd className="font-medium">{form.shiftTypes.length}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-neutral-600">Agents</dt>
                    <dd className="font-medium">{agentsOnQueue.size}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-neutral-600">Assignments</dt>
                    <dd className="font-medium">{form.agents.length}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-neutral-600">Chat capable</dt>
                    <dd className="font-medium">
                      {uniqueUserCount(form.agents.filter((agent) => agent.handlesChat))}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-neutral-600">Voice capable</dt>
                    <dd className="font-medium">
                      {uniqueUserCount(form.agents.filter((agent) => agent.handlesCalls))}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <dt className="text-neutral-600">WhatsApp capable</dt>
                    <dd className="font-medium">
                      {uniqueUserCount(form.agents.filter((agent) => agent.handlesWhatsapp))}
                    </dd>
                  </div>
                </dl>
              </div>
            </aside>
          ) : null}
        </div>
      </div>
      </>
    );
  },
);

function uniqueShiftTypes(values: ShiftType[]): ShiftType[] {
  return Array.from(new Set(values));
}

function uniqueUserCount(agents: QueueAgent[]): number {
  return new Set(agents.map((agent) => agent.userId)).size;
}

function allShiftsForHours(
  schedules: BusinessHours[],
  businessHoursId: string,
): ShiftType[] {
  const schedule = schedules.find((item) => item.id === businessHoursId);
  if (!schedule) return [];
  return uniqueShiftTypes(schedule.shifts.map((shift) => shift.shiftType));
}

