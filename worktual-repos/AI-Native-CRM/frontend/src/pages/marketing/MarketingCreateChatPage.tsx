import { useParams } from "react-router-dom";
import { CreateCampaignChatWorkspace } from "@/components/marketing/CreateCampaignChatWorkspace";

export function MarketingCreateChatPage() {
  const { draftId } = useParams<{ draftId: string }>();
  if (!draftId) return null;
  return (
    <CreateCampaignChatWorkspace
      draftId={draftId}
      listHref="/marketing/create"
    />
  );
}
