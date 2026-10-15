import { useState, type FormEvent, type KeyboardEvent } from "react";
import { Send } from "lucide-react";

type ContactChatBarProps = {
  placeholder?: string;
  disabled?: boolean;
  onSend: (text: string) => void;
};

/**
 * Floating list/detail entry bar — same black-pill language as AgentChatComposer.
 * Opens a full chat workspace; no busy/Stop state here.
 */
export function ContactChatBar({
  placeholder = "Ask",
  disabled,
  onSend,
}: ContactChatBarProps) {
  const [value, setValue] = useState("");

  const submit = () => {
    const text = value.trim();
    if (!text || disabled) return;
    onSend(text);
    setValue("");
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    submit();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-5 z-40 flex justify-center px-4 md:left-[260px]">
      <form
        onSubmit={onSubmit}
        className="pointer-events-auto flex w-full max-w-md items-center gap-2 rounded-full bg-neutral-950 px-2 py-1.5 shadow-lg sm:max-w-lg"
      >
        <input
          type="text"
          value={value}
          disabled={disabled}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          aria-label="Ask"
          className="min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-white outline-none placeholder:text-white/50 disabled:cursor-not-allowed disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={disabled || !value.trim()}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-white text-neutral-950 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label="Send"
        >
          <Send className="size-4" strokeWidth={1.75} />
        </button>
      </form>
    </div>
  );
}
