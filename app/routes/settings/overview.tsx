import {
  Activity,
  ArrowRight,
  BellRing,
  Bot,
  Camera,
  FileKey2,
  KeyRound,
  ScrollText,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import Link from "~/components/link";
import PageError from "~/components/page-error";
import { SettingsPage } from "~/components/settings-nav";
import { useI18n } from "~/i18n/provider";
import { headscaleConfigContext, oidcContext } from "~/server/context";
import cn from "~/utils/cn";

import type { Route } from "./+types/overview";

export async function loader({ context }: Route.LoaderArgs) {
  const headscaleConfig = context.get(headscaleConfigContext);
  const oidc = context.get(oidcContext);

  return {
    config: headscaleConfig.writable(),
    isOidcEnabled: oidc.state === "enabled" && oidc.value.status().state === "ready",
  };
}

/** Groups related cards under one small heading so the page reads in two halves. */
function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-mist-500 dark:text-mist-400">{title}</h2>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{children}</div>
    </section>
  );
}

interface SettingsCardProps {
  /** The existing call to action, reused as the card's "this opens something" hint. */
  action: string;
  description: ReactNode;
  icon: LucideIcon;
  title: string;
  to: string;
}

/**
 * A whole-card link. The card is the hit target, so it never needs a button of
 * its own; the trailing chevron and indigo action line only hint at that.
 */
function SettingsCard({ action, description, icon: Icon, title, to }: SettingsCardProps) {
  return (
    <Link
      className={cn(
        "group flex h-full flex-col gap-3 rounded-xl border p-4",
        "border-mist-200 bg-white shadow-surface",
        "transition hover:border-indigo-300 hover:bg-mist-50 hover:shadow-overlay",
        "dark:border-mist-800 dark:bg-mist-950/40",
        "dark:hover:border-indigo-500/50 dark:hover:bg-mist-950/70",
        "focus:outline-hidden focus:ring-2 focus:ring-indigo-500/40 focus:ring-offset-1",
        "dark:focus:ring-indigo-400/40 dark:focus:ring-offset-mist-900",
      )}
      to={to}
    >
      <span className="flex items-center gap-3">
        <span
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-lg",
            "bg-mist-100 text-mist-600",
            "transition-colors group-hover:bg-indigo-100 group-hover:text-indigo-600",
            "dark:bg-mist-800 dark:text-mist-300",
            "dark:group-hover:bg-indigo-500/20 dark:group-hover:text-indigo-300",
          )}
        >
          <Icon className="h-5 w-5" />
        </span>
        <span className="font-medium text-mist-900 dark:text-mist-50">{title}</span>
      </span>

      <span className="line-clamp-2 text-sm text-mist-600 dark:text-mist-400">{description}</span>

      <span className="mt-auto flex items-center gap-1 text-sm font-medium text-indigo-600 dark:text-indigo-400">
        <span className="truncate">{action}</span>
        <ArrowRight className="h-4 w-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
      </span>
    </Link>
  );
}

export default function Page({ loaderData: { config, isOidcEnabled } }: Route.ComponentProps) {
  const { t, tr } = useI18n();

  return (
    <SettingsPage
      // The hub is a grid of cards, not a form: it takes the page width every
      // other page has. `SettingsPage` caps itself at `md:max-w-4xl` for the
      // settings forms, so that one class is overridden here (and on the
      // Overview) to the shell's own `container` width — the same right edge
      // the header's controls and the machines list share.
      className="md:max-w-none"
      description={t("settings.overview.intro")}
      title={t("settings.overview.title")}
    >
      <div className="flex flex-col gap-6">
        <SettingsSection title={t("settings.overview.headscaleSection")}>
          <SettingsCard
            action={t("settings.overview.manageAuthKeys")}
            description={tr("settings.overview.preAuthBody", {
              link: t("settings.overview.tailscaleDocs"),
            })}
            icon={FileKey2}
            title={t("settings.overview.preAuthTitle")}
            to="/settings/auth-keys"
          />
          <SettingsCard
            action={t("settings.overview.manageApiKeys")}
            description={t("settings.overview.apiKeysBody")}
            icon={KeyRound}
            title={t("settings.overview.apiKeysTitle")}
            to="/settings/api-keys"
          />
          {config ? (
            <SettingsCard
              action={t("settings.overview.manageHeadscale")}
              description={t("settings.overview.headscaleBody")}
              icon={SlidersHorizontal}
              title={t("settings.overview.headscaleTitle")}
              to="/settings/headscale"
            />
          ) : undefined}
          {config && isOidcEnabled ? (
            <SettingsCard
              action={t("settings.overview.manageRestrictions")}
              description={tr("settings.overview.restrictionsBody", {
                link: t("common.learnMore"),
              })}
              icon={ShieldCheck}
              title={t("settings.overview.restrictionsTitle")}
              to="/settings/restrictions"
            />
          ) : undefined}
          <SettingsCard
            action={t("settings.overview.systemStatus")}
            description={t("settings.overview.systemBody")}
            icon={Activity}
            title={t("settings.overview.systemTitle")}
            to="/settings/system"
          />
        </SettingsSection>

        <SettingsSection title={t("settings.overview.headplaneSection")}>
          <SettingsCard
            action={t("settings.overview.agentSettings")}
            description={t("settings.overview.agentBody")}
            icon={Bot}
            title={t("settings.overview.agentTitle")}
            to="/settings/agent"
          />
          {config ? (
            <>
              <SettingsCard
                action={t("settings.overview.manageAudit")}
                description={t("settings.overview.auditBody")}
                icon={ScrollText}
                title={t("settings.overview.auditTitle")}
                to="/settings/audit"
              />
              <SettingsCard
                action={t("settings.overview.manageSnapshots")}
                description={t("settings.overview.snapshotsBody")}
                icon={Camera}
                title={t("settings.overview.snapshotsTitle")}
                to="/settings/snapshots"
              />
            </>
          ) : undefined}
          <SettingsCard
            action={t("settings.overview.notificationsSettings")}
            description={t("settings.overview.notificationsBody")}
            icon={BellRing}
            title={t("settings.overview.notificationsTitle")}
            to="/settings/notifications"
          />
        </SettingsSection>
      </div>
    </SettingsPage>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <PageError error={error} page="Settings" />;
}
