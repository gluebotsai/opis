import { useSearchParams } from "react-router-dom";
import { Headphones } from "lucide-react";

/**
 * Mic listen window is retired for Assist coaching.
 * Chrome getUserMedia cannot isolate the customer — it captures the sales
 * rep and room audio. Customer speech must come from Meet/provider captions.
 */
export function MeetingAssistListenPage() {
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get("sessionId")?.trim() || "";

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-canvas p-6">
      <div className="w-full max-w-sm rounded-xl border border-border-default bg-surface p-5 text-center">
        <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-violet-0 text-violet-600">
          <Headphones className="size-5" strokeWidth={1.75} />
        </div>
        <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-violet-600">
          Mic listening disabled
        </p>
        <p className="mt-2 text-sm text-text-secondary">
          Assist only coaches on the <strong>customer’s</strong> questions from
          Meet captions / transcript — not from your Chrome microphone (that
          mixes your voice and room audio).
        </p>
        <p className="mt-3 text-xs text-text-caption">
          Keep the Assist side panel open. You can type an Ask there anytime.
          {sessionId ? ` Session ${sessionId.slice(0, 8)}…` : ""}
        </p>
      </div>
    </div>
  );
}
