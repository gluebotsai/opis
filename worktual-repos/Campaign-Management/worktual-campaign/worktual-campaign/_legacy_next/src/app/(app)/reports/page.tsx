import { BarChart3 } from "lucide-react";
import { ModulePage } from "@/components/layout/ModulePage";

export default function ReportsPage() {
  return (
    <ModulePage
      title="Reports & Analytics"
      description="Campaign and funnel performance dashboards for your branch."
      icon={BarChart3}
    />
  );
}
