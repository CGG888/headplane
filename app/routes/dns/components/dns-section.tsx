import type { ReactNode } from "react";

import cn from "~/utils/cn";

/**
 * One block of the DNS page.
 *
 * The page is a set of independent jobs — name the tailnet, list nameservers,
 * publish extra records, order search domains, flip MagicDNS — so each one is a
 * card with its own heading, the same shape the settings area uses. The card
 * fills the content box; only the prose inside it is capped to a readable
 * measure, so a one-line value is never stretched across the whole screen.
 */
export default function DnsSection({
  title,
  description,
  actions,
  className,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  /** Short controls that belong beside the heading, e.g. a toggle. */
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "flex flex-col gap-4 rounded-xl border p-4",
        "border-mist-200 bg-white",
        "dark:border-mist-800 dark:bg-mist-950/40",
        className,
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div className="flex min-w-0 flex-col gap-1">
          <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
          {description ? (
            <p className="max-w-3xl text-sm text-mist-600 dark:text-mist-400">{description}</p>
          ) : undefined}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : undefined}
      </header>

      {children}
    </section>
  );
}
