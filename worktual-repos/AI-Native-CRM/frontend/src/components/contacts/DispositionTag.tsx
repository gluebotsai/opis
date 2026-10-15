/** Outcome word for one touch. The wording comes from the disposition agent. */
export function DispositionTag({ label }: { label?: string | null }) {
  const text = label?.trim();
  if (!text) return null;
  return (
    <span className="inline-flex max-w-full items-center rounded-md bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-900">
      {text}
    </span>
  );
}
