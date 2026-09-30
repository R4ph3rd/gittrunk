import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";

vi.mock("@/ipc/bindings", () => ({
  commands: {
    appInfo: () =>
      Promise.resolve({
        status: "ok",
        data: { version: "0.1.0", gitVersion: "git version 2.45.0", platform: "windows" },
      }),
  },
}));

describe("App", () => {
  it("renders backend info through the typed contract", async () => {
    const client = new QueryClient();
    render(
      <QueryClientProvider client={client}>
        <App />
      </QueryClientProvider>,
    );
    expect(
      await screen.findByText(/v0\.1\.0 · windows · git version 2\.45\.0/),
    ).toBeInTheDocument();
  });
});
