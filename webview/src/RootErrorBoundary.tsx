import React, { type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };

type State = { error: Error | null; info: ErrorInfo | null };

/**
 * Surfaces React render errors in the webview (otherwise the panel stays blank with no stack).
 */
export class RootErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    this.setState({ info });
    console.error("[Promptful webview]", error, info.componentStack);
  }

  override render() {
    if (this.state.error) {
      return (
        <div
          style={{
            margin: 0,
            padding: 20,
            fontFamily: "var(--font, system-ui)",
            color: "var(--text, #1d1d1f)",
            background: "var(--bg, #f5f5f7)",
            minHeight: "100vh",
            boxSizing: "border-box",
          }}
        >
          <h1 style={{ fontSize: 16, margin: "0 0 8px" }}>Promptful could not render</h1>
          <p style={{ color: "#b00020", fontSize: 13, margin: "0 0 12px" }}>{this.state.error.message}</p>
          <pre
            style={{
              fontSize: 11,
              lineHeight: 1.4,
              overflow: "auto",
              maxHeight: "50vh",
              background: "rgba(0,0,0,0.04)",
              padding: 12,
              borderRadius: 8,
            }}
          >
            {this.state.error.stack}
            {this.state.info?.componentStack ? `\n${this.state.info.componentStack}` : ""}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
