import { CreateCampaignChatWorkspace } from "@/components/campaigns/CreateCampaignChatWorkspace";

export default async function CreateCampaignChatPage({
  params,
}: {
  params: Promise<{ draftId: string }>;
}) {
  const { draftId } = await params;
  return (
    <CreateCampaignChatWorkspace
      draftId={draftId}
      listHref="/campaigns/create"
    />
  );
}
