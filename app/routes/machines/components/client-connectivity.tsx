import { Check, Info, X } from "lucide-react";

import Tooltip from "~/components/tooltip";
import { useI18n } from "~/i18n/provider";
import cn from "~/utils/cn";

export interface ClientConnectivityFact {
  /** The localized fact name, e.g. the label the tooltip explains. */
  name: string;
  tooltip?: string;
  value: boolean;
}

/**
 * The machine's self-reported connectivity facts as a compact two-column list.
 *
 * Seven one-per-row facts made this card the tallest thing in its row and left
 * the tag card beside it mostly empty, so the pairs are laid out on a
 * two-column grid with smaller type and tighter padding than the shared
 * `MachineAttribute` rows. The order is the caller's; nothing here reorders or
 * hides a fact.
 */
export default function ClientConnectivity({ facts }: { facts: ClientConnectivityFact[] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
      {facts.map((fact) => (
        <div
          className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-1.5 py-1 text-xs"
          key={fact.name}
        >
          <dt className="flex min-w-0 items-center gap-x-1 text-mist-600 dark:text-mist-400">
            <span className="min-w-0 truncate" title={fact.name}>
              {fact.name}
            </span>
            {fact.tooltip ? (
              <Tooltip content={fact.tooltip}>
                <Info className="h-3 w-3 shrink-0 opacity-40 transition-opacity hover:opacity-100" />
              </Tooltip>
            ) : undefined}
          </dt>
          <dd className="shrink-0">
            <ConnectivityValue value={fact.value} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * One yes/no answer. The check and the cross differ in shape as well as colour,
 * and the localized word is always spelled out, so the answer never depends on
 * the reader telling green from grey.
 *
 * Exported because the diagnostics card prints the one self-test answer the
 * connectivity card above it has no row for, and one yes/no answer should read
 * the same wherever it appears.
 */
export function ConnectivityValue({ value }: { value: boolean }) {
  const { t } = useI18n();
  const Icon = value ? Check : X;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-x-1 font-medium whitespace-nowrap",
        value ? "text-emerald-600 dark:text-emerald-400" : "text-mist-500 dark:text-mist-400",
      )}
    >
      <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      {value ? t("machines.common.yes") : t("machines.common.no")}
    </span>
  );
}
