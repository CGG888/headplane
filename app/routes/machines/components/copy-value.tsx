import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { useAddressMask } from "~/components/address-visibility";
import { MaskedValue, RevealBadge } from "~/components/masked-text";
import { useI18n } from "~/i18n/provider";
import cn from "~/utils/cn";
import { copyToClipboard } from "~/utils/copy";
import toast from "~/utils/toast";

/**
 * One address line in the list that copies itself on click. It is the same
 * interaction the machine detail page uses for its attributes — a copy glyph
 * appears on hover or keyboard focus, the click is confirmed with a brief check
 * — so the two pages do not teach two different copy gestures.
 *
 * The value is an address or a hostname, so it is masked by default: the copy
 * button shows the fixed mask and copies the *real* value, and the reveal badge
 * beside it shows this one address for as long as the reader wants it.
 */
export default function CopyValue({
  value,
  copiedMessage,
  muted,
  reveal = "hover",
  title,
  className,
}: {
  value: string;
  /** Toast shown on success; defaults to the IP message. */
  copiedMessage?: string;
  /** Renders quieter, for the MagicDNS line under the two IP addresses. */
  muted?: boolean;
  /**
   * Card rows have no hover to reveal the glyph with, so they show it always;
   * table rows keep it hidden until hover or focus.
   */
  reveal?: "hover" | "always";
  /**
   * Hover text for the value. Defaults to the value itself, which is what a
   * truncated address needs; a caller that has something to explain about the
   * value passes it here instead of printing a sentence under the row.
   */
  title?: string;
  className?: string;
}) {
  const { t } = useI18n();
  const [isCopied, setIsCopied] = useState(false);
  const { masked, canReveal, toggle } = useAddressMask(value);

  const handleCopy = async () => {
    const copied = await copyToClipboard(value);
    if (!copied) {
      toast(t("machines.row.copyFailed"));
      return;
    }

    toast(copiedMessage ?? t("machines.row.copiedIp"));
    setIsCopied(true);
    window.setTimeout(() => setIsCopied(false), 1000);
  };

  return (
    <span
      className={cn(
        "group/copy flex w-full min-w-0 items-center gap-x-1.5",
        muted ? "text-mist-500 dark:text-mist-400" : "text-mist-700 dark:text-mist-200",
        className,
      )}
    >
      {/* The copy click is its own button so the reveal badge beside it stays a
          separate, focusable control rather than a button inside a button. */}
      <button
        className={cn(
          "flex min-w-0 flex-1 items-center gap-x-1.5 rounded-sm py-0.5 text-left",
          "font-mono text-xs leading-4 tabular-nums",
          "transition-colors hover:text-indigo-600 dark:hover:text-indigo-400",
          "focus-visible:ring-2 focus-visible:ring-indigo-500/40 focus-visible:outline-hidden",
          "dark:focus-visible:ring-indigo-400/40",
        )}
        onClick={handleCopy}
        title={masked ? undefined : (title ?? value)}
        type="button"
      >
        <MaskedValue className="min-w-0 truncate" masked={masked} value={value} />
        {isCopied ? (
          <Check className="h-3 w-3 shrink-0 text-green-600 dark:text-green-400" />
        ) : (
          <Copy
            className={cn(
              "h-3 w-3 shrink-0 transition-opacity",
              reveal === "hover"
                ? "opacity-0 group-hover/copy:opacity-60 group-focus-visible/copy:opacity-60"
                : "opacity-50",
            )}
          />
        )}
      </button>
      {canReveal ? <RevealBadge masked={masked} onToggle={toggle} /> : undefined}
    </span>
  );
}
