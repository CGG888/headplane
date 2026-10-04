import { Building2, House } from "lucide-react";

import Link from "~/components/link";
import { useI18n } from "~/i18n/provider";
import cn from "~/utils/cn";

import CreateUser from "../dialogs/create-user";

interface ManageBannerProps {
  oidc?: { issuer: string };
  isDisabled?: boolean;
}

export default function ManageBanner({ oidc, isDisabled }: ManageBannerProps) {
  const { t, tr } = useI18n();

  return (
    <div
      className={cn(
        "mb-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between",
        "rounded-lg border border-mist-200 p-4 dark:border-mist-800",
      )}
    >
      <div className="flex items-center gap-3">
        {oidc ? <Building2 className="h-5 w-5 shrink-0" /> : <House className="h-5 w-5 shrink-0" />}
        <p className="text-sm text-mist-600 dark:text-mist-300">
          {oidc
            ? tr("users.banner.oidc", {
                link: (
                  <Link external styled to={oidc.issuer}>
                    {t("users.banner.oidcLink")}
                  </Link>
                ),
              })
            : tr("users.banner.local", {
                link: (
                  <Link styled to="https://headscale.net/stable/ref/oidc">
                    {t("users.banner.setupOidc")}
                  </Link>
                ),
              })}
        </p>
      </div>
      <CreateUser isDisabled={isDisabled} isOidc={oidc !== undefined} />
    </div>
  );
}
