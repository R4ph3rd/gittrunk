import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppErrorBoundary } from "./ErrorBoundary";

function Boom(): never {
  throw new Error("kaboom");
}

describe("AppErrorBoundary", () => {
  it("shows the error and a reload button instead of a blank window", () => {
    // React and the boundary both report the error; silence the setup's spy for this test
    // (src/test/setup.ts restores it afterwards).
    vi.mocked(console.error).mockImplementation(() => {});
    render(
      <AppErrorBoundary>
        <Boom />
      </AppErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Something went wrong");
    expect(screen.getByText(/Error: kaboom/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });

  it("renders children when nothing throws", () => {
    render(
      <AppErrorBoundary>
        <p>fine</p>
      </AppErrorBoundary>,
    );
    expect(screen.getByText("fine")).toBeInTheDocument();
  });
});
