// @ts-nocheck
import { Component } from "react";
import { AlertTriangle, Home, RefreshCw } from "lucide-react";

const CHUNK_RELOAD_KEY = "worktual-stale-chunk-reload";

function errorMessage(error) {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error || "");
}

export function isChunkLoadError(error) {
  const message = errorMessage(error);
  return (
    /Failed to fetch dynamically imported module/i.test(message) ||
    /Importing a module script failed/i.test(message) ||
    /error loading dynamically imported module/i.test(message) ||
    /Loading chunk [\d]+ failed/i.test(message) ||
    error?.name === "ChunkLoadError"
  );
}

function hasStaleChunkReloaded() {
  try {
    return sessionStorage.getItem(CHUNK_RELOAD_KEY) === "1";
  } catch {
    return false;
  }
}

function markStaleChunkReload() {
  try {
    sessionStorage.setItem(CHUNK_RELOAD_KEY, "1");
  } catch {
    // sessionStorage unavailable
  }
}

function clearStaleChunkReload() {
  try {
    sessionStorage.removeItem(CHUNK_RELOAD_KEY);
  } catch {
    // sessionStorage unavailable
  }
}

export class RouteErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("[RouteErrorBoundary]", error, info);

    if (!isChunkLoadError(error)) {
      return;
    }

    // One automatic reload per tab session — avoids loops if the chunk stays missing.
    if (hasStaleChunkReloaded()) {
      return;
    }

    markStaleChunkReload();
    window.location.reload();
  }

  handleRetry = () => {
    const { error } = this.state;
    if (isChunkLoadError(error)) {
      markStaleChunkReload();
      window.location.reload();
      return;
    }
    this.setState({ error: null });
  };

  handleGoHome = () => {
    this.setState({ error: null });
    clearStaleChunkReload();
    window.location.assign("/");
  };

  render() {
    const { error } = this.state;
    const { children } = this.props;

    if (!error) {
      return children;
    }

    const message = errorMessage(error) || "Something went wrong while loading this page.";
    const chunkError = isChunkLoadError(error);

    return (
      <section className="route-error-boundary" role="alert">
        <div className="route-error-boundary__card">
          <span className="route-error-boundary__icon" aria-hidden="true">
            <AlertTriangle size={28} strokeWidth={1.75} />
          </span>
          <h1>This page could not be loaded</h1>
          <p className="route-error-boundary__lead">
            {chunkError
              ? "A newer version of the app may have been deployed. Reload to pick up the latest files, or return to sign in."
              : "The app hit an unexpected error. You can try again or return to sign in."}
          </p>
          <p className="route-error-boundary__detail">{message}</p>
          <div className="route-error-boundary__actions">
            <button className="primary-button" onClick={this.handleRetry} type="button">
              <RefreshCw size={18} />
              {chunkError ? "Reload app" : "Try again"}
            </button>
            <button className="secondary-button" onClick={this.handleGoHome} type="button">
              <Home size={18} />
              Back to sign in
            </button>
          </div>
        </div>
      </section>
    );
  }
}
