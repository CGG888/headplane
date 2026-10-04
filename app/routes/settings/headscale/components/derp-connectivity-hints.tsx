import Text from "~/components/text";
import { useI18n } from "~/i18n/provider";

/**
 * The reachability facts an operator needs before enabling the embedded DERP
 * server. Rendered in the embedded-server section and inside the preset dialog
 * so both places state the same requirements.
 */
export default function DerpConnectivityHints() {
  const { t } = useI18n();

  return (
    <div className="rounded-lg border border-mist-200 p-3 dark:border-mist-800">
      <Text className="font-semibold">{t("settings.headscale.derp.connectivityTitle")}</Text>
      <ul className="mt-1 list-disc pl-5 text-sm opacity-80">
        <li>{t("settings.headscale.derp.connectivityHttps")}</li>
        <li>{t("settings.headscale.derp.connectivityStun")}</li>
        <li>{t("settings.headscale.derp.connectivityCaptivePortal")}</li>
      </ul>
      <Text className="mt-2 text-sm opacity-70">
        {t("settings.headscale.derp.connectivityNote")}
      </Text>
    </div>
  );
}
