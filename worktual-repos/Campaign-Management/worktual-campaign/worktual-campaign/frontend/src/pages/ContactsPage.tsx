import { useMemo } from "react";
import { AudienceWorkspace } from "@/components/contacts/AudienceWorkspace";
import { getOrCreateAudienceSessionId } from "@/lib/audience-agent-session";

/** Audience module: stable co-worker chat + people list (Reports-style split). */
export function ContactsPage() {
  const sessionId = useMemo(() => getOrCreateAudienceSessionId(), []);
  return <AudienceWorkspace sessionId={sessionId} />;
}
