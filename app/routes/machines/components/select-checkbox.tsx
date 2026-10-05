import { useEffect, useRef } from "react";

import cn from "~/utils/cn";

interface SelectCheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  "aria-label": string;
  className?: string;
  disabled?: boolean;
  /** Renders the mixed state used by a "select all" box over a partial selection. */
  indeterminate?: boolean;
}

/**
 * Native checkbox that also supports the `indeterminate` state, which React
 * only exposes as a DOM property rather than an attribute.
 */
export default function SelectCheckbox({
  checked,
  onChange,
  className,
  disabled,
  indeterminate = false,
  "aria-label": ariaLabel,
}: SelectCheckboxProps) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  return (
    <input
      aria-label={ariaLabel}
      checked={checked}
      className={cn(
        "h-4 w-4 shrink-0 cursor-pointer rounded-[4px] border-mist-300 accent-indigo-500",
        "transition-colors duration-100",
        // The ring is keyboard-only: a pointer click on the box should not leave
        // a halo behind on the row it just selected.
        "focus-visible:ring-2 focus-visible:ring-indigo-500/40 focus-visible:ring-offset-1",
        "dark:border-mist-600 dark:focus-visible:ring-indigo-400/40 dark:focus-visible:ring-offset-mist-900",
        "disabled:cursor-not-allowed disabled:opacity-40",
        className,
      )}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
      ref={ref}
      type="checkbox"
    />
  );
}
