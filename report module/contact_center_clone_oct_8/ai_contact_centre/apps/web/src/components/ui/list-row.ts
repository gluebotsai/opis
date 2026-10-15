import { cn } from "@/lib/utils";

/** Inset hairline under stacked list rows. Matches Contacts. */
export function listRowDividerClassName(inset: "3" | "4" = "3"): string {
  return cn(
    "relative after:pointer-events-none after:absolute after:bottom-0 after:border-b-[0.6px] after:border-[#e5e5e5] after:content-[''] last:after:hidden",
    inset === "4" ? "after:inset-x-4" : "after:inset-x-3",
  );
}

/** Clickable stacked list row — inbox, contacts, tasks, history. */
export const listRowButtonClassName =
  "w-full cursor-pointer rounded-xl px-3 py-3 text-left transition-colors xl:py-4";

/** Trailing date on stacked list rows. */
export const listRowTimestampClassName =
  "shrink-0 text-[14px] leading-5 text-neutral-400";
