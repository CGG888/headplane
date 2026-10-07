import { AlertCircle, CloudOff, Info, TriangleAlert, X } from "lucide-react";
import { useState } from "react";

import { useI18n } from "~/i18n/provider";
import cn from "~/utils/cn";

type Variant = "info" | "warning" | "error" | "critical";

interface StatusBannerProps {
  variant: Variant;
  title: string;
  children: React.ReactNode;
  dismissable?: boolean;
  className?: string;
}

const icons: Record<Variant, React.ReactNode> = {
  info: <Info className="h-5 w-5 shrink-0" />,
  warning: <TriangleAlert className="h-5 w-5 shrink-0" />,
  error: <AlertCircle className="h-5 w-5 shrink-0" />,
  critical: <CloudOff className="h-5 w-5 shrink-0" />,
};

export default function StatusBanner({
  variant,
  title,
  children,
  dismissable = true,
  className,
}: StatusBannerProps) {
  const { t } = useI18n();
  // The dismissal belongs to one message, not to the component instance: a
  // banner that changes variant or title (the live connection status does) is a
  // new message and has to be shown again.
  const signature = `${variant}:${title}`;
  const [dismissedSignature, setDismissedSignature] = useState<string | null>(null);

  if (dismissedSignature === signature) {
    return null;
  }

  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-3 rounded-lg border px-4 py-3 text-sm",
        variant === "info" && [
          "border-indigo-200 bg-indigo-50 text-indigo-900",
          "dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-200",
        ],
        variant === "warning" && [
          "border-yellow-300 bg-yellow-50 text-yellow-900",
          "dark:border-yellow-500/30 dark:bg-yellow-500/10 dark:text-yellow-200",
        ],
        variant === "error" && [
          "border-red-300 bg-red-50 text-red-900",
          "dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200",
        ],
        variant === "critical" && [
          "border-red-400 bg-red-100 text-red-900",
          "dark:border-red-500/40 dark:bg-red-500/20 dark:text-red-100",
        ],
        className,
      )}
    >
      {icons[variant]}
      <div className="flex-1">
        <p className="font-medium">{title}</p>
        <div className="mt-0.5 text-current/80">{children}</div>
      </div>
      {dismissable && (
        <button
          type="button"
          aria-label={t("common.dismiss")}
          onClick={() => setDismissedSignature(signature)}
          className={cn(
            "shrink-0 rounded p-0.5 transition-colors",
            "hover:bg-black/10 dark:hover:bg-white/10",
          )}
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}
