import { SettingsStatus, type SettingsStatusTone } from "~/components/settings-nav";
import type { TranslationKey } from "~/i18n";
import { useI18n } from "~/i18n/provider";
import cn from "~/utils/cn";
import type { PopulatedNode } from "~/utils/node-info";

type MachineState = "online" | "offline" | "expired";

const STATE_LABEL_KEYS = {
  online: "machines.filters.online",
  offline: "machines.filters.offline",
  expired: "machines.filters.expired",
} as const satisfies Record<MachineState, TranslationKey>;

const STATE_TONES = {
  online: "ok",
  offline: "neutral",
  expired: "error",
} as const satisfies Record<MachineState, SettingsStatusTone>;

const STATE_DOTS = {
  online: "bg-green-500",
  offline: "bg-mist-300 dark:bg-mist-600",
  expired: "bg-red-500",
} as const satisfies Record<MachineState, string>;

/** Expired wins over offline: the machine cannot connect until it re-auths. */
export function machineState(node: PopulatedNode): MachineState {
  if (node.expired) {
    return "expired";
  }

  return node.online ? "online" : "offline";
}

/**
 * The single online/offline marker shared by the list and the detail page: a
 * coloured dot for a glance plus a toned chip, so the state never relies on
 * colour alone.
 */
export default function MachineStatus({
  node,
  className,
}: {
  node: PopulatedNode;
  className?: string;
}) {
  const { t } = useI18n();
  const state = machineState(node);

  return (
    <span className={cn("inline-flex items-center gap-x-1.5", className)}>
      <span aria-hidden="true" className={cn("h-2 w-2 shrink-0 rounded-full", STATE_DOTS[state])} />
      <SettingsStatus tone={STATE_TONES[state]}>{t(STATE_LABEL_KEYS[state])}</SettingsStatus>
    </span>
  );
}
