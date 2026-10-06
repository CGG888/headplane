import { Check, Copy, Info } from "lucide-react";
import { useState, type ReactNode } from "react";

import { useAddressMask } from "~/components/address-visibility";
import { MaskedValue, RevealBadge } from "~/components/masked-text";
import Tooltip from "~/components/tooltip";
import { useI18n } from "~/i18n/provider";
import cn from "~/utils/cn";
import { copyToClipboard } from "~/utils/copy";
import toast from "~/utils/toast";

export interface MachineAttributeProps {
  name: string;
  value: string;
  tooltip?: string;
  isCopyable?: boolean;
  /** Renders the value in a monospace face; used for keys, IDs and addresses. */
  isCode?: boolean;
  /**
   * The value is an IP address, an IPv6 address, a network range or a domain
   * name, so it is masked by default and carries a reveal badge of its own. It
   * is deliberately not set for keys, IDs, dates and machine names.
   */
  isAddress?: boolean;
  /**
   * Small chips shown at the end of the row, e.g. which source serves a relay
   * and whether it is the one in use. The value keeps its own width.
   */
  badges?: ReactNode;
}

/**
 * One read-only fact on the machine detail page. Long values truncate with a
 * `title` tooltip, and copyable ones reveal a copy button on hover so keys and
 * addresses never wrap the definition list.
 *
 * An address is masked by default: the row shows the fixed mask, the copy click
 * still copies the real value, and the badge beside the value reveals it. The
 * hover title is dropped while it is hidden, because a tooltip would otherwise
 * be a second way to read the value.
 */
export default function MachineAttribute({
  name,
  value,
  tooltip,
  isCopyable,
  isCode,
  isAddress,
  badges,
}: MachineAttributeProps) {
  const { t } = useI18n();
  const [isCopied, setIsCopied] = useState(false);
  const { masked, canReveal, toggle } = useAddressMask(value);
  const isMasked = isAddress === true && masked;

  const handleCopy = async () => {
    const copied = await copyToClipboard(value);
    if (!copied) {
      toast(t("common.copyFailed"));
      return;
    }

    toast(t("common.copiedName", { name }));
    setIsCopied(true);
    window.setTimeout(() => setIsCopied(false), 1000);
  };

  return (
    // Baseline alignment keeps the label and the first line of the value on one
    // line even though the copyable value carries its own padding.
    <div className="grid grid-cols-[8rem_minmax(0,1fr)] items-baseline gap-x-3 py-1.5 text-sm sm:grid-cols-[10rem_minmax(0,1fr)]">
      <dt className="flex items-start gap-x-1 text-mist-600 dark:text-mist-400">
        <span className="min-w-0">{name}</span>
        {tooltip ? (
          <Tooltip content={tooltip}>
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 opacity-40 transition-opacity hover:opacity-100" />
          </Tooltip>
        ) : undefined}
      </dt>
      <dd className="flex min-w-0 items-center gap-x-1.5">
        {isCopyable ? (
          <button
            className={cn(
              "group/copy flex min-w-0 flex-1 items-center gap-x-1.5 rounded-md px-1.5 py-1 text-left",
              "transition-colors hover:bg-mist-100/70 dark:hover:bg-mist-800/70",
              "focus-visible:ring-2 focus-visible:ring-indigo-500/40 focus-visible:outline-hidden",
              "dark:focus-visible:ring-indigo-400/40",
            )}
            onClick={handleCopy}
            title={isMasked ? undefined : value}
            type="button"
          >
            <AttributeValue isCode={isCode} isMasked={isMasked} value={value} />
            {isCopied ? (
              <Check className="h-3.5 w-3.5 shrink-0 text-green-600 dark:text-green-400" />
            ) : (
              <Copy className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover/copy:opacity-60" />
            )}
          </button>
        ) : (
          <div className="min-w-0 flex-1 px-1.5 py-1" title={isMasked ? undefined : value}>
            <AttributeValue isCode={isCode} isMasked={isMasked} value={value} />
          </div>
        )}
        {isAddress === true && canReveal ? (
          <RevealBadge masked={masked} onToggle={toggle} />
        ) : undefined}
        {badges ? (
          <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">{badges}</span>
        ) : undefined}
      </dd>
    </div>
  );
}

/** Multi-line values (endpoints, latency) keep one truncated line per entry. */
function AttributeValue({
  value,
  isCode,
  isMasked,
}: {
  value: string;
  isCode?: boolean;
  isMasked?: boolean;
}) {
  const className = cn("min-w-0 truncate", isCode && "font-mono text-xs");

  // A hidden address is one mask and one badge, however many lines the value
  // has: per-line masks would still say how many endpoints there are, while the
  // copy click copies the whole value either way.
  if (isMasked === true) {
    return <MaskedValue className={className} masked value={value} />;
  }

  if (!value.includes("\n")) {
    return <div className={className}>{value}</div>;
  }

  return (
    <div className="flex min-w-0 flex-col">
      {value.split("\n").map((line) => (
        <div className={className} key={line} title={line}>
          {line}
        </div>
      ))}
    </div>
  );
}
