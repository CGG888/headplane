import { data } from "react-router";

import { SettingsSectionList } from "~/components/drawer";
import Link from "~/components/link";
import Notice from "~/components/notice";
import { useI18n } from "~/i18n/provider";
import { authContext, headscaleConfigContext } from "~/server/context";
import { Capabilities } from "~/server/web/roles";

import type { Route } from "./+types/overview";
import { restrictionAction } from "./actions";
import AddDomain from "./dialogs/add-domain";
import AddGroup from "./dialogs/add-group";
import AddUser from "./dialogs/add-user";
import RestrictionSection from "./table";

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
        <SettingsSectionList>
          <RestrictionSection isDisabled={isDisabled} type="domain" values={settings.domains}>
            <AddDomain
              domains={settings.domains}
              isDisabled={isDisabled}
              key={settings.domains.join("\n")}
            />
          </RestrictionSection>
          <RestrictionSection isDisabled={isDisabled} type="group" values={settings.groups}>
            <AddGroup
              groups={settings.groups}
              isDisabled={isDisabled}
              key={settings.groups.join("\n")}
            />
          </RestrictionSection>
          <RestrictionSection isDisabled={isDisabled} type="user" values={settings.users}>
            <AddUser
              isDisabled={isDisabled}
              key={settings.users.join("\n")}
              users={settings.users}
            />
          </RestrictionSection>
        </SettingsSectionList>
      </div>
    </div>
  );
}
