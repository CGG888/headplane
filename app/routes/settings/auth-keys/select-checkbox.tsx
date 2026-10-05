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
        "h-4 w-4 cursor-pointer rounded border-mist-300 accent-indigo-500",
        "focus:ring-2 focus:ring-indigo-500/40 focus:ring-offset-1",
        "dark:border-mist-600 dark:focus:ring-indigo-400/40 dark:focus:ring-offset-mist-900",
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
