import { useParams } from "react-router-dom";
import { ContactChatWorkspace } from "@/components/contacts/ContactChatWorkspace";

export function CreateContactChatPage() {
  const { sessionId, draftId } = useParams();
  const id = sessionId || draftId;
  if (!id) return null;
  return <ContactChatWorkspace sessionId={id} />;
}
