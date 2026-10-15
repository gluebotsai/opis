import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ContactDetailPane } from "@/components/contacts/ContactDetailPane";
import { AgentModuleShell } from "@/components/coworker/AgentModuleShell";
import { runContactCoworkerMutation } from "@/lib/coworker/contact-mutations";
import type { AgentToolProposal } from "@/services/coworker";
import { ContactDetailPageSkeleton } from "./ContactDetailPageSkeleton";

export function ContactDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [refreshToken, setRefreshToken] = useState(0);

  if (!id) {
    return (
      <AgentModuleShell
        moduleId="contact"
        title="Contact"
        welcome="I'm your **Worktual co-worker**. Ask me about next steps while you use the workspace on the right."
        surface="detail"
        workspace={
          <div className="px-6 py-10 text-sm text-text-danger">
            Contact not found.
          </div>
        }
      />
    );
  }

  return (
    <AgentModuleShell
      moduleId="contact"
      title="Contact"
      welcome="I'm your **Worktual co-worker**. Ask me about next steps, lead status, or related deals — the contact record stays fully usable on the right."
      chips={[
        {
          id: "chip-next-step",
          label: "Suggest next step",
          prompt: "What should I do next with this contact?",
        },
        {
          id: "chip-log-activity",
          label: "Log an activity",
          prompt: "Help me log an activity on this contact",
        },
      ]}
      surface="detail"
      entityId={id}
      workspaceMode="detail"
      workspace={
        <ContactDetailPane
          contactId={id}
          refreshToken={refreshToken}
          onUnavailable={() => navigate("/contact", { replace: true })}
        />
      }
      onToolConfirm={async (tool: AgentToolProposal) => {
        const handled = await runContactCoworkerMutation(tool, {
          activeContactId: id,
        });
        if (handled === true && tool.name === "propose_delete_contact") {
          navigate("/contact", { replace: true });
        }
        return handled;
      }}
      onAfterTool={() => setRefreshToken((n) => n + 1)}
    />
  );
}

/** Kept for loading flash elsewhere */
export { ContactDetailPageSkeleton };
