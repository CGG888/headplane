import { Eye, EyeOff } from "lucide-react";

import { useAddressMask } from "~/components/address-visibility";
import { useI18n } from "~/i18n/provider";
import { ADDRESS_MASK } from "~/utils/address-visibility";
import cn from "~/utils/cn";

/**
 * The masked value and its reveal badge.
 *
 * A value renders as one fixed mask — never as a shorter or longer mask that
 * would hint at the address behind it — plus a small button that reveals that
 * one value. The badge is a real button: it takes focus, carries the accessible
 * name of the action and `aria-pressed` for whether the value is shown, and its
 * box does not change between the two states, so nothing shifts on hover or on
 * click.
 *
 * `MaskedValue` and `RevealBadge` are presentational; they take the decision as
 * a prop so a caller that already reads {@link useAddressMask} — a copy button,
 * a detail row — can lay them out itself without deciding twice.
 */

/** The value itself, or the fixed mask a reader cannot see through. */
export function MaskedValue({
  masked,
  value,
  className,
  label,
}: {
  masked: boolean;
  value: string;
  className?: string;
  /**
   * What the mask stands for, for screen readers. Defaults to the address
   * wording; a caller hiding something that is not an address passes its own.
   */
  label?: string;
}) {
  const { t } = useI18n();

  if (!masked) {
    return <span className={className}>{value}</span>;
  }

  // The mask is decorative; the screen reader is told what it stands for
  // instead, so it never reads the bullets as the address.
  return (
    <span className={cn("inline-flex min-w-0 items-center", className)}>
      <span className="sr-only">{label ?? t("address.hidden")}</span>
      <span aria-hidden="true" className="shrink-0 whitespace-nowrap">
        {ADDRESS_MASK}
      </span>
    </span>
  );
}

/** The eye button that reveals, or re-hides, exactly one value. */
export function RevealBadge({
  masked,
  onToggle,
  className,
  label,
}: {
  masked: boolean;
  onToggle: () => void;
  className?: string;
  /** Accessible name and hover title. Defaults to the address wording. */
  label?: string;
}) {
  const { t } = useI18n();
  const text = label ?? t("address.reveal");

  return (
    <button
      aria-label={text}
      aria-pressed={!masked}
      className={cn(
        "flex h-5 w-5 shrink-0 items-center justify-center rounded-md",
        "text-mist-400 transition-colors duration-100",
        "hover:bg-mist-100 hover:text-mist-700",
        "focus-visible:ring-2 focus-visible:ring-indigo-500/40 focus-visible:outline-hidden",
        "dark:text-mist-500 dark:hover:bg-mist-800 dark:hover:text-mist-200",
        "dark:focus-visible:ring-indigo-400/40",
        className,
      )}
      onClick={onToggle}
      title={text}
      type="button"
    >
      {masked ? (
        <Eye aria-hidden="true" className="h-3.5 w-3.5" />
      ) : (
        <EyeOff aria-hidden="true" className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

/**
 * A whole displayed value: an address, an IPv6 address or a hostname, masked by
 * default and revealed by its own badge. A `title` is dropped while the value is
 * hidden — a hover tooltip would otherwise be a second way to read it — and the
 * caller's own title is used once the value is shown.
 */
export default function MaskedText({
  value,
  title,
  muted,
  className,
}: {
  value: string;
  /** Hover text for the shown value; defaults to the value itself. */
  title?: string;
  muted?: boolean;
  className?: string;
}) {
  const { masked, canReveal, toggle } = useAddressMask(value);

  return (
    <span
      className={cn(
        "inline-flex min-w-0 items-center gap-x-1.5",
        muted ? "text-mist-500 dark:text-mist-400" : undefined,
        className,
      )}
      title={masked ? undefined : (title ?? value)}
    >
      <MaskedValue className="min-w-0 truncate" masked={masked} value={value} />
      {canReveal ? <RevealBadge masked={masked} onToggle={toggle} /> : undefined}
    </span>
  );
}
