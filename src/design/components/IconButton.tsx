import { forwardRef } from "react";
import { cn } from "@/lib/cn";
import { Button, type ButtonProps } from "./Button";

const sizeMap = { xs: "icon-xs", sm: "icon-sm", md: "icon" } as const;

export interface IconButtonProps extends Omit<ButtonProps, "size" | "aria-label" | "asChild"> {
  /** Required: icon-only buttons need an accessible name. */
  "aria-label": string;
  /** xs 20px, sm 24px, md 28px (default). */
  size?: keyof typeof sizeMap;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ variant = "ghost", size = "md", className, ...props }, ref) => (
    <Button
      ref={ref}
      variant={variant}
      size={sizeMap[size]}
      className={cn("coarse:min-w-[var(--touch-target)]", className)}
      {...props}
    />
  ),
);
IconButton.displayName = "IconButton";
