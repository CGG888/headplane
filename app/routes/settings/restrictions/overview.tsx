import { data } from "react-router";

import Link from "~/components/link";
import Notice from "~/components/notice";
import {
  SettingsCollapsible,
  SettingsPanel,
  SettingsTab,
  SettingsTabList,
  SettingsTabs,
} from "~/components/settings-nav";
import Text from "~/components/text";
import { useI18n } from "~/i18n/provider";
import { authContext, headscaleConfigContext } from "~/server/context";
import { Capabilities } from "~/server/web/roles";

import type { Route } from "./+types/overview";
import { restrictionAction } from "./actions";
import AddDomain from "./dialogs/add-domain";
import AddGroup from "./dialogs/add-group";
import AddUser from "./dialogs/add-user";
import RestrictionList, {
  RESTRICTION_ADD_BODY_KEYS,
  RESTRICTION_ADD_TITLE_KEYS,
  RESTRICTION_BODY_KEYS,
  RESTRICTION_ICONS,
  RESTRICTION_TITLE_KEYS,
  RESTRICTION_TYPES,
} from "./table";

export async function loader({ request, context }: Route.LoaderArgs) {
  const auth = context.get(authContext);
  const headscaleConfig = context.get(headscaleConfigContext);

  const principal = await auth.require(request);
  const check = auth.can(principal, Capabilities.read_users);
  if (!check) {
    throw data(
      { localized: { key: "errors.permission.viewIam" } },
      {
        status: 403,
      },
    );
  }

  const oidc = headscaleConfig.getOIDCConfig();
  if (!oidc) {
    throw data("OIDC is not configured on this Headscale instance.", {
      status: 501,
    });
  }

  return {
    access: auth.can(principal, Capabilities.configure_iam),
    settings: {
      domains: [...new Set(oidc.allowedDomains)],
      groups: [...new Set(oidc.allowedGroups)],
      users: [...new Set(oidc.allowedUsers)],
    },
    writable: headscaleConfig.writable(),
  };
}

export const action = restrictionAction;

export default function Page({ loaderData: { access, writable, settings } }: Route.ComponentProps) {
  const { t, tr } = useI18n();
  const isDisabled = writable ? !access : true;
  const valuesByType = {
    domain: settings.domains,
    group: settings.groups,
    user: settings.users,
  };

  return (
    <div className="flex max-w-(--breakpoint-lg) flex-col gap-4">
      <div className="flex w-full flex-col sm:w-2/3">
        <p className="text-md mb-4">
          <Link className="font-medium" to="/settings">
            {t("settings.overview.title")}
          </Link>
          <span className="mx-2">/</span> {t("settings.restrictions.breadcrumb")}
        </p>
        {!access ? (
          <Notice title={t("settings.restrictions.restrictedTitle")} variant="warning">
            {t("settings.restrictions.restrictedBody")}
          </Notice>
        ) : !writable ? (
          <Notice title={t("settings.restrictions.lockedTitle")} variant="error">
            {t("settings.restrictions.lockedBody")}
          </Notice>
        ) : undefined}
        <h1 className="mt-4 mb-2 text-2xl font-medium">{t("settings.restrictions.title")}</h1>
        <p>
          {tr("settings.overview.restrictionsBody", {
            link: (
              <Link external styled to="https://headscale.net/stable/ref/oidc/#basic-configuration">
                {t("common.learnMore")}
              </Link>
            ),
          })}
        </p>
      </div>
      <div className="w-full sm:w-2/3">
        <SettingsTabs defaultValue="domain" label={t("settings.restrictions.title")}>
          <SettingsTabList>
            {RESTRICTION_TYPES.map((type) => {
              const Icon = RESTRICTION_ICONS[type];
              return (
                <SettingsTab icon={Icon} key={type} value={type}>
                  {t(RESTRICTION_TITLE_KEYS[type])}
                </SettingsTab>
              );
            })}
          </SettingsTabList>

          {RESTRICTION_TYPES.map((type) => {
            const values = valuesByType[type];
            return (
              <SettingsPanel key={type} value={type}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <Text className="opacity-70">{t(RESTRICTION_BODY_KEYS[type])}</Text>
                  {values.length > 0 ? (
                    <span className="text-sm opacity-60">
                      {t("settings.restrictions.summaryCount", { count: values.length })}
                    </span>
                  ) : undefined}
                </div>

                <RestrictionList isDisabled={isDisabled} type={type} values={values} />

                <SettingsCollapsible
                  defaultOpen={values.length === 0}
                  description={t(RESTRICTION_ADD_BODY_KEYS[type])}
                  title={t(RESTRICTION_ADD_TITLE_KEYS[type])}
                >
                  {type === "domain" ? (
                    <AddDomain domains={values} isDisabled={isDisabled} key={values.join("\n")} />
                  ) : type === "group" ? (
                    <AddGroup groups={values} isDisabled={isDisabled} key={values.join("\n")} />
                  ) : (
                    <AddUser isDisabled={isDisabled} key={values.join("\n")} users={values} />
                  )}
                </SettingsCollapsible>
              </SettingsPanel>
            );
          })}
        </SettingsTabs>
      </div>
    </div>
  );
}
