import Code from "~/components/code";
import Text from "~/components/text";
import { useI18n } from "~/i18n/provider";

import { deriveDerpPublicEndpoint, formatDerpPublicEndpoint } from "../derp-settings";

/**
 * The public endpoint clients use for the embedded DERP server, plus the
 * requirements a reverse proxy in front of Headscale has to meet. DERP shares
 * Headscale's HTTPS endpoint, so the port comes from `server_url`, never from
 * Headscale's listen address.
 */
export default function DerpPublicEndpoint({ serverUrl }: { serverUrl: string }) {
  const { t, tr } = useI18n();

  const endpoint = deriveDerpPublicEndpoint(serverUrl);
  const address = endpoint ? formatDerpPublicEndpoint(endpoint) : undefined;

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-mist-200 p-3 sm:flex-row sm:gap-6 dark:border-mist-800">
      <div className="sm:w-1/2">
        <Text className="font-semibold">{t("settings.headscale.derp.publicPortTitle")}</Text>
        {address ? (
          <p className="mt-1 text-sm">
            {tr("settings.headscale.derp.publicPortValue", { endpoint: <Code>{address}</Code> })}
          </p>
        ) : (
          <p className="mt-1 text-sm opacity-70">
            {t("settings.headscale.derp.publicPortUnknown")}
          </p>
        )}
        <Text className="mt-1 text-sm opacity-70">
          {t("settings.headscale.derp.publicPortNote")}
        </Text>
      </div>

      <div className="sm:w-1/2">
        <Text className="font-semibold">{t("settings.headscale.derp.proxyTitle")}</Text>
        <ul className="mt-1 list-disc pl-5 text-sm opacity-80">
          <li>{t("settings.headscale.derp.proxyDerpPath")}</li>
          <li>{t("settings.headscale.derp.proxyUpgrade")}</li>
          <li>{t("settings.headscale.derp.proxyTls")}</li>
          <li>{t("settings.headscale.derp.proxyStun")}</li>
        </ul>
      </div>
    </div>
  );
}
