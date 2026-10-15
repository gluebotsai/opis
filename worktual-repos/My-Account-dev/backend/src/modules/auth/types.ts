export interface AuthPrincipal {
  sub: string;
  organizationId: string;
  role: string;
  permissions: string[];
  tokenKind?: "jwt" | "legacy";
}

export interface LegacyBearerVerifier {
  verify(token: string): Promise<AuthPrincipal | null>;
}

export interface AuthService {
  verifyLegacyBearer(token: string): Promise<AuthPrincipal | null>;
}
