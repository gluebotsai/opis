import {
  QueueChannelPickerList,
  type QueueChannelPickerPayload,
} from "@/components/workforce/queue-channel-picker";
import { ASSISTANT_COWORKER_REQUEST } from "@/features/assistant/assistant-api";

function sendCoworkerPick(message: string) {
  window.dispatchEvent(
    new CustomEvent(ASSISTANT_COWORKER_REQUEST, { detail: { message } }),
  );
}

export function QueueChannelPickerCard({
  picker,
  disabled = false,
}: {
  picker: QueueChannelPickerPayload;
  disabled?: boolean;
}) {
  const shift = picker.shift;
  return (
    <div className="w-full max-w-[92%] rounded-2xl border-[0.6px] border-[#bfbfbf] bg-white px-3.5 py-3">
      <p className="text-sm font-semibold text-neutral-900">
        Channels for {picker.agentName}
        {shift ? ` · ${shift}` : ""}
      </p>
      <p className="mt-0.5 text-sm text-neutral-600">
        Click channels to select them, then save. Or give them all channels.
      </p>
      <div className="mt-3">
        <QueueChannelPickerList payload={picker} disabled={disabled} onPick={sendCoworkerPick} />
      </div>
    </div>
  );
}
