/* eslint-disable react-refresh/only-export-components */
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { focusRing, transition } from "./shared";
import { Spinner } from "./Spinner";

export const buttonVariants = cva(
  cn(
    "inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md border border-transparent font-medium disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0 coarse:min-h-[var(--touch-target)]",
    focusRing,
    transition,
  ),
  {
    variants: {
      variant: {
        primary: "bg-accent text-accent-fg shadow-sm hover:opacity-90",
        secondary: "border-border bg-surface-raised text-fg shadow-sm hover:bg-surface-hover",
        ghost: "text-fg-muted hover:bg-surface-hover hover:text-fg",
        danger: "bg-danger text-[color:var(--danger-fg)] shadow-sm hover:opacity-90",
        outline: "border-border-strong text-fg hover:bg-surface-hover",
      },
      size: {
        xs: "h-5 px-1.5 text-sm [&_svg]:size-3",
        sm: "h-[var(--control-sm)] px-2 text-sm",
        md: "h-[var(--control-md)] px-3 text-base",
        icon: "size-[var(--control-md)] p-0",
        "icon-xs": "size-5 p-0 [&_svg]:size-3",
        "icon-sm": "size-[var(--control-sm)] p-0",
      },
    },
    defaultVariants: { variant: "secondary", size: "md" },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    { className, variant, size, asChild, loading, disabled, children, type = "button", ...props },
    ref,
  ) => {
    if (asChild) {
      return (
        <Slot ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props}>
          {children}
        </Slot>
      );
    }
    return (
      <button
        ref={ref}
        type={type}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        className={cn(buttonVariants({ variant, size }), className)}
        {...props}
      >
        {loading ? <Spinner className="text-current" label="Loading" /> : null}
        {children}
      </button>
    );
  },
);
Button.displayName = "Button";
