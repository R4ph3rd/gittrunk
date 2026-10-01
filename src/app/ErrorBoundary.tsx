import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/design/components";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Last-resort boundary around the whole app. Without it, any render error
 * unmounts React's tree and leaves an empty window with no clue.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("gittrunk crashed while rendering", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    const details = `${error.name}: ${error.message}\n\n${error.stack ?? ""}`;
    return (
      <div
        role="alert"
        className="flex h-full w-full flex-col items-center justify-center gap-4 bg-bg p-8 text-fg"
      >
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="max-w-lg text-center text-fg-muted">
          gittrunk hit an unexpected error while drawing this screen. Reloading usually recovers; if
          it keeps happening, please report the details below.
        </p>
        <pre className="max-h-64 w-full max-w-2xl overflow-auto rounded-md border border-border bg-surface p-3 font-mono text-sm text-fg-muted">
          {details}
        </pre>
        <div className="flex gap-2">
          <Button variant="primary" onClick={() => window.location.reload()}>
            Reload
          </Button>
          <Button onClick={() => void navigator.clipboard?.writeText(details)}>Copy details</Button>
        </div>
      </div>
    );
  }
}
