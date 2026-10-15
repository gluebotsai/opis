import type {
  AuthPrincipal,
  AuthService,
  LegacyBearerVerifier,
} from "./types.js";

export class DefaultAuthService implements AuthService {
  public constructor(private readonly legacyVerifier?: LegacyBearerVerifier) {}

  public async verifyLegacyBearer(
    token: string,
  ): Promise<AuthPrincipal | null> {
    if (!this.legacyVerifier) return null;
    const principal = await this.legacyVerifier.verify(token);
    return principal ? { ...principal, tokenKind: "legacy" } : null;
  }
}
