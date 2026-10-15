import { Component, type ErrorInfo, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { Provider } from "react-redux";
import { BrowserRouter } from "react-router-dom";
import setupLocatorUI from "@locator/runtime";
import { App } from "./App";
import { store } from "./store";
import "./styles/globals.css";

declare global {
  interface Window {
    __crmBootReady?: () => void;
    __crmBootFail?: (message?: string) => void;
  }
}

class AppErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[crm-render] uncaught render error", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas px-4">
        <section className="w-full max-w-lg rounded-xl border border-red-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-text-primary">
            CRM could not display this page
          </h1>
          <p className="mt-2 text-sm text-red-700">
            {this.state.error.message || "An unexpected rendering error occurred."}
          </p>
          <button
            type="button"
            className="mt-4 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
            onClick={() => window.location.reload()}
          >
            Reload CRM
          </button>
        </section>
      </main>
    );
  }
}

const container = document.getElementById("root");

if (!container) {
  throw new Error("CRM bootstrap failed: #root is missing.");
}

try {
  if (import.meta.env.DEV) {
    setupLocatorUI();
  }

  const root = createRoot(container);
  root.render(
    <AppErrorBoundary>
      <Provider store={store}>
        <BrowserRouter useTransitions={false}>
          <App />
        </BrowserRouter>
      </Provider>
    </AppErrorBoundary>,
  );
} catch (error) {
  console.error("[crm-bootstrap] render failed", error);
  window.__crmBootFail?.(
    error instanceof Error ? error.message : "CRM failed to start.",
  );
}
