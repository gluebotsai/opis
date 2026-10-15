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

/** Charts stay monochrome */
export const chartPalette = {
  primary: brandColors.neutral900,
  primaryMuted: brandColors.neutral700,
  primaryLight: brandColors.neutral300,
  primaryDark: brandColors.neutral900,
  grid: brandColors.neutral100,
  track: brandColors.neutral200,
};

export const chartGreys = [
  brandColors.neutral900,
  brandColors.neutral800,
  brandColors.neutral700,
  brandColors.neutral600,
  brandColors.neutral400,
  brandColors.neutral300,
];
