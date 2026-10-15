import { Radar } from "lucide-react";
import { ModulePage } from "@/components/layout/ModulePage";

export default function EventsPage() {
  return (
    <ModulePage
      title="Events tracking"
      description="Track forms, webinars, coupons, and other campaign touchpoints."
      icon={Radar}
    />
  );
}
