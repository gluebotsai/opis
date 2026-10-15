/**
 * Platform DKIM keygen + DNS verify helpers (Mode B).
 * Private keys stay encrypted server-side — never send to the FE.
 */

import { createCipheriv, createDecipheriv, createHash, generateKeyPairSync, randomBytes } from "node:crypto";
import dns from "node:dns/promises";
import { env } from "../config/env.js";

export type DomainDnsRecord = {
  record?: string;
  name: string;
  type: string;
  value: string;
  ttl?: string;
  status?: string;
  priority?: number;
};

/** Matches CCAAS verify (`s1._domainkey`). Override with DKIM_SELECTOR. */
const DKIM_SELECTOR_DEFAULT = "s1";

function encryptionKey(): Buffer {
  const raw =
    process.env.DKIM_ENCRYPTION_KEY?.trim() ||
    env.jwtSecret ||
    "change-me-in-production-campaign";
  return createHash("sha256").update(raw).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decryptSecret(payload: string): string {
  const [ver, ivB64, tagB64, dataB64] = payload.split(":");
  if (ver !== "v1" || !ivB64 || !tagB64 || !dataB64) {
    throw new Error("Invalid encrypted secret format");
  }
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** Strip PEM armor → single-line base64 for DKIM p=. */
export function pemPublicToDkimP(publicKeyPem: string): string {
  return publicKeyPem
    .replace(/-----BEGIN PUBLIC KEY-----/g, "")
    .replace(/-----END PUBLIC KEY-----/g, "")
    .replace(/\s+/g, "");
}

export function buildDkimTxtValue(publicKeyP: string): string {
  return `v=DKIM1; k=rsa; p=${publicKeyP}`;
}

export type GeneratedDkim = {
  selector: string;
  publicKeyP: string;
  privateKeyPem: string;
  privateKeyEncrypted: string;
  dnsRecords: DomainDnsRecord[];
};

export function generatePlatformDkim(domain: string): GeneratedDkim {
  const selector =
    process.env.DKIM_SELECTOR?.trim() || DKIM_SELECTOR_DEFAULT;
  const { publicKey, privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  const publicKeyP = pemPublicToDkimP(publicKey);
  const dkimValue = buildDkimTxtValue(publicKeyP);
  const spfInclude = process.env.WORKTUAL_SPF_INCLUDE?.trim() || "";
  const spfValue = spfInclude
    ? `v=spf1 ${spfInclude} ~all`
    : "v=spf1 ~all";
  const dmarcValue = `v=DMARC1; p=none; rua=mailto:dmarc@${domain}`;
  const cnameTarget =
    process.env.WORKTUAL_CNAME_TARGET?.trim() || "worktualservices.info";

  const dnsRecords: DomainDnsRecord[] = [
    {
      record: "DKIM",
      name: `${selector}._domainkey.${domain}`,
      type: "TXT",
      value: dkimValue,
    },
    {
      record: "SPF",
      name: domain,
      type: "TXT",
      value: spfValue,
    },
    {
      record: "CNAME",
      name: `mail.${domain}`,
      type: "CNAME",
      value: cnameTarget,
    },
    {
      record: "DMARC",
      name: `_dmarc.${domain}`,
      type: "TXT",
      value: dmarcValue,
    },
  ];

  return {
    selector,
    publicKeyP,
    privateKeyPem: privateKey,
    privateKeyEncrypted: encryptSecret(privateKey),
    dnsRecords,
  };
}

function flattenTxt(records: string[][]): string {
  return records
    .map((chunks) => chunks.join(""))
    .join(" ")
    .replace(/\s+/g, "");
}

function extractDkimP(txt: string): string | null {
  const m = txt.match(/p=([A-Za-z0-9+/=]+)/i);
  return m?.[1] || null;
}

export type DnsVerifyResult = {
  dkimOk: boolean;
  spfOk: boolean;
  dmarcOk: boolean;
  dkimDetail: string;
  spfDetail: string;
  dmarcDetail: string;
};

/**
 * Live DNS checks against expected platform DKIM public + SPF include.
 */
export async function verifyDomainDns(input: {
  domain: string;
  selector: string;
  expectedPublicP: string;
  spfInclude?: string;
}): Promise<DnsVerifyResult> {
  const domain = input.domain.trim().toLowerCase();
  const selector = input.selector.trim() || DKIM_SELECTOR_DEFAULT;
  const expected = input.expectedPublicP.replace(/\s+/g, "");
  const spfNeedle = (
    input.spfInclude ||
    process.env.WORKTUAL_SPF_INCLUDE?.trim() ||
    "v=spf1"
  ).toLowerCase();

  let dkimOk = false;
  let dkimDetail = "DKIM TXT not found";
  try {
    const name = `${selector}._domainkey.${domain}`;
    const records = await dns.resolveTxt(name);
    const flat = flattenTxt(records);
    const p = extractDkimP(flat);
    if (p && p === expected) {
      dkimOk = true;
      dkimDetail = "DKIM p= matches stored public key";
    } else if (p) {
      dkimDetail = "DKIM TXT found but p= does not match generated key";
    } else if (flat.length) {
      dkimDetail = "DKIM TXT found but missing p=";
    }
  } catch (err) {
    dkimDetail =
      err instanceof Error ? `DKIM lookup failed: ${err.message}` : "DKIM lookup failed";
  }

  let spfOk = false;
  let spfDetail = "SPF TXT not found";
  try {
    const records = await dns.resolveTxt(domain);
    const joined = records.map((c) => c.join("")).join(" | ");
    const spf = records
      .map((c) => c.join(""))
      .find((r) => r.toLowerCase().startsWith("v=spf1"));
    if (spf && spf.toLowerCase().includes(spfNeedle.toLowerCase())) {
      spfOk = true;
      spfDetail = "SPF includes expected sender";
    } else if (spf) {
      spfDetail = `SPF found but missing ${spfNeedle}: ${spf.slice(0, 120)}`;
    } else {
      spfDetail = `No v=spf1 on ${domain} (${joined.slice(0, 80) || "empty"})`;
    }
  } catch (err) {
    spfDetail =
      err instanceof Error ? `SPF lookup failed: ${err.message}` : "SPF lookup failed";
  }

  let dmarcOk = false;
  let dmarcDetail = "DMARC TXT not found";
  try {
    const records = await dns.resolveTxt(`_dmarc.${domain}`);
    const flat = flattenTxt(records);
    if (/v=dmarc1/i.test(flat)) {
      dmarcOk = true;
      dmarcDetail = "DMARC record present";
    }
  } catch (err) {
    dmarcDetail =
      err instanceof Error
        ? `DMARC lookup failed: ${err.message}`
        : "DMARC lookup failed";
  }

  return { dkimOk, spfOk, dmarcOk, dkimDetail, spfDetail, dmarcDetail };
}
