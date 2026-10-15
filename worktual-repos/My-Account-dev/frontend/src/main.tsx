// @ts-nocheck
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App.tsx";
import { installSelectZeroOnFocus } from "./lib/integerInputFocus.js";
import { applyUiPreferences } from "./lib/uiPreferences.js";
import "./styles.css";
import "./styles/brand-portals.css";
import "./styles/brand-enforcement.css";
import "./styles/profile-avatar.css";
import "./styles/portal-chrome.css";
import "./styles/theme-dark.css";

// Theme + sidebar mode before first paint (localStorage → data-theme / data-sidebar-mode).
applyUiPreferences();

// Integer/decimal fields showing exact `0` select on focus so typing replaces it.
installSelectZeroOnFocus();
if (import.meta.hot) {
  import.meta.hot.accept("./lib/integerInputFocus.js", () => {
    installSelectZeroOnFocus();
  });
  import.meta.hot.accept("./lib/uiPreferences.js", () => {
    applyUiPreferences();
  });
}

// StrictMode intentionally omitted: in React 18+ dev it remounts the tree and
// doubles every mount-effect API call. Production already runs effects once.
createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <App />
  </BrowserRouter>,
);
