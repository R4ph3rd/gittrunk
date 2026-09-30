import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/cn";
import { focusRing, transition } from "./shared";

const field = cn(
  "w-full rounded-md border border-border bg-bg-subtle px-2 text-base text-fg placeholder:text-fg-subtle hover:border-border-strong disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-danger",
  focusRing,
  transition,
);

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = "text", ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(field, "h-[var(--control-md)]", className)}
      {...props}
    />
  ),
);
Input.displayName = "Input";

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...props }, ref) => (
  <textarea ref={ref} className={cn(field, "min-h-16 py-1.5", className)} {...props} />
));
Textarea.displayName = "Textarea";
