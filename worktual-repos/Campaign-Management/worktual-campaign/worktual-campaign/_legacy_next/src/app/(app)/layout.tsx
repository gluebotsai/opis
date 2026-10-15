import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { getCampaignSession } from "@/server/auth/login-action";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getCampaignSession();
  if (!session) {
    redirect("/login");
  }

  return <AppShell session={session}>{children}</AppShell>;
}
