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

/**
 * A soft halo around the dot: green for a live machine, red for one that has to
 * re-authenticate. The offline dot only gets a hairline so a tailnet full of
 * sleeping machines stays quiet.
 */
const STATE_HALOS = {
  online: "ring-4 ring-green-500/15 dark:ring-green-400/20",
  offline: "ring-1 ring-mist-300 dark:ring-mist-600",
  expired: "ring-4 ring-red-500/15 dark:ring-red-400/20",
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
 * glowing dot for a glance plus a toned chip, so the state never relies on
 * colour alone.
 *
 * The chip sits in a fixed-width track, which is what makes the status column
 * scan as one vertical line of labels instead of a ragged left edge.
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
    <span className={cn("inline-flex min-w-0 items-center gap-x-2 whitespace-nowrap", className)}>
      <span
        aria-hidden="true"
        className={cn("h-2 w-2 shrink-0 rounded-full", STATE_DOTS[state], STATE_HALOS[state])}
      />
      <span className="inline-flex min-w-[4.75rem] justify-center">
        <SettingsStatus tone={STATE_TONES[state]}>{t(STATE_LABEL_KEYS[state])}</SettingsStatus>
      </span>
    </span>
  );
}
