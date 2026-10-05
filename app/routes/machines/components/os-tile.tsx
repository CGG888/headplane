import { MonitorSmartphone } from "lucide-react";

import androidSvg from "~/assets/android.svg";
import iosSvg from "~/assets/ios.svg";
import linuxSvg from "~/assets/linux.svg";
import macosSvg from "~/assets/macos.svg";
import windowsSvg from "~/assets/windows.svg";
import { useI18n } from "~/i18n/provider";
import cn from "~/utils/cn";
import { getOSInfo } from "~/utils/host-info";
import type { PopulatedNode } from "~/utils/node-info";

/**
 * Tailscale reports `HostInfo.OS` with the same names as `runtime.GOOS` except
 * for Apple platforms, which report `macOS` and `iOS` (see `~/utils/host-info`).
 * Anything else (FreeBSD, tvOS, or a machine the agent has not seen) falls back
 * to the generic device glyph.
 */
const OS_LOGOS: Record<string, string> = {
  android: androidSvg,
  iOS: iosSvg,
  linux: linuxSvg,
  macOS: macosSvg,
  windows: windowsSvg,
};

/**
 * The device identity tile that sits to the left of every machine name. It is
 * deliberately a muted neutral square — the same tile the settings cards use —
 * so a column of them reads as "devices" without turning the list into a wall
 * of colour. The reported OS and version stay in the `title`.
 */
export default function OSTile({ node, className }: { node: PopulatedNode; className?: string }) {
  const { t } = useI18n();
  const logo = node.hostInfo?.OS ? OS_LOGOS[node.hostInfo.OS] : undefined;
  const label = node.hostInfo ? getOSInfo(node.hostInfo) : t("machines.common.unknown");

  return (
    <span
      className={cn(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
        "bg-mist-100 text-mist-500 ring-1 ring-mist-200/80 ring-inset",
        "dark:bg-mist-800 dark:text-mist-400 dark:ring-mist-700/60",
        className,
      )}
      title={label}
    >
      {logo ? (
        <img alt="" className="h-4 w-auto opacity-70 dark:invert" src={logo} />
      ) : (
        <MonitorSmartphone className="h-4 w-4" />
      )}
    </span>
  );
}
