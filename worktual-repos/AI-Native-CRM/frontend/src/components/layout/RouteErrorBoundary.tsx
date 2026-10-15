import { Component, type ErrorInfo, type ReactNode } from "react";

const CHUNK_RELOAD_KEY = "worktual.chunkReload";
const CHUNK_RELOAD_GUARD_MS = 30_000;

export function isChunkLoadError(error: unknown): boolean {
  const message =
    error instanceof Error ? `${error.name} ${error.message}` : String(error || "");
  return /ChunkLoadError|Loading chunk .* failed|failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(
    message,
  );
}

function guardedChunkPath(): string | null {
  try {
    const raw = window.sessionStorage.getItem(CHUNK_RELOAD_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { pathname?: string; at?: number };
    if (
      !parsed.pathname ||
      !parsed.at ||
      Date.now() - parsed.at > CHUNK_RELOAD_GUARD_MS
    ) {
      window.sessionStorage.removeItem(CHUNK_RELOAD_KEY);
      return null;
    }
    return parsed.pathname;
  } catch {
    return null;
  }
}

function markChunkReload(pathname: string): boolean {
  if (guardedChunkPath() === pathname) return false;
  try {
    window.sessionStorage.setItem(
      CHUNK_RELOAD_KEY,
      JSON.stringify({ pathname, at: Date.now() }),
    );
  } catch {
    return false;
  }
  return true;
}

/**
 * Keep the one-reload guard long enough to stop a stale chunk reload loop,
 * then permit a later, unrelated deployment recovery in the same tab.
 */
export function clearChunkReloadGuard(): void {
  let raw: string | null = null;
  let delay = CHUNK_RELOAD_GUARD_MS;
  try {
    raw = window.sessionStorage.getItem(CHUNK_RELOAD_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as { at?: number };
    delay = Math.max(0, CHUNK_RELOAD_GUARD_MS - (Date.now() - Number(parsed.at || 0)));
  } catch {
    return;
  }
  window.setTimeout(() => {
    try {
      if (window.sessionStorage.getItem(CHUNK_RELOAD_KEY) === raw) {
        window.sessionStorage.removeItem(CHUNK_RELOAD_KEY);
      }
    } catch {
      // Storage can be unavailable in privacy-restricted contexts.
    }
  }, delay);
}

export class RouteErrorBoundary extends Component<
  { children: ReactNode; resetKey: string },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      "[crm-route] module failed to render",
      this.props.resetKey,
      error,
      info.componentStack,
    );
    if (
      isChunkLoadError(error) &&
      markChunkReload(window.location.pathname)
    ) {
      window.location.reload();
    }
  }

  componentDidUpdate(previous: Readonly<{ resetKey: string }>) {
    if (
      previous.resetKey !== this.props.resetKey &&
      this.state.error
    ) {
      this.setState({ error: null });
    }
  }

  private reload = () => {
    try {
      window.sessionStorage.removeItem(CHUNK_RELOAD_KEY);
    } catch {
      // Best effort.
    }
    window.location.reload();
  };

  render() {
    const error = this.state.error;
    if (!error) return this.props.children;
    const chunkFailure = isChunkLoadError(error);
    return (
      <div className="flex h-full min-h-0 w-full flex-1 items-center justify-center bg-canvas px-4">
        <section className="w-full max-w-lg rounded-xl border border-red-200 bg-white p-6 shadow-sm">
          <h1 className="text-lg font-semibold text-text-primary">
            {chunkFailure
              ? "This module needs a refresh"
              : "This module could not be displayed"}
          </h1>
          <p className="mt-2 text-sm text-red-700">
            {chunkFailure
              ? "The CRM was updated while this tab was open."
              : error.message || "An unexpected rendering error occurred."}
          </p>
          <button
            type="button"
            className="mt-4 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white"
            onClick={this.reload}
          >
            Reload CRM
          </button>
        </section>
      </div>
    );
  }
}
