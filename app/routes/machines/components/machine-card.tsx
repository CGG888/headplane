import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import cn from "~/utils/cn";

export interface MachineCardProps {
  title: string;
  icon: LucideIcon;
  description?: ReactNode;
  /** The card's own action, pinned to the header's top-right corner. */
  action?: ReactNode;
  /** A chip shown next to the title, e.g. a tag count or the relay state. */
  status?: ReactNode;
  tone?: "default" | "danger";
  className?: string;
  children: ReactNode;
}

/**
 * The block used for every section of the machine detail page. It mirrors the
 * settings cards (icon tile, rounded-xl border, one divider) so both pages read
 * as the same product, and owns its own border so nothing nests two of them.
 */
export default function MachineCard({
  title,
  icon: Icon,
  description,
  action,
  status,
  tone = "default",
  className,
  children,
}: MachineCardProps) {
  const isDanger = tone === "danger";

  return (
    <section
      className={cn(
        "flex min-w-0 flex-col overflow-hidden rounded-xl border bg-white",
        "dark:bg-mist-900",
        isDanger ? "border-red-200 dark:border-red-500/30" : "border-mist-200 dark:border-mist-800",
        className,
      )}
    >
      <header className="flex items-start gap-3 p-3.5">
        <span
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
            isDanger
              ? "bg-red-50 text-red-600 dark:bg-red-500/10 dark:text-red-400"
              : "bg-mist-100 text-mist-600 dark:bg-mist-800 dark:text-mist-300",
          )}
        >
          <Icon className="h-4 w-4" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="leading-snug font-medium text-mist-900 dark:text-mist-50">{title}</h2>
            {status}
          </div>
          {description ? (
            <p className="text-sm text-mist-600 dark:text-mist-400">{description}</p>
          ) : undefined}
        </div>
        {action ? <div className="shrink-0">{action}</div> : undefined}
      </header>
      <div className="min-w-0 flex-1 border-t border-mist-100 px-3.5 py-3 dark:border-mist-800/80">
        {children}
      </div>
    </section>
  );
}
