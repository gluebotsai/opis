import { useEffect, useId, useRef } from "react";
import { RefreshCw } from "lucide-react";

function ComposeAiMark({ className = "size-5" }: { className?: string }) {
  const uid = useId().replace(/:/g, "");
  const g = (n: number) => `${uid}-p${n}`;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      className={`shrink-0 ${className}`}
      aria-hidden
    >
      <path
        d="M8.48664 16.5044C7.64833 16.7621 6.74473 16.8542 5.81665 16.7457C2.61966 16.3726 0.235327 13.7446 0.0674329 10.6363C0.0627692 10.5476 0.0592714 10.4579 0.0581055 10.3681C0.0767604 9.47149 0.239991 7.23406 1.32198 5.23682C1.11328 5.90956 1.18323 6.67558 1.4444 7.33317C1.92593 8.54807 2.8785 9.30243 3.88004 10.0253C4.65422 10.585 5.45521 11.1259 6.09181 11.8453C7.25891 13.1663 8.10188 14.7823 8.4878 16.5044H8.48664Z"
        fill={`url(#${g(0)})`}
      />
      <path
        d="M16.8871 10.9871C17.1693 11.8172 17.287 12.7185 17.2054 13.6489C16.9233 16.8552 14.3652 19.3142 11.2638 19.5718C11.1752 19.58 11.0854 19.5858 10.9968 19.5882C10.099 19.5951 7.85812 19.4972 5.83057 18.4735C6.50914 18.6624 7.27166 18.5715 7.92225 18.2916C9.122 17.7763 9.84954 16.8016 10.5433 15.7802C11.0796 14.9909 11.5984 14.1736 12.298 13.5171C13.5852 12.3127 15.1767 11.4231 16.8859 10.9871H16.8871Z"
        fill={`url(#${g(1)})`}
      />
      <path
        d="M11.4851 3.24899C12.3222 2.98782 13.2258 2.89222 14.1539 2.99715C17.352 3.35743 19.7469 5.97611 19.9387 9.08333C19.9346 9.17194 19.9381 9.26171 19.9381 9.35149C19.9229 10.2481 19.769 12.4867 18.6952 14.4886C18.9004 13.8147 18.8281 13.0498 18.5646 12.3922C18.0784 11.1797 17.1223 10.4288 16.1185 9.70943C15.3431 9.15328 14.5386 8.61579 13.8997 7.89874C12.7268 6.5824 11.878 4.96991 11.4839 3.24899H11.4851Z"
        fill={`url(#${g(2)})`}
      />
      <path
        d="M10.0148 16.5266C10.7727 16.9685 11.6075 17.2484 12.5356 17.3521C15.7337 17.7124 18.6521 15.6942 19.5207 12.7059C19.5452 12.6208 19.5697 12.5345 19.5895 12.447C19.7749 11.5691 20.4488 9.54503 19.523 7.16187C19.5732 7.86492 19.3318 8.59363 18.9284 9.1766C18.1845 10.2504 17.0851 10.7693 15.9459 11.2461C15.0657 11.6157 14.1621 11.9608 13.3786 12.517C11.9421 13.5395 10.7797 14.9363 10.0137 16.5255L10.0148 16.5266Z"
        fill={`url(#${g(3)})`}
      />
      <path
        d="M3.2188 8.58068C2.9483 7.74587 2.84336 6.84343 2.93897 5.91419C3.26776 2.71253 5.8608 0.290888 8.96568 0.0775225C9.05429 0.0716929 9.14407 0.0670291 9.23385 0.0646973C10.1316 0.0705269 12.3702 0.201111 14.3838 1.25512C13.7075 1.05691 12.9438 1.13736 12.2898 1.40669C11.0819 1.90454 10.3415 2.86877 9.6326 3.87963C9.08461 4.66081 8.55527 5.47113 7.84522 6.11706C6.54054 7.30281 4.93738 8.1691 3.22113 8.57951L3.2188 8.58068Z"
        fill={`url(#${g(4)})`}
      />
      <path
        d="M16.4799 9.96944C16.9136 9.20692 17.2156 8.31615 17.3112 7.3869C17.6388 4.18524 15.5903 1.2879 12.5938 0.449593C12.5087 0.425109 12.4213 0.402956 12.3338 0.383135C11.4535 0.207079 9.42365 -0.447009 7.0498 0.504392C7.7517 0.447262 8.4839 0.680448 9.07037 1.07803C10.1524 1.8114 10.6817 2.90505 11.1714 4.0395C11.5491 4.91628 11.9036 5.81638 12.4679 6.5929C13.5044 8.01883 14.8825 9.22091 16.4799 9.9706V9.96944Z"
        fill={`url(#${g(5)})`}
      />
      <path
        d="M10.0743 3.26867C9.31764 2.82445 8.42337 2.50615 7.49529 2.39772C4.2983 2.02345 1.37181 4.03119 0.491527 7.01598C0.465876 7.10109 0.442558 7.18737 0.421571 7.27481C0.23269 8.1516 -0.449382 10.1733 0.467042 12.56C0.419239 11.8569 0.664085 11.1282 1.06983 10.5488C1.81836 9.47843 2.919 8.96309 4.06045 8.49088C4.9419 8.12478 5.84783 7.78316 6.6325 7.23051C8.07359 6.21498 9.30249 4.85667 10.0767 3.26983L10.0743 3.26867Z"
        fill={`url(#${g(6)})`}
      />
      <path
        d="M3.5929 9.81775C3.16966 10.5861 2.89567 11.4559 2.81405 12.3863C2.5319 15.5926 4.62242 18.4596 7.63169 19.2548C7.71681 19.2781 7.80425 19.2991 7.8917 19.3178C8.77431 19.481 10.8135 20.1048 13.1734 19.1207C12.4726 19.1884 11.7369 18.9657 11.1447 18.5762C10.0522 17.8592 9.50651 16.7725 9.00166 15.6463C8.61108 14.7753 8.24381 13.8799 7.66784 13.1115C6.61033 11.7007 5.19955 10.5453 3.59173 9.81775H3.5929Z"
        fill={`url(#${g(7)})`}
      />
      <defs>
        <linearGradient id={g(0)} x1="0.79294" y1="3.01604" x2="4.27377" y2="16.1422" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6C00FF" />
          <stop offset="0.52" stopColor="#4702D1" />
          <stop offset="1" stopColor="#250E83" />
        </linearGradient>
        <linearGradient id={g(1)} x1="10.9548" y1="14.6947" x2="16.5781" y2="16.327" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6C00FF" />
          <stop offset="0.52" stopColor="#4400CB" />
          <stop offset="1" stopColor="#1E0099" />
        </linearGradient>
        <linearGradient id={g(2)} x1="17.8312" y1="10.9896" x2="15.6754" y2="5.81055" gradientUnits="userSpaceOnUse">
          <stop offset="0.24" stopColor="#1E0099" />
          <stop offset="0.81" stopColor="#6C00FF" />
        </linearGradient>
        <linearGradient id={g(3)} x1="16.9032" y1="19.251" x2="16.9032" y2="5.38965" gradientUnits="userSpaceOnUse">
          <stop stopColor="#00F9FF" />
          <stop offset="0.5" stopColor="#6C00FF" />
        </linearGradient>
        <linearGradient id={g(4)} x1="3.68983" y1="4.15013" x2="10.0383" y2="4.55821" gradientUnits="userSpaceOnUse">
          <stop stopColor="#6C00FF" />
          <stop offset="0.52" stopColor="#4400CB" />
          <stop offset="1" stopColor="#1E0099" />
        </linearGradient>
        <linearGradient id={g(5)} x1="10.6619" y1="0.491567" x2="17.3466" y2="12.4487" gradientUnits="userSpaceOnUse">
          <stop offset="0.269069" stopColor="#6C00FF" />
          <stop offset="1" stopColor="#00F9FF" />
        </linearGradient>
        <linearGradient id={g(6)} x1="-0.00166309" y1="7.45553" x2="11.4478" y2="7.45553" gradientUnits="userSpaceOnUse">
          <stop offset="0.06" stopColor="#380085" />
          <stop offset="0.5625" stopColor="#4E44FF" />
          <stop offset="1" stopColor="#00F9FF" />
        </linearGradient>
        <linearGradient id={g(7)} x1="2.7884" y1="14.7403" x2="13.1734" y2="14.7403" gradientUnits="userSpaceOnUse">
          <stop offset="0.212285" stopColor="#6C00FF" />
          <stop offset="1" stopColor="#00F9FF" />
        </linearGradient>
      </defs>
    </svg>
  );
}


