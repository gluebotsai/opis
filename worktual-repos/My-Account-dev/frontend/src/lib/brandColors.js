/** Brand palette — B&W for charts/UI; semantic colors for status & feedback */
export const brandColors = {
  neutral900: "#0B0B10",
  neutral800: "#23232B",
  neutral700: "#3F3F49",
  neutral600: "#5E5E69",
  neutral500: "#7E7E88",
  neutral400: "#A7A7AF",
  neutral300: "#C9C9CF",
  neutral200: "#E2E2E6",
  neutral100: "#F4F4F6",
  white: "#FFFFFF",
  violet700: "#5F1FB0",
  violet600: "#7423D7",
  violet500: "#8650DE",
  success: "#0E8F50",
  info: "#1869D3",
  warning: "#866300",
  danger: "#C73E32",
};

/** Charts stay monochrome (legacy tracks/grids) */
export const chartPalette = {
  primary: brandColors.neutral900,
  primaryMuted: brandColors.neutral700,
  primaryLight: brandColors.neutral300,
  primaryDark: brandColors.neutral900,
  grid: brandColors.neutral100,
  track: brandColors.neutral200,
};

/** Accent series for multi-series charts / funnels / adoption bars (UI_UX_CONSISTENCY) */
export const accentChartSeries = [
  "#653AE0",
  "#3A9EE0",
  "#098F6A",
  "#E0B73A",
  "#D83AE0",
  "#3A3FE0",
  "#E06E3A",
  "#808080",
];

/** Sales oversight Revenue trend line/area — locked red/warm accent (single series) */
export const accentRevenueTrend = "#E06E3A";

export const chartGreys = [
  brandColors.neutral900,
  brandColors.neutral800,
  brandColors.neutral700,
  brandColors.neutral600,
  brandColors.neutral400,
  brandColors.neutral300,
];

/**
 * Profile / initials avatar tones — accent palette only (no #808080).
 * Soft wash = accent @ ~14–18% on white + accent-colored initials.
 * Same seed → same tone forever (stable string hash).
 */
export const accentAvatarTones = [
  { tone: "purple", hex: "#653AE0" },
  { tone: "teal", hex: "#098F6A" },
  { tone: "amber", hex: "#E0B73A" },
  { tone: "rose", hex: "#D83AE0" },
  { tone: "blue", hex: "#3A9EE0" },
  { tone: "indigo", hex: "#3A3FE0" },
];

/** @deprecated Prefer accentAvatarTones[].tone — kept for call-site clarity */
export const AVATAR_TONES = accentAvatarTones.map((entry) => entry.tone);

function hashAvatarSeed(seed = "") {
  const value = String(seed || "");
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = value.charCodeAt(index) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
}

/** Stable tone name (purple|teal|amber|rose|blue|indigo) from id / email / name. */
export function getAvatarTone(seed = "") {
  const tones = accentAvatarTones;
  return tones[hashAvatarSeed(seed) % tones.length].tone;
}

/** Stable accent hex from the avatar palette for the given seed. */
export function getAvatarAccentHex(seed = "") {
  const tones = accentAvatarTones;
  return tones[hashAvatarSeed(seed) % tones.length].hex;
}

/** Initials for profile avatars — name preferred, else email local-part. */
export function getProfileInitials(name = "", email = "") {
  const source = String(name || email || "").trim();
  const parts = source.split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return "?";
  }

  if (parts.length === 1) {
    const single = parts[0];
    if (single.includes("@")) {
      return single.slice(0, 2).toUpperCase();
    }
    return single.slice(0, 2).toUpperCase();
  }

  return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
}
