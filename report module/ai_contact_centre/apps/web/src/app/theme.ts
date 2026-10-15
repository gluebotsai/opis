import type { ThemeConfig } from "antd";

/** Worktual design tokens — see docs/brand/UI_THEME.md */
export const worktualTheme: ThemeConfig = {
  token: {
    fontFamily: '"Inter Variable", ui-sans-serif, system-ui, sans-serif',
    colorPrimary: "#000000",
    colorPrimaryHover: "#262626",
    colorBgLayout: "#f3f4f6",
    colorBgContainer: "#ffffff",
    colorBorder: "#e5e5e5",
    colorText: "#171717",
    colorTextSecondary: "#525252",
    colorTextTertiary: "#a3a3a3",
    colorTextQuaternary: "#525252",
    colorError: "#dc2626",
    borderRadius: 12,
    borderRadiusLG: 16,
    controlHeight: 40,
    controlHeightLG: 44,
  },
  components: {
    Layout: { siderBg: "#111111", triggerBg: "#111111" },
    Button: { primaryShadow: "none", borderRadius: 12 },
    Card: { borderRadiusLG: 16 },
    Table: { headerBg: "#fafafa", headerColor: "#a3a3a3" },
    DatePicker: {
      cellActiveWithRangeBg: "#f3f4f6",
      cellHoverWithRangeBg: "#e5e7eb",
      cellRangeBorderColor: "#e5e7eb",
      activeBorderColor: "#d4d4d4",
      hoverBorderColor: "#d4d4d4",
    },
  },
};
