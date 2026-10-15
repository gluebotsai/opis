import { CreateCampaignLanding } from "@/components/campaigns/CreateCampaignLanding";

export default function CreateCampaignPage() {
  return (
    <CreateCampaignLanding
      chatBasePath="/campaigns/create"
      templatesHref="/templates"
    />
  );
}
