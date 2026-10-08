import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";

import Link from "~/components/link";
import { useI18n } from "~/i18n/provider";
import cn from "~/utils/cn";

export type FooterIntegrationMode = "docker" | "kubernetes" | "proc" | null;

const MODE_KEYS = {
  docker: "footer.mode.docker",
  kubernetes: "footer.mode.kubernetes",
  proc: "footer.mode.proc",
  none: "footer.mode.none",
} as const;

const MODE_HINT_KEYS = {
  docker: "footer.mode.dockerHint",
  kubernetes: "footer.mode.kubernetesHint",
  proc: "footer.mode.procHint",
  none: "footer.mode.noneHint",
} as const;

export interface FooterProps {
  isDebug: boolean;
  baseUrl: string;
  /**
   * How Headplane manages Headscale in this deployment, so the footer says
   * whether this is the dual-image (Docker), Kubernetes, or native setup
   * instead of leaving operators to guess from the compose file.
   */
  mode: FooterIntegrationMode;
}

export default function Footer({ isDebug, baseUrl, mode }: FooterProps) {
  const [urlVisible, setUrlVisible] = useState(false);
  const { t, tr } = useI18n();

  const modeKey = mode ?? "none";

  return (
    <footer
      className={cn(
        "fixed w-full bottom-0 left-0 z-20",
        "bg-mist-50 dark:bg-mist-950",
        "dark:border-t dark:border-mist-800",
      )}
    >
      <div className="container flex items-center justify-between py-2">
        <p className="text-xs">
          {tr("footer.about", {
            upstream: (
              <Link external styled to="https://github.com/tale/headplane">
                {t("footer.upstreamLink")}
              </Link>
            ),
            fork: (
              <Link external styled to="https://github.com/CGG888/headplaneCN">
                {t("footer.forkLink")}
              </Link>
            ),
          })}{" "}
          <Link external styled to="https://cgg888.github.io/headplaneCN/sponsor">
            {t("footer.sponsorLink")}
          </Link>
        </p>
        <div className="flex items-center gap-2 text-xs">
          {isDebug && (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 font-medium",
                "bg-amber-100 text-amber-800",
                "dark:bg-amber-900/50 dark:text-amber-300",
              )}
            >
              {t("footer.debug")}
            </span>
          )}
          <span
            className={cn(
              "rounded-full px-2 py-0.5 font-medium",
              "bg-mist-100 text-mist-700",
              "dark:bg-mist-800 dark:text-mist-200",
            )}
            title={t(MODE_HINT_KEYS[modeKey])}
          >
            {t(MODE_KEYS[modeKey])}
          </span>
          <p className="text-mist-500 dark:text-mist-400">
            {__VERSION__} &middot;{" "}
            {urlVisible ? (
              <code>{baseUrl}</code>
            ) : (
              <span aria-hidden="true">&bull;&bull;&bull;&bull;&bull;</span>
            )}
            <button
              type="button"
              aria-label={urlVisible ? t("footer.hideServerUrl") : t("footer.showServerUrl")}
              className={cn(
                "ml-1 inline-flex align-middle rounded-xs p-0.5",
                "text-mist-400 hover:text-mist-600",
                "dark:text-mist-500 dark:hover:text-mist-300",
                "focus:outline-hidden focus:ring-2 focus:ring-indigo-500/40 focus:ring-offset-1",
                "dark:focus:ring-indigo-400/40 dark:focus:ring-offset-mist-900",
              )}
              onClick={() => setUrlVisible((v) => !v)}
            >
              {urlVisible ? <EyeOff size={12} /> : <Eye size={12} />}
            </button>
          </p>
        </div>
      </div>
    </footer>
  );
}
