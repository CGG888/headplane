import { Check, Copy, Info } from "lucide-react";
import { useState } from "react";

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
}

/**
 * One read-only fact on the machine detail page. Long values truncate with a
 * `title` tooltip, and copyable ones reveal a copy button on hover so keys and
 * addresses never wrap the definition list.
 */
export default function MachineAttribute({
  name,
  value,
  tooltip,
  isCopyable,
  isCode,
}: MachineAttributeProps) {
  const { t } = useI18n();
  const [isCopied, setIsCopied] = useState(false);

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
      <dd className="min-w-0">
        {isCopyable ? (
          <button
            className={cn(
              "group/copy flex w-full min-w-0 items-center gap-x-1.5 rounded-md px-1.5 py-1 text-left",
              "transition-colors hover:bg-mist-100/70 dark:hover:bg-mist-800/70",
              "focus-visible:ring-2 focus-visible:ring-indigo-500/40 focus-visible:outline-hidden",
              "dark:focus-visible:ring-indigo-400/40",
            )}
            onClick={handleCopy}
            title={value}
            type="button"
          >
            <AttributeValue isCode={isCode} value={value} />
            {isCopied ? (
              <Check className="h-3.5 w-3.5 shrink-0 text-green-600 dark:text-green-400" />
            ) : (
              <Copy className="h-3.5 w-3.5 shrink-0 opacity-0 transition-opacity group-hover/copy:opacity-60" />
            )}
          </button>
        ) : (
          <div className="min-w-0 px-1.5 py-1" title={value}>
            <AttributeValue isCode={isCode} value={value} />
          </div>
        )}
      </dd>
    </div>
  );
}

/** Multi-line values (endpoints, latency) keep one truncated line per entry. */
function AttributeValue({ value, isCode }: { value: string; isCode?: boolean }) {
  const className = cn("min-w-0 truncate", isCode && "font-mono text-xs");

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
