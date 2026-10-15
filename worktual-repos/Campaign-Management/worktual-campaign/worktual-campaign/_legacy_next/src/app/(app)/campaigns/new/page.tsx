import { redirect } from "next/navigation";

/** Legacy path — Create campaign module lives at /campaigns/create (no form). */
export default function NewCampaignRedirectPage() {
  redirect("/campaigns/create");
}
