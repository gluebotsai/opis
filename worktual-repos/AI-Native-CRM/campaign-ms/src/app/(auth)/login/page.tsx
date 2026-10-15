import { redirect } from "next/navigation";
import { getCampaignSession } from "@/server/auth/login-action";
import { LoginForm } from "@/components/auth/LoginForm";

export default async function LoginPage() {
  const session = await getCampaignSession();
  if (session) {
    redirect("/dashboard");
  }
  return <LoginForm />;
}
