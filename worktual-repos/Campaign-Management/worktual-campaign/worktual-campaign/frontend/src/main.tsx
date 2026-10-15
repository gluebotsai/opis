import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { BrowserRouter } from "react-router-dom";
import { ensureRandomUuid } from "@/lib/ensure-random-uuid";
import { initEmbedAuth, getEmbedToken, isEmbedMode, subscribeEmbedToken, clearEmbedAuth } from "@/lib/embed-auth";
import { refreshAgentsSocketAuth } from "@/services/agents.socket";
import { clearSpaToken } from "@/services/api";
import { store } from "@/store";
import { bootstrapAuth, refreshEmbedSession } from "@/store/slices/authSlice";
import { AppRouter } from "@/routes/AppRouter";
import "./index.css";

ensureRandomUuid();

let lastHandledEmbedToken: string | null = null;

function handleEmbedTokenFromCrm(token: string) {
  if (isEmbedMode()) clearSpaToken();

  const { user, status } = store.getState().auth;
  const sameToken = lastHandledEmbedToken === token;
  lastHandledEmbedToken = token;

  if (!sameToken) {
    refreshAgentsSocketAuth();
  }

  // CRM sends auth on load even when iframe already bootstrapped via ?crm_token=.
  // Re-running full bootstrap unmounts the UI to a blank screen — skip if unchanged.
  if (sameToken && user && status === "authenticated") {
    return;
  }

  if (user && status === "authenticated") {
    void store.dispatch(refreshEmbedSession());
    return;
  }

  void store.dispatch(bootstrapAuth());
}

subscribeEmbedToken(handleEmbedTokenFromCrm);

void (async () => {
  await initEmbedAuth();
  // Top-level standalone: drop leftover CRM embed session so SPA auth wins.
  if (!isEmbedMode()) clearEmbedAuth();
  else clearSpaToken();
  const seeded = getEmbedToken();
  if (seeded) lastHandledEmbedToken = seeded;
  const existing = store.getState().auth;
  if (!existing.user && existing.status !== "loading") {
    await store.dispatch(bootstrapAuth());
  }
})();

createRoot(document.getElementById("root")!).render(
  <Provider store={store}>
    <BrowserRouter>
      <AppRouter />
    </BrowserRouter>
  </Provider>,
);
