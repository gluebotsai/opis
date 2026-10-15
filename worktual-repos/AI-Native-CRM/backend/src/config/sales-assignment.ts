/**
 * Soft types kept for imports; settings now live in CRM DB
 * (`dao/sales/assignment-settings.ts`). Env knobs are no longer used.
 */

export type {
  SeniorityTier,
  RepAssignmentProfile,
  SalesAssignmentConfig,
  OrgAssignmentSettingsView,
} from "@/dao/sales/assignment-settings";

export {
  DEFAULT_SENIOR_AMOUNT_THRESHOLD,
  isOnPto,
  getSalesAssignmentConfig,
  getOrCreateOrgAssignmentSettings,
  updateOrgAssignmentSettings,
  listRepAssignmentProfiles,
  upsertRepAssignmentProfile,
} from "@/dao/sales/assignment-settings";
