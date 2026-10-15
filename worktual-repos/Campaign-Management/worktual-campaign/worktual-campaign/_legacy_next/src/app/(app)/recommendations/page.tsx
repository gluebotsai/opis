import { redirect } from "next/navigation";

/** Recommendations live on Create campaign (below Draft). */
export default function RecommendationsPage() {
  redirect("/campaigns/create");
}
