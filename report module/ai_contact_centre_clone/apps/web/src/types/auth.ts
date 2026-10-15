export type UserRole = "admin" | "agent";

export type AuthUser = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  organizationId: string;
  organizationName: string;
  roleLabel: string;
  token: string;
};
