import type { ComponentType } from "react";
import type { OpOutcome } from "@/ipc/bindings";

/** One backend operation the user asked for; runs as a dry run first, then for real on confirm. */
export interface OperationSpec {
  repoId: string;
  /** Confirmation dialog title, e.g. "Merge feature into main?". */
  title: string;
  confirmLabel: string;
  /** Renders the confirm button in the danger style. */
  destructive?: boolean;
  /** False for light operations (checkout, create) that only ask when the preview needs it. */
  confirm?: boolean;
  run: (dryRun: boolean) => Promise<OpOutcome>;
  /** Toast text when the backend reports no message. */
  successMessage?: string;
}

/** A menu row. Shared by drop menus, context menus and palette commands. */
export type ActionEntry =
  | {
      kind: "item";
      id: string;
      label: string;
      /** Palette title when it should differ from the menu label. */
      paletteTitle?: string;
      /** Whether the palette lists it for the selected commit or branch. */
      palette?: boolean;
      icon?: ComponentType<{ className?: string }>;
      destructive?: boolean;
      disabled?: boolean;
      run: () => void;
    }
  | { kind: "separator" }
  | { kind: "label"; label: string };

export type ActionTarget =
  | { kind: "commit"; oid: string; shortOid: string }
  | {
      kind: "branch";
      name: string;
      fullName: string;
      remote: boolean;
      isHead: boolean;
      oid: string;
    }
  | { kind: "tag"; name: string; oid: string };

export type PromptRequest =
  | { kind: "branch"; repoId: string; startPoint: string; label: string }
  | { kind: "tag"; repoId: string; target: string; label: string }
  | { kind: "rename"; repoId: string; oldName: string };
