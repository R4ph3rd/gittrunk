import type { CSSProperties, HTMLAttributes, Ref } from "react";
import { Archive, Cloud, GitBranch, Tag } from "lucide-react";
import type { RefLabel } from "@/ipc/bindings";
import { useRefColors } from "@/ipc/queries";
import { cn } from "@/lib/cn";
import { laneVar } from "@/lib/laneColor";
import { useRepoStore } from "@/stores/repo";
import { REF_CHIP_MAX_WIDTH } from "./layout";

type BadgeProps = {
  label: RefLabel;
  /** Lane color index; looked up by ref name when omitted. */
  color?: number;
  ref?: Ref<HTMLSpanElement>;
} & Omit<HTMLAttributes<HTMLSpanElement>, "color">;

const ICONS = {
  localBranch: GitBranch,
  remoteBranch: Cloud,
  tag: Tag,
  stash: Archive,
} as const;

function neutralTone(label: RefLabel): string {
  if (label.kind === "tag") return "border-warning/40 text-warning";
  if (label.kind === "remoteBranch") return "border-border-strong text-fg-muted";
  if (label.kind === "stash") return "border-border-strong text-fg-subtle";
  return "border-accent/40 bg-accent-muted text-accent";
}

function BadgeView({ label, color, className, style, ref, ...rest }: BadgeProps) {
  const Icon = ICONS[label.kind] ?? GitBranch;
  let tone: string;
  let colorStyle: CSSProperties | undefined;
  if (color === undefined) {
    tone = cn(
      neutralTone(label),
      label.isHead && "border-accent bg-accent font-semibold text-accent-fg",
    );
  } else if (label.isHead) {
    tone = "border font-semibold text-lane-fg";
    colorStyle = { backgroundColor: laneVar(color), borderColor: laneVar(color) };
  } else {
    tone = "";
    colorStyle = {
      color: laneVar(color),
      borderColor: laneVar(color),
      backgroundColor: `color-mix(in srgb, ${laneVar(color)} 16%, transparent)`,
    };
  }
  return (
    <span
      {...rest}
      ref={ref}
      data-kind={label.kind}
      data-head={label.isHead || undefined}
      title={label.fullName}
      className={cn(
        "inline-block h-[18px] shrink-0 truncate rounded-sm border px-1.5 align-middle font-mono text-xs leading-[16px]",
        tone,
        className,
      )}
      style={{ maxWidth: REF_CHIP_MAX_WIDTH, ...colorStyle, ...style }}
    >
      {label.isHead && color !== undefined && (
        <span
          aria-hidden
          className="mr-1 inline-block size-1.5 rounded-full bg-lane-fg align-middle"
        />
      )}
      <Icon aria-hidden className="mr-1 inline-block size-3 align-text-bottom" />
      {label.name}
    </span>
  );
}

/** Looks the lane color up by ref name; only mounted when the caller did not pass one. */
function ConnectedBadge(props: BadgeProps) {
  const colors = useRefColors(useRepoStore((s) => s.activeId));
  return <BadgeView {...props} color={colors.get(props.label.fullName)} />;
}

/** A branch, tag or stash label colored with its lane. */
export function RefBadge(props: BadgeProps) {
  return props.color === undefined ? <ConnectedBadge {...props} /> : <BadgeView {...props} />;
}
