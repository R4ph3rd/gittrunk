import type { ReactNode } from "react";
import { LayoutOverrideContext, type Layout } from "./useLayout";

/** Forces individual layout fields; used by tests and the /design device frame. */
export function LayoutProvider({
  force,
  children,
}: {
  force?: Partial<Layout>;
  children: ReactNode;
}) {
  return (
    <LayoutOverrideContext.Provider value={force ?? null}>
      {children}
    </LayoutOverrideContext.Provider>
  );
}
