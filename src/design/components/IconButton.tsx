import { forwardRef } from "react";
import { Button, type ButtonProps } from "./Button";

export interface IconButtonProps extends Omit<ButtonProps, "size" | "aria-label" | "asChild"> {
  /** Required: icon-only buttons need an accessible name. */
  "aria-label": string;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ variant = "ghost", ...props }, ref) => (
    <Button ref={ref} variant={variant} size="icon" {...props} />
  ),
);
IconButton.displayName = "IconButton";