/** Inbox-style instruction box: Enter or the corner button rewrites the draft. */
export function ComposeAssistField({
  value,
  onChange,
  onSubmit,
  pending = false,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (instruction: string) => void;
  pending?: boolean;
  disabled?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const busy = pending || disabled;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 32), 160)}px`;
  }, [value]);

  function submit(instruction: string) {
    if (busy || !instruction.trim()) return;
    onSubmit(instruction);
  }

  return (
    <div className="flex items-center gap-2 rounded-2xl border border-neutral-200 bg-neutral-50/80 px-2.5 py-1.5 focus-within:border-neutral-300 focus-within:bg-white focus-within:ring-2 focus-within:ring-neutral-200/70">
      <ComposeAiMark className="size-5 shrink-0 self-center" />
      <textarea
        ref={ref}
        rows={1}
        name="crm-ai-compose-instruction"
        autoComplete="off"
        autoCorrect="off"
        spellCheck
        data-1p-ignore
        data-lpignore="true"
        data-form-type="other"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
          e.preventDefault();
          submit(e.currentTarget.value);
        }}
        placeholder="Describe what to write…"
        disabled={busy}
        className="max-h-40 min-h-8 min-w-0 flex-1 resize-none overflow-y-auto break-words bg-transparent py-1.5 text-sm leading-5 text-text-primary outline-none placeholder:text-text-placeholder disabled:opacity-60"
        style={{ overflowWrap: "anywhere" }}
        aria-label="AI compose instruction"
      />
      <button
        type="button"
        disabled={busy || !value.trim()}
        onClick={() => submit(value)}
        className="inline-flex size-8 shrink-0 cursor-pointer self-center items-center justify-center rounded-lg text-neutral-800 hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-40"
        title={pending ? "Generating…" : "Generate email"}
        aria-label={pending ? "Generating" : "Generate email"}
      >
        <RefreshCw
          className={`size-3.5 ${pending ? "animate-spin" : ""}`}
          strokeWidth={1.75}
        />
      </button>
    </div>
  );
}
