import type { AppRole } from "@/service/auth/rbac";

/** Marketing SEO surface: marketing + admin/sales_manager only. */
export function canAccessMarketingSeo(role: AppRole): boolean {
  return (
    role === "admin" || role === "sales_manager" || role === "marketing"
  );
}
