import * as React from "react";
import { cn } from "@/utils/cn";

type ButtonVariant =
  | "default"
  | "secondary"
  | "outline"
  | "ghost"
  | "destructive";
type ButtonSize = "default" | "sm" | "icon";

const variantClassNames: Record<ButtonVariant, string> = {
  default:
    "bg-primary text-primary-foreground shadow-soft hover:bg-slate-800 hover:text-white",
  secondary: "bg-muted text-foreground hover:bg-slate-200",
  outline:
    "border border-border bg-white text-foreground shadow-sm hover:bg-muted",
  ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
  destructive:
    "bg-destructive text-destructive-foreground shadow-soft hover:bg-red-600",
};

const sizeClassNames: Record<ButtonSize, string> = {
  default: "h-9 px-3.5 py-2 text-sm",
  sm: "h-8 px-3 text-xs",
  icon: "h-8 w-8",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "default",
      size = "default",
      type = "button",
      ...props
    },
    ref,
  ) => (
    <button
      ref={ref}
      type={type}
      className={cn(
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-lg font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
        variantClassNames[variant],
        sizeClassNames[size],
        className,
      )}
      {...props}
    />
  ),
);

Button.displayName = "Button";
