import * as React from "react";
import { cn } from "@/utils/cn";

export const Label = React.forwardRef<HTMLLabelElement, React.LabelHTMLAttributes<HTMLLabelElement>>(
  ({ className, ...props }, ref) => (
    <label ref={ref} className={cn("text-xs font-medium text-slate-600", className)} {...props} />
  ),
);

Label.displayName = "Label";
