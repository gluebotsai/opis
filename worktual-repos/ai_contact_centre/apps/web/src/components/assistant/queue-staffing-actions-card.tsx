import {
  QueueStaffingActionList,
  type QueueStaffingActionsPayload,
} from "@/components/workforce/queue-staffing-actions";
import { ASSISTANT_COWORKER_REQUEST } from "@/features/assistant/assistant-api";

function sendCoworkerPick(message: string) {
  window.dispatchEvent(
    new CustomEvent(ASSISTANT_COWORKER_REQUEST, { detail: { message } }),
  );
}

export function QueueStaffingActionsCard({
  payload,
  disabled = false,
}: {
  payload: QueueStaffingActionsPayload;
  disabled?: boolean;
}) {
  return (
    <div className="w-full max-w-[92%] rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white px-3.5 py-3">
      <p className="text-sm font-semibold text-neutral-900">
        {payload.currentShift ? `Continue staffing after ${payload.currentShift}` : "Continue staffing"}
      </p>
      <p className="mt-0.5 text-sm text-neutral-600">
        Add someone else above, switch shift, or finish staffing.
      </p>
      <div className="mt-3">
        <QueueStaffingActionList payload={payload} disabled={disabled} onPick={sendCoworkerPick} />
      </div>
    </div>
  );
}
