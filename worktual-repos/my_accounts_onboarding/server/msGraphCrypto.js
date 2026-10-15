import crypto from "node:crypto";

import { getMicrosoftClientSecret } from "./msGraphConfig.js";
import { isProduction } from "./infra/env.js";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getEncryptionKey() {
  const explicit = process.env.MS_TOKEN_ENCRYPTION_KEY?.trim();
  if (explicit) {
    const buffer = Buffer.from(explicit, explicit.length === 64 ? "hex" : "utf8");
    if (buffer.length === 32) {
      return buffer;
    }

    return crypto.createHash("sha256").update(explicit).digest();
  }

  if (isProduction()) {
    throw new Error(
      "MS_TOKEN_ENCRYPTION_KEY is required in production for mail OAuth token encryption.",
    );
  }

  const secret = getMicrosoftClientSecret();
  if (!secret) {
    throw new Error("MS_CLIENT_SECRET is required to encrypt mail OAuth tokens.");
  }

  return crypto.scryptSync(secret, "worktual-mail-oauth", 32);
}

export function encryptSecret(value) {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptSecret(payload) {
  const [ivPart, tagPart, dataPart] = String(payload || "").split(":");
  if (!ivPart || !tagPart || !dataPart) {
    throw new Error("Invalid encrypted token payload.");
  }

  const key = getEncryptionKey();
  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    key,
    Buffer.from(ivPart, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagPart, "base64"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataPart, "base64")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
