import { useState } from "react";

import {
  QueueAgentPickerList,
  QueueMoveAgentDialog,
  queueAgentPickMessage,
  type QueueAgentPickerItem,
  type QueueAgentPickerPayload,
} from "@/components/workforce/queue-agent-picker";
import { ASSISTANT_COWORKER_REQUEST } from "@/features/assistant/assistant-api";

function sendCoworkerPick(message: string) {
  window.dispatchEvent(
    new CustomEvent(ASSISTANT_COWORKER_REQUEST, { detail: { message } }),
  );
}

export function QueueAgentPickerCard({
  picker,
  disabled = false,
}: {
  picker: QueueAgentPickerPayload;
  disabled?: boolean;
}) {
  const [pendingMove, setPendingMove] = useState<QueueAgentPickerItem | null>(null);
  const destinationName = picker.queueName?.trim() || "this queue";
  const shift = picker.shift;

  return (
    <div className="w-full max-w-[92%] rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white px-3.5 py-3">
      <p className="text-sm font-semibold text-neutral-900">
        {shift ? `Add an agent for ${shift}` : "Add an agent"}
      </p>
      <p className="mt-0.5 text-sm text-neutral-600">
        Click to add, or move someone from another queue.
      </p>
      <div className="mt-3">
        <QueueAgentPickerList
          available={picker.available}
          elsewhere={picker.elsewhere}
          disabled={disabled}
          onAdd={(item) => sendCoworkerPick(queueAgentPickMessage(item, shift))}
          onMove={setPendingMove}
        />
      </div>
      <QueueMoveAgentDialog
        agent={pendingMove}
        destinationName={destinationName}
        onClose={() => setPendingMove(null)}
        onConfirm={() => {
          if (!pendingMove) return;
          sendCoworkerPick(queueAgentPickMessage(pendingMove, shift, true));
          setPendingMove(null);
        }}
      />
    </div>
  );
}
