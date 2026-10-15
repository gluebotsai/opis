/** Avatar helpers for company/contact cards — mirrors Next `server/sales/stages`. */

export function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0]![0]}${parts[1]![0]}`.toUpperCase();
}

const AVATAR_COLORS = [
  "bg-violet-600",
  "bg-violet-700",
  "bg-neutral-700",
  "bg-violet-800",
  "bg-neutral-800",
  "bg-[#1869d3]",
  "bg-[#0e8f50]",
  "bg-[#874400]",
] as const;

export function avatarColorFromName(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}
