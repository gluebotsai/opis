import { useEffect, useMemo, useState } from "react";

import {
  QueueStaffingForm,
  agentsToAssignments,
  assignmentsToAgents,
  payloadEligibleAgents,
  type QueueStaffingFormPayload,
} from "@/components/workforce/queue-staffing-form";
import { ASSISTANT_COWORKER_REQUEST } from "@/features/assistant/assistant-api";
import { formatShownContactName } from "@/features/contacts/contacts-utils";
import { agentDisplayName } from "@/features/workforce/queues/types";
import { useAppDispatch, useAppSelector } from "@/hooks/redux";
import { patchQueueDraft, selectQueueDraft } from "@/store/slices/queue-create-session-slice";

function sendCoworker(message: string) {
  window.dispatchEvent(
    new CustomEvent(ASSISTANT_COWORKER_REQUEST, { detail: { message } }),
  );
}

export function QueueStaffingFormCard({
  payload,
  disabled = false,
}: {
  payload: QueueStaffingFormPayload;
  disabled?: boolean;
}) {
  const dispatch = useAppDispatch();
  const draft = useAppSelector(selectQueueDraft);
  const eligibleAgents = useMemo(() => payloadEligibleAgents(payload), [payload]);
  const namesById = useMemo(
    () =>
      Object.fromEntries(
        eligibleAgents.map((agent) => [agent.id, formatShownContactName(agentDisplayName(agent))]),
      ),
    [eligibleAgents],
  );
  const [agents, setAgents] = useState(() =>
    assignmentsToAgents(payload.assignments ?? draft.shiftAgentAssignments),
  );

  useEffect(() => {
    setAgents(assignmentsToAgents(payload.assignments ?? draft.shiftAgentAssignments));
  }, [draft.shiftAgentAssignments, payload]);

  function persist(nextAgents: typeof agents, extras: Record<string, unknown> = {}) {
    setAgents(nextAgents);
    dispatch(
      patchQueueDraft({
        ...draft,
        shiftAgentAssignments: agentsToAssignments(nextAgents, namesById),
        ...extras,
      }),
    );
  }

  return (
    <div className="w-full max-w-[92%] rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white px-3.5 py-3">
      <p className="text-sm font-semibold text-neutral-900">Shifts & agents</p>
      <p className="mt-0.5 text-sm text-neutral-600">
        Add people to each shift, choose their channels, then click Done staffing.
      </p>
      <div className="mt-3">
        <QueueStaffingForm
          variant="chat"
          queueName={payload.queueName ?? draft.name ?? ""}
          shiftTypes={payload.shiftTypes}
          agents={agents}
          eligibleAgents={eligibleAgents}
          disabled={disabled}
          onAgentsChange={(next) => persist(next)}
          onDone={({ agents: nextAgents, message }) => {
            persist(nextAgents, {
              staffingComplete: true,
              staffingSkipped: nextAgents.length === 0,
            });
            sendCoworker(message);
          }}
        />
      </div>
    </div>
  );
}
