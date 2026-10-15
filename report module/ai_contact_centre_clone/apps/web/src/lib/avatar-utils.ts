import { cn } from "@/lib/utils";

const PROFILE_AVATAR_TONES = [
  "bg-sky-100 text-sky-700",
  "bg-violet-100 text-violet-700",
  "bg-emerald-100 text-emerald-700",
  "bg-amber-100 text-amber-800",
  "bg-rose-100 text-rose-700",
  "bg-teal-100 text-teal-700",
  "bg-fuchsia-100 text-fuchsia-700",
  "bg-blue-100 text-blue-700",
] as const;

export function profileAvatarTone(seed: string) {
  let hash = 0;
  for (let index = 0; index < seed.length; index += 1) {
    hash = (hash + seed.charCodeAt(index) * (index + 1)) % PROFILE_AVATAR_TONES.length;
  }
  return PROFILE_AVATAR_TONES[hash] ?? PROFILE_AVATAR_TONES[0];
}

export function profileAvatarClassName(seed: string, className?: string) {
  return cn(
    "flex aspect-square shrink-0 self-start items-center justify-center rounded-full font-semibold",
    profileAvatarTone(seed),
    className,
  );
}

export function profileInitials(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return "";
  const parts = trimmed.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    const alphaNumeric = parts[0]!.replace(/[^A-Za-z0-9]/g, "");
    return (alphaNumeric[0] ?? parts[0]![0] ?? "").toUpperCase();
  }
  return parts
    .slice(0, 2)
    .map((part) => (part.replace(/[^A-Za-z0-9]/g, "")[0] ?? part[0] ?? "").toUpperCase())
    .join("");
}

export function isPhoneLikeDisplayName(name?: string | null): boolean {
  const trimmed = name?.trim();
  if (!trimmed) return false;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 7) return false;
  const significant = trimmed.replace(/[\s().+-]/g, "");
  return digits.length >= significant.length * 0.8;
}

const GENERIC_PROFILE_NAMES = new Set([
  "whatsapp",
  "webchat",
  "webchat visitor",
  "unknown contact",
  "email conversation",
  "webchat conversation",
]);

export function isGenericProfileName(name?: string | null): boolean {
  const normalized = name?.trim().toLowerCase();
  return !normalized || GENERIC_PROFILE_NAMES.has(normalized);
}

export function resolveProfileDisplayName(
  ...candidates: Array<string | null | undefined>
): string {
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (!trimmed || isPhoneLikeDisplayName(trimmed) || isGenericProfileName(trimmed)) {
      continue;
    }
    return trimmed;
  }
  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (trimmed) return trimmed;
  }
  return "";
}
