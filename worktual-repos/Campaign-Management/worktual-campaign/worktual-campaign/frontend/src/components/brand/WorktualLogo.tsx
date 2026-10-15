export function WorktualLogo({
  className = "",
  markClassName = "size-7",
  wordmark = true,
  inverted = false,
}: {
  className?: string;
  markClassName?: string;
  wordmark?: boolean;
  inverted?: boolean;
}) {
  const textColor = inverted ? "text-text-on-dark" : "text-text-primary";

  return (
    <div className={`inline-flex items-center gap-2.5 ${className}`}>
      <img
        src="/brand/worktual-logo.png"
        alt=""
        className={`shrink-0 ${markClassName}`}
      />
      {wordmark ? (
        <span
          className={`text-[18px] leading-none font-semibold tracking-[-0.02em] ${textColor}`}
        >
          Worktual
        </span>
      ) : null}
    </div>
  );
}
