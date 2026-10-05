import type { ReactNode } from "react";

import { useI18n } from "~/i18n/provider";
import type { ServerOverviewView } from "~/server/headscale/config-loader";
import cn from "~/utils/cn";

interface ServerOverviewProps {
  overview: ServerOverviewView;
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-mist-200 p-3 dark:border-mist-800">
      <h3 className="mb-1 text-xs font-medium tracking-wide text-mist-500 uppercase dark:text-mist-400">
        {title}
      </h3>
      <div className="flex flex-col divide-y divide-mist-100 dark:divide-mist-800/60">
        {children}
      </div>
    </section>
  );
}

/** One label/value line; long paths are truncated to the row, not wrapped. */
function Row({ label, value }: { label: string; value: string }) {
  const { t } = useI18n();
  const isUnset = value.length === 0;

  return (
    <div className="flex items-baseline justify-between gap-4 py-1">
      <span className="shrink-0 text-sm text-mist-600 dark:text-mist-400">{label}</span>
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-right font-mono text-sm",
          isUnset && "text-mist-400 dark:text-mist-500",
        )}
        title={isUnset ? undefined : value}
      >
        {isUnset ? t("settings.headscale.overviewUnset") : value}
      </span>
    </div>
  );
}

/**
 * The read-only half of the Headscale settings page: the values Headplane
 * deliberately never writes, because getting the database path or an IP range
 * wrong can lock an operator out, or because they are operational or secret
 * file paths that belong in the file on the host.
 */
export default function ServerOverview({ overview }: ServerOverviewProps) {
  const { t } = useI18n();
  const on = t("settings.headscale.statusEnabled");
  const off = t("settings.headscale.statusDisabled");

  return (
    <div className="flex flex-col gap-3">
      <Section title={t("settings.headscale.overviewNetworkTitle")}>
        <Row label={t("settings.headscale.overviewServerUrlLabel")} value={overview.serverUrl} />
        <Row label={t("settings.headscale.overviewListenAddrLabel")} value={overview.listenAddr} />
        <Row label={t("settings.headscale.overviewPrefixV4Label")} value={overview.prefixesV4} />
        <Row label={t("settings.headscale.overviewPrefixV6Label")} value={overview.prefixesV6} />
        <Row
          label={t("settings.headscale.overviewPrefixAllocationLabel")}
          value={overview.prefixAllocation}
        />
      </Section>

      <Section title={t("settings.headscale.overviewDatabaseTitle")}>
        <Row
          label={t("settings.headscale.overviewDatabaseTypeLabel")}
          value={overview.databaseType}
        />
        <Row label={t("settings.headscale.overviewSqlitePathLabel")} value={overview.sqlitePath} />
        <Row
          label={t("settings.headscale.overviewSqliteWalLabel")}
          value={overview.sqliteWriteAheadLog ? on : off}
        />
      </Section>

      <Section title={t("settings.headscale.overviewServicesTitle")}>
        <Row
          label={t("settings.headscale.overviewMetricsAddrLabel")}
          value={overview.metricsListenAddr}
        />
        <Row
          label={t("settings.headscale.overviewGrpcAddrLabel")}
          value={overview.grpcListenAddr}
        />
        <Row
          label={t("settings.headscale.overviewGrpcInsecureLabel")}
          value={overview.grpcAllowInsecure ? on : off}
        />
        <Row label={t("settings.headscale.overviewUnixSocketLabel")} value={overview.unixSocket} />
        <Row
          label={t("settings.headscale.overviewUnixSocketPermissionLabel")}
          value={overview.unixSocketPermission}
        />
        <Row
          label={t("settings.headscale.overviewNoiseKeyLabel")}
          value={overview.noisePrivateKeyPath}
        />
      </Section>

      <Section title={t("settings.headscale.overviewTlsTitle")}>
        <Row
          label={t("settings.headscale.overviewTlsHostnameLabel")}
          value={overview.tlsLetsencryptHostname}
        />
        <Row label={t("settings.headscale.overviewAcmeEmailLabel")} value={overview.acmeEmail} />
        <Row
          label={t("settings.headscale.overviewTlsCertPathLabel")}
          value={overview.tlsCertPath}
        />
        <Row label={t("settings.headscale.overviewTlsKeyPathLabel")} value={overview.tlsKeyPath} />
      </Section>

      <Section title={t("settings.headscale.overviewTuningTitle")}>
        <Row
          label={t("settings.headscale.overviewTuningLabel")}
          value={
            overview.tuningConfigured
              ? t("settings.headscale.statusConfigured")
              : t("settings.headscale.summaryNotConfigured")
          }
        />
      </Section>
    </div>
  );
}
