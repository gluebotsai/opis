import { redirect } from "next/navigation";
import { getCampaignSession } from "@/server/auth/login-action";

export default async function HomePage() {
  const session = await getCampaignSession();
  redirect(session ? "/dashboard" : "/login");
}
