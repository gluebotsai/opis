/**
 * Account DB ownership (accounts.setup_* / ACCOUNT_DATABASE_URL)
 *
 * CRM app may create/alter only: contacts (shared person identity), password_reset_tokens.
 * CRM-specific contact fields live in crm_qa.contact_profiles (not on shared contacts).
 *
 * Auth reads existing users / sessions; password reset tokens live beside users.
 *
 * Email/calendar OAuth and inbox (send/draft/trash) live in crm_qa —
 * see user_integration_connections and contact_activities.
 *
 * Before creating any new table in either database, ask for confirmation.
 */
export const ACCOUNT_DB_OWNS = ["contacts"] as const;
