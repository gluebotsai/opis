import { ROLES, getSession } from "./auth.js";

export const SALES_OVERSIGHT_BASE = "/sales-oversight";

export function isSalesOversightReadOnly() {
  return getSession()?.role === ROLES.ADMIN;
}
