import { useEffect, useState } from "react";
import { avatarColorFromName, initialsFromName } from "@/lib/avatar";

/** Same-origin icons when enrichment stored a broken/missing logo. */
function siteLogoCandidates(domain: string | null | undefined): string[] {
  const host = (domain ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];
  if (!host || !host.includes(".")) return [];
  return [
    `https://www.${host}/apple-touch-icon.png`,
    `https://www.${host}/apple-touch-icon-precomposed.png`,
    `https://${host}/apple-touch-icon.png`,
    `https://www.${host}/favicon.ico`,
    `https://${host}/favicon.ico`,
  ];
}

function logoCandidates(
  logoUrl: string | null | undefined,
  domain: string | null | undefined,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const url of [logoUrl?.trim() || null, ...siteLogoCandidates(domain)]) {
    if (!url || seen.has(url)) continue;
    // Skip obviously broken enrichment scrapes (spaces / empty).
    if (/[\s\u00A0]/.test(url)) continue;
    seen.add(url);
    out.push(url);
  }
  return out;
}

export function CompanyLogo({
  name,
  logoUrl,
  domain,
  size = "md",
}: {
  name: string;
  logoUrl?: string | null;
  domain?: string | null;
  size?: "sm" | "md";
}) {
  const candidates = logoCandidates(logoUrl, domain);
  const [index, setIndex] = useState(0);
  const active = candidates[index] ?? null;

  useEffect(() => {
    setIndex(0);
  }, [logoUrl, domain, name]);

  const showImage = Boolean(active);
  const dim = size === "sm" ? "size-9" : "size-11";
  const text = size === "sm" ? "text-xs" : "text-sm";

  return (
    <span className={`relative inline-flex shrink-0 ${dim}`}>
      {showImage ? (
        <img
          key={active}
          src={active!}
          alt=""
          width={size === "sm" ? 36 : 44}
          height={size === "sm" ? 36 : 44}
          className={`${dim} rounded-xl border border-border-default bg-white object-contain p-1`}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setIndex((i) => i + 1)}
        />
      ) : null}
      <span
        className={`inline-flex ${dim} items-center justify-center rounded-xl font-semibold text-white ${text} ${avatarColorFromName(name)}`}
        style={showImage ? { display: "none" } : undefined}
        aria-hidden={showImage}
      >
        {initialsFromName(name)}
      </span>
    </span>
  );
}
