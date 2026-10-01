import type { ReactNode } from "react";
import { PanelBottom, PanelLeft, PanelRight } from "lucide-react";
import { IconButton, Tooltip } from "@/design/components";
import { usePlatform } from "@/app/platform";
import { formatShortcut } from "@/app/shortcuts";
import { useLayoutStore, type PanelId } from "@/stores/layout";

/** VS Code-style toggles for the sidebar, the bottom terminal and the right panel. */
export function LayoutToggles() {
  const { supportsTerminal } = usePlatform();
  const sidebar = useLayoutStore((s) => s.sidebar);
  const bottom = useLayoutStore((s) => s.bottom);
  const right = useLayoutStore((s) => s.right);
  const toggle = useLayoutStore((s) => s.toggle);

  const item = (
    panel: PanelId,
    label: string,
    shortcut: string,
    pressed: boolean,
    icon: ReactNode,
  ) => (
    <Tooltip content={label} shortcut={formatShortcut(shortcut)}>
      <IconButton size="sm" aria-label={label} aria-pressed={pressed} onClick={() => toggle(panel)}>
        {icon}
      </IconButton>
    </Tooltip>
  );

  return (
    <div role="group" aria-label="Layout" className="flex items-center gap-0.5">
      {item("sidebar", "Toggle sidebar", "mod+b", sidebar, <PanelLeft />)}
      {supportsTerminal
        ? item("bottom", "Toggle terminal", "mod+j", bottom, <PanelBottom />)
        : null}
      {item("right", "Toggle changes panel", "mod+alt+b", right, <PanelRight />)}
    </div>
  );
}
