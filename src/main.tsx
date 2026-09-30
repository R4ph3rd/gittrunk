import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { lazy, StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import { Toaster, TooltipProvider } from "./design/components";
import { ThemeProvider } from "./design/theme";
import "./index.css";

// Dev-only design system page at /design.
const DesignPage = import.meta.env.DEV ? lazy(() => import("./design/DesignPage")) : null;
const showDesign = DesignPage !== null && window.location.pathname === "/design";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      {showDesign && DesignPage ? (
        <Suspense fallback={null}>
          <DesignPage />
        </Suspense>
      ) : (
        <ThemeProvider>
          <TooltipProvider>
            <App />
            <Toaster />
          </TooltipProvider>
        </ThemeProvider>
      )}
    </QueryClientProvider>
  </StrictMode>,
);
