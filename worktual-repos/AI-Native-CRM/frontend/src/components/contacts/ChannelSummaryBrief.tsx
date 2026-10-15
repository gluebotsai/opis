import type { ChannelSummaryBrief as Brief } from "@/lib/contact-intelligence";

export function ChannelSummaryBriefView({ brief }: { brief: Brief }) {
  return (
    <div className="space-y-3 text-sm leading-6 text-text-primary">
      {brief.narrative ? (
        <p className="whitespace-pre-wrap break-words">{brief.narrative}</p>
      ) : null}
      {brief.channels.length > 0 ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
            Channel summaries
          </p>
          <ul className="mt-1.5 space-y-1.5">
            {brief.channels.map((line) => (
              <li key={`${line.label}:${line.text}`} className="break-words">
                <span className="font-medium">{line.label}:</span> {line.text}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {brief.notes.length > 0 ? (
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary">
            Key notes
          </p>
          <ul className="mt-1.5 list-disc space-y-1 pl-5">
            {brief.notes.map((note) => (
              <li key={note} className="break-words">
                {note}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
