/**
 * Shared API response messages (aligned with channel-server RESPONSE style).
 */
export const RESPONSE = {
  success_message: "success",
  not_found: "No data found",
  bad_request: "Bad Request",
  internal_error: "Internal server error",
  faild: "failed",
  unauthorized: "Not signed in.",
  forbidden: "Forbidden",

  // Auth
  loginSuccess: "Login successful",
  logoutSuccess: "Logout successful",
  onboardingLinkCreated: "Onboarding dashboard link created",

  // Generic CRUD
  created: "Created successfully",
  updated: "Updated successfully",
  deleted: "Deleted successfully",
  fetched: "Fetched successfully",
} as const;

export type ResponseMessage = (typeof RESPONSE)[keyof typeof RESPONSE];
