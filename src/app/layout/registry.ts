import type { ComponentType } from "react";
import type { Route, RouteName, TabId } from "@/stores/nav";

export interface TabScreenProps {
  repoId: string;
}
export type RouteScreenProps<N extends RouteName> = {
  repoId: string;
  route: Extract<Route, { name: N }>;
};
export type RouteScreens = { [N in RouteName]?: ComponentType<RouteScreenProps<N>> };
export interface ScreenContribution {
  tabs?: Partial<Record<TabId, ComponentType<TabScreenProps>>>;
  routes?: RouteScreens;
  /** Hook returning tab badges (e.g. Changes count). Called unconditionally on every render of
   *  MobileShell; contributions are static modules, so hook order is stable. */
  useTabBadges?: (repoId: string) => Partial<Record<TabId, number | boolean>>;
}
