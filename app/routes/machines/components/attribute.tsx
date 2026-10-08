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
   * is deliberately not set for keys, IDs, dates and machine names — a key that
   * should be hidden sets {@link isSecret} instead.
   */
  isAddress?: boolean;
  /**
   * The value is a key the reader may not want on screen — the node key is the
   * one place this is set. It is masked by default and revealed by the same eye
   * badge as an address, and the mask, the remembered preference and the badge
   * are shared with addresses on purpose: one "keep sensitive values hidden"
   * control covers both. The accessible name and the hover title name this
   * value, so a screen reader is not told a node key is an address.
   */
  isSecret?: boolean;
  /**
   * Small chips shown at the end of the row, e.g. which source serves a relay
   * and whether it is the one in use. The value keeps its own width.
   */
  badges?: ReactNode;
  /**
   * A small decorative mark drawn before the value, e.g. the flag of the region
   * a relay is in. It is never part of the copied value, and never shrinks.
   */
  leading?: ReactNode;
}

/**
 * One read-only fact on the machine detail page. Long values truncate with a
 * `title` tooltip, and copyable ones reveal a copy button on hover so keys and
 * addresses never wrap the definition list.
 *
 * An address, or a key marked as a secret, is masked by default: the row shows
 * the fixed mask, the copy click still copies the real value, and the badge
 * beside the value reveals it. The hover title is dropped while it is hidden,
 * because a tooltip would otherwise be a second way to read the value.
 */
export default function MachineAttribute({
  name,
  value,
  tooltip,
  isCopyable,
  isCode,
  isAddress,
  isSecret,
  badges,
  leading,
}: MachineAttributeProps) {
  const { t } = useI18n();
  const [isCopied, setIsCopied] = useState(false);
  const { masked, canReveal, toggle } = useAddressMask(value);
  const canHide = isAddress === true || isSecret === true;
  const isMasked = canHide && masked;
  // A node key is not an address, so the mask and the badge name it instead of
  // claiming an address is hidden.
  const hiddenLabel = isSecret === true ? t("common.hiddenName", { name }) : undefined;
  const revealLabel = isSecret === true ? t("common.showName", { name }) : undefined;

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
        {leading ? <span className="flex shrink-0 items-center">{leading}</span> : undefined}
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
            <AttributeValue isCode={isCode} isMasked={isMasked} label={hiddenLabel} value={value} />
            {isCopied ? (
              <Check className="h-3.5 w-3.5 shrink-0 text-green-600 dark:text-green-400" />
            ) : (
              <Copy className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover/copy:opacity-60" />
            )}
          </button>
        ) : (
          <div className="min-w-0 flex-1 px-1.5 py-1" title={isMasked ? undefined : value}>
            <AttributeValue isCode={isCode} isMasked={isMasked} label={hiddenLabel} value={value} />
          </div>
        )}
        {canHide && canReveal ? (
          <RevealBadge label={revealLabel} masked={masked} onToggle={toggle} />
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
  label,
}: {
  value: string;
  isCode?: boolean;
  isMasked?: boolean;
  /** Screen-reader text for the mask; the address wording when absent. */
  label?: string;
}) {
  const className = cn("min-w-0 truncate", isCode && "font-mono text-xs");

  // A hidden value is one mask and one badge, however many lines it has:
  // per-line masks would still say how many endpoints there are, while the copy
  // click copies the whole value either way.
  if (isMasked === true) {
    return <MaskedValue className={className} label={label} masked value={value} />;
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
