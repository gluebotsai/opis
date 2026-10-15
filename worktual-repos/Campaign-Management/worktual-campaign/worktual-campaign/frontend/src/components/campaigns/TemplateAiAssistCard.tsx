import { useState } from "react";
import { Loader2, Send, Sparkles } from "lucide-react";

const CHIPS = [
  { id: "shorter", label: "Make it shorter" },
  { id: "professional", label: "More professional" },
  { id: "b2b", label: "Make it B2B focused" },
  { id: "alts", label: "Generate alternatives" },
] as const;

type Props = {
  disabled?: boolean;
  locked?: boolean;
  busy?: boolean;
  walkthrough?: string;
  issues?: string[];
  alternatives?: string[];
  onAsk: (instruction: string) => void;
  onPickAlternative?: (text: string) => void;
};

export function TemplateAiAssistCard({
  disabled,
  locked,
  busy,
  walkthrough,
  issues,
  alternatives,
  onAsk,
  onPickAlternative,
}: Props) {
  const [prompt, setPrompt] = useState("");

  const send = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || disabled || locked || busy) return;
    onAsk(trimmed);
    setPrompt("");
  };

  return (
    <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50 p-3">
      <div className="mb-2 flex items-start gap-2">
        <Sparkles className="mt-0.5 size-4 shrink-0 text-violet-600" strokeWidth={1.75} />
        <div>
          <p className="text-sm font-semibold text-text-primary">AI Assist</p>
          <p className="text-[11px] text-text-caption">
            Improve your content with AI
          </p>
        </div>
      </div>

      {locked ? (
        <p className="text-xs text-text-caption">
          This block is static and cannot be changed.
        </p>
      ) : (
        <>
          <div className="mb-2 grid grid-cols-2 gap-1.5">
            {CHIPS.map((chip) => (
              <button
                key={chip.id}
                type="button"
                disabled={disabled || busy}
                onClick={() => send(chip.label)}
                className="rounded-lg border border-neutral-200 bg-white px-2 py-1.5 text-left text-[11px] font-medium text-text-primary disabled:opacity-50"
              >
                {chip.label}
              </button>
            ))}
          </div>
          <div className="relative">
            <input
              value={prompt}
              disabled={disabled || busy}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  send(prompt);
                }
              }}
              placeholder="Ask AI to edit this text…"
              className="h-10 w-full rounded-lg border border-neutral-200 bg-white pr-9 pl-3 text-xs outline-none focus:border-neutral-900"
            />
            <button
              type="button"
              disabled={disabled || busy || !prompt.trim()}
              className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-md p-1 text-neutral-500 disabled:opacity-40"
              onClick={() => send(prompt)}
              aria-label="Send"
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Send className="size-3.5" strokeWidth={1.75} />
              )}
            </button>
          </div>
        </>
      )}

      {busy ? (
        <p className="mt-2 text-[11px] text-violet-700">Reviewing…</p>
      ) : null}

      {walkthrough ? (
        <p className="mt-2 text-xs leading-5 text-text-primary">{walkthrough}</p>
      ) : null}

      {issues && issues.length > 0 ? (
        <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[11px] text-amber-800">
          {issues.map((issue) => (
            <li key={issue}>{issue}</li>
          ))}
        </ul>
      ) : null}

      {alternatives && alternatives.length > 0 ? (
        <div className="mt-2 space-y-1">
          {alternatives.map((alt) => (
            <button
              key={alt}
              type="button"
              className="w-full rounded-lg border border-violet-200 bg-white px-2 py-1.5 text-left text-[11px] text-text-primary"
              onClick={() => onPickAlternative?.(alt)}
            >
              {alt}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
