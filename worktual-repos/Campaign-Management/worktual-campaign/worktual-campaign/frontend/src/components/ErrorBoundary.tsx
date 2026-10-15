import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
  /** Short label for the fallback (e.g. "Dashboard"). */
  label?: string;
};

type State = {
  error: Error | null;
};

/** Catches render errors so a single bad row does not blank the whole page. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.label ?? "page"}] render error`, error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex min-h-[12rem] flex-col items-center justify-center gap-3 px-6 py-10 text-center">
          <p className="text-sm font-medium text-neutral-900">
            {this.props.label ?? "This page"} could not be displayed.
          </p>
          <p className="max-w-md text-sm text-neutral-500">
            {this.state.error.message || "Something went wrong while loading."}
          </p>
          <button
            type="button"
            className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
            onClick={() => {
              this.setState({ error: null });
              window.location.reload();
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
