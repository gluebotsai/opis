import { RefreshCw } from "lucide-react";

import { cn } from "@/lib/utils";

/** Circular refresh mark used by every refresh control. */
export function RefreshIcon({ className }: { className?: string }) {
  return <RefreshCw className={cn("size-[18px]", className)} strokeWidth={2.25} aria-hidden />;
}
