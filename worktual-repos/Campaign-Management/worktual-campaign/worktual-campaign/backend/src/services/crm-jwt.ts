import { createVerifier } from "fast-jwt";
import { env } from "../config/env.js";
import { UnauthorizedError } from "../helpers/response-builders.js";

type CrmJwtPayload = Record<string, unknown>;

let hs256Verifier: ReturnType<typeof createVerifier> | null = null;

function getHs256Verifier() {
  const secret = env.crmJwt.accessSecret;
  if (!secret) return null;
  if (!hs256Verifier) {
    hs256Verifier = createVerifier({
      key: secret,
      algorithms: [env.crmJwt.algorithm],
      ...(env.crmJwt.issuer ? { iss: env.crmJwt.issuer } : {}),
    });
  }
  return hs256Verifier;
}

export function isCrmJwtConfigured(): boolean {
  return Boolean(env.crmJwt.accessSecret);
}

/** Verify Worktual CRM access JWT (separate secret from Campaign SPA JWT). */
export async function verifyCrmAccessToken(token: string): Promise<string> {
  const verifier = getHs256Verifier();
  if (!verifier) {
    throw new UnauthorizedError();
  }

  let payload: CrmJwtPayload;
  try {
    const verified = verifier(token);
    payload = (verified instanceof Promise
      ? await verified
      : verified) as unknown as CrmJwtPayload;
  } catch {
    throw new UnauthorizedError();
  }

  const claim = env.crmJwt.userIdClaim;
  const raw = payload[claim];
  const userId =
    typeof raw === "string"
      ? raw.trim()
      : typeof raw === "number" || typeof raw === "bigint"
        ? String(raw).trim()
        : "";

  if (!userId) {
    throw new UnauthorizedError();
  }

  return userId;
}
