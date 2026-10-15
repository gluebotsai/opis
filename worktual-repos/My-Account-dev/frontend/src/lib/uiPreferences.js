/** Theme + sidebar layout preferences (localStorage, shell-wide). */

export const UI_PREFERENCES_EVENT = "worktual:ui-preferences";

const THEME_KEY = "worktual.ui.theme";
const SIDEBAR_KEY = "worktual.ui.sidebarMode";

export const THEME_OPTIONS = [
  "light",
  // "dark",
  // "system",
];
export const SIDEBAR_MODE_OPTIONS = ["full", "icons", "hybrid"];

const DEFAULTS = {
  theme: "light",
  sidebarMode: "full",
};

let systemMediaListener = null;

function readStorage(key, allowed, fallback) {
  try {
    const raw = String(localStorage.getItem(key) || "").trim();
    if (allowed.includes(raw)) {
      return raw;
    }
  } catch {
    /* private mode / blocked storage */
  }
  return fallback;
}

export function getUiPreferences() {
  return {
    theme: readStorage(THEME_KEY, THEME_OPTIONS, DEFAULTS.theme),
    sidebarMode: readStorage(SIDEBAR_KEY, SIDEBAR_MODE_OPTIONS, DEFAULTS.sidebarMode),
  };
}

export function resolveTheme(preference = getUiPreferences().theme) {
  if (preference === "light" || preference === "dark") {
    return preference;
  }
  if (typeof window !== "undefined" && window.matchMedia) {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "light";
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function dispatchPreferences(prefs) {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent(UI_PREFERENCES_EVENT, {
      detail: {
        ...prefs,
        resolvedTheme: resolveTheme(prefs.theme),
      },
    }),
  );
}

function bindSystemThemeListener(enabled) {
  if (typeof window === "undefined" || !window.matchMedia) {
    return;
  }
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  if (systemMediaListener) {
    media.removeEventListener("change", systemMediaListener);
    systemMediaListener = null;
  }
  if (!enabled) {
    return;
  }
  systemMediaListener = () => {
    applyUiPreferences();
  };
  media.addEventListener("change", systemMediaListener);
}

export function applyUiPreferences(nextPrefs) {
  if (typeof document === "undefined") {
    return getUiPreferences();
  }

  const prefs = nextPrefs
    ? {
        theme: THEME_OPTIONS.includes(nextPrefs.theme) ? nextPrefs.theme : getUiPreferences().theme,
        sidebarMode: SIDEBAR_MODE_OPTIONS.includes(nextPrefs.sidebarMode)
          ? nextPrefs.sidebarMode
          : getUiPreferences().sidebarMode,
      }
    : getUiPreferences();

  const resolved = resolveTheme(prefs.theme);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.dataset.sidebarMode = prefs.sidebarMode;
  document.documentElement.dataset.themePreference = prefs.theme;

  bindSystemThemeListener(prefs.theme === "system");
  dispatchPreferences(prefs);
  return prefs;
}

export function setTheme(theme) {
  const next = THEME_OPTIONS.includes(theme) ? theme : DEFAULTS.theme;
  writeStorage(THEME_KEY, next);
  return applyUiPreferences({ ...getUiPreferences(), theme: next });
}

export function setSidebarMode(sidebarMode) {
  const next = SIDEBAR_MODE_OPTIONS.includes(sidebarMode) ? sidebarMode : DEFAULTS.sidebarMode;
  writeStorage(SIDEBAR_KEY, next);
  return applyUiPreferences({ ...getUiPreferences(), sidebarMode: next });
}

/** React-friendly subscription helper. */
export function subscribeUiPreferences(listener) {
  if (typeof window === "undefined") {
    return () => {};
  }
  function onEvent(event) {
    listener(event.detail || { ...getUiPreferences(), resolvedTheme: resolveTheme() });
  }
  window.addEventListener(UI_PREFERENCES_EVENT, onEvent);
  return () => window.removeEventListener(UI_PREFERENCES_EVENT, onEvent);
}
