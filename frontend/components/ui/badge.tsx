import * as React from "react";
import { cn } from "@/lib/utils";

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "success" | "warning" | "muted";
}

const badgeClassName: Record<NonNullable<BadgeProps["variant"]>, string> = {
  default: "border-primary/20 bg-primary/10 text-primary",
  success: "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:text-emerald-200",
  warning: "border-amber-500/25 bg-amber-500/12 text-amber-800 dark:text-amber-200",
  muted: "border-border bg-muted text-muted-foreground"
};

export function Badge({ className, variant = "default", ...props }: BadgeProps) {
  return (
    <span
      className={cn("inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium", badgeClassName[variant], className)}
      {...props}
    />
  );
}
