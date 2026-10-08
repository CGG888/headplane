import { Check } from "lucide-react";
import { data, redirect } from "react-router";

import androidSvg from "~/assets/android.svg";
import iosSvg from "~/assets/ios.svg";
import linuxSvg from "~/assets/linux.svg";
import macosSvg from "~/assets/macos.svg";
import windowsSvg from "~/assets/windows.svg";
import Card from "~/components/card";
import CodeBlock from "~/components/code-block";
import Link from "~/components/link";
import { useI18n } from "~/i18n/provider";
import LinkAccount from "~/layout/link-account";
import {
  authContext,
  headscaleConfigContext,
  headscaleLiveStoreContext,
  requestApiContext,
} from "~/server/context";
import { usersResource } from "~/server/headscale/live-store";
import { isUserPrincipal } from "~/server/web/auth";
import { Capabilities } from "~/server/web/roles";
import cn from "~/utils/cn";
import { getUserDisplayName } from "~/utils/user";

import type { Route } from "./+types/home";

export async function loader({ request, context }: Route.LoaderArgs) {
  const auth = context.get(authContext);
  const getRequestApi = context.get(requestApiContext);
  const headscaleConfig = context.get(headscaleConfigContext);
  const headscaleLiveStore = context.get(headscaleLiveStoreContext);

  const principal = await auth.require(request);

  // If the signed-in Headplane user has no linked Headscale user,
  // check for unclaimed users they can pick from before anything else.
  let unlinked = false;
  if (isUserPrincipal(principal) && !principal.user.headscaleUserId) {
    const { api } = await getRequestApi(request);

    let headscaleUsers: { id: string; name: string }[] = [];
    try {
      const [usersSnap, claimed] = await Promise.all([
        headscaleLiveStore.get(usersResource, api),
        auth.claimedHeadscaleUserIds(),
      ]);

      const apiUsers = usersSnap.data;
      headscaleUsers = apiUsers
        .filter((u) => !claimed.has(u.id))
        .map((u) => ({ id: u.id, name: getUserDisplayName(u) }));
    } catch {
      // API unavailable, skip the link picker
    }

    if (headscaleUsers.length > 0) {
      return { headscaleUsers, status: "needs_link" as const };
    }

    // No unclaimed users, fall through to no-access page.
    // Only warn if Headscale isn't using OIDC — if it is, the user
    // Just needs to connect a device and Headscale will auto-create
    // Their account, at which point auto-link will pick it up.
    if (!headscaleConfig.hasOIDCConfig()) {
      unlinked = true;
    }
  }

  if (auth.can(principal, Capabilities.ui_access)) {
    // The overview is the one UI page `ui_access` alone opens; the machine list
    // needs `read_machines`, so it is a safe landing page for every principal.
    return redirect("/overview");
  }

  // No UI access — show the download/connect page
  const { api } = await getRequestApi(request);

  let linkedUserName: string | undefined;
  if (isUserPrincipal(principal) && principal.user.headscaleUserId) {
    try {
      const usersSnap = await headscaleLiveStore.get(usersResource, api);
      const hsUser = usersSnap.data.find((u) => u.id === principal.user.headscaleUserId);
      linkedUserName = hsUser?.name;
    } catch {
      // API unavailable, skip linked user resolution
    }
  }

  return { linkedUserName, status: "no_access" as const, unlinked };
}

export async function action({ request, context }: Route.ActionArgs) {
  const auth = context.get(authContext);
  const getRequestApi = context.get(requestApiContext);
  const headscaleLiveStore = context.get(headscaleLiveStoreContext);

  const principal = await auth.require(request);
  if (!isUserPrincipal(principal)) {
    return redirect("/");
  }

  const formData = await request.formData();
  const headscaleUserId = formData.get("headscale_user_id")?.toString().trim();

  if (headscaleUserId) {
    // Linking grants ownership of every node that belongs to the Headscale user
    // (`canManageNode`), so the picker is not a free-form id: the id has to be a
    // real Headscale user, it must still be unclaimed, and when both sides carry
    // an email address they have to match. Otherwise any signed-in account could
    // bind somebody else's Headscale user id and then rename, expire or delete
    // that person's machines.
    const { api } = await getRequestApi(request);
    const [usersSnap, claimed] = await Promise.all([
      headscaleLiveStore.get(usersResource, api),
      auth.claimedHeadscaleUserIds(),
    ]);

    const target = usersSnap.data.find((user) => user.id === headscaleUserId);
    if (!target || claimed.has(headscaleUserId)) {
      throw data({ localized: { key: "home.link.invalidSelection" } }, { status: 400 });
    }

    const targetEmail = target.email?.trim().toLowerCase();
    const principalEmail = principal.profile.email?.trim().toLowerCase();
    if (targetEmail && principalEmail && targetEmail !== principalEmail) {
      throw data({ localized: { key: "home.link.emailMismatch" } }, { status: 403 });
    }

    if (!(await auth.linkHeadscaleUser(principal.user.id, headscaleUserId))) {
      throw data({ localized: { key: "home.link.invalidSelection" } }, { status: 409 });
    }
  }

  return redirect("/");
}

const downloads = [
  {
    href: "https://pkgs.tailscale.com/stable/tailscale-setup-latest.exe",
    icon: windowsSvg,
    name: "Windows",
    note: "Windows 10+",
  },
  {
    href: "https://pkgs.tailscale.com/stable/Tailscale-latest-macos.pkg",
    icon: macosSvg,
    name: "macOS",
    note: "macOS Big Sur+",
  },
  {
    href: "https://apps.apple.com/us/app/tailscale/id1470499037",
    icon: iosSvg,
    name: "iOS",
    note: "iOS 15+",
  },
  {
    href: "https://play.google.com/store/apps/details?id=com.tailscale.ipn",
    icon: androidSvg,
    name: "Android",
    note: "Android 8+",
  },
];

export default function Home({ loaderData }: Route.ComponentProps) {
  const { t, tr } = useI18n();

  if (loaderData.status === "needs_link") {
    return <LinkAccount headscaleUsers={loaderData.headscaleUsers} />;
  }

  return (
    <div className="mx-auto mt-6 mb-24 flex max-w-2xl flex-col gap-4">
      {loaderData.linkedUserName && (
        <Card variant="flat" className="flex max-w-2xl items-center gap-4">
          <Check className="inline-flex size-4" />
          <Card.Text className="text-sm">
            {tr("home.linkedTo", {
              name: <strong>{loaderData.linkedUserName}</strong>,
            })}
          </Card.Text>
        </Card>
      )}
      <Card variant="flat" className="max-w-2xl">
        <Card.Title>{t("home.title")}</Card.Title>
        <Card.Text className="mt-1">{t("home.body")}</Card.Text>

        <div className="mt-4 rounded-lg border border-mist-200 p-3 dark:border-mist-700">
          <div className="flex items-center gap-2">
            <img alt="Linux" className="w-4 dark:invert" src={linuxSvg} />
            <span className="text-sm font-medium">Linux</span>
          </div>
          <CodeBlock className="mt-2">curl -fsSL https://tailscale.com/install.sh | sh</CodeBlock>
          <p className="mt-1 text-xs text-mist-500 dark:text-mist-400">
            <Link
              external
              styled
              to="https://github.com/tailscale/tailscale/blob/main/scripts/installer.sh"
            >
              {t("home.viewScript")}
            </Link>
          </p>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {downloads.map((dl) => (
            <a
              key={dl.name}
              className={cn(
                "flex flex-col items-center gap-2 rounded-lg p-3",
                "border border-mist-200 dark:border-mist-700",
                "hover:bg-mist-100 dark:hover:bg-mist-800",
                "focus:outline-hidden focus:ring-2 focus:ring-indigo-500/40 focus:ring-offset-1",
                "dark:focus:ring-indigo-400/40 dark:focus:ring-offset-mist-900",
                "transition-colors",
              )}
              href={dl.href}
              rel="noreferrer"
              target="_blank"
            >
              <img alt={dl.name} className="h-6 dark:invert" src={dl.icon} />
              <span className="text-sm font-medium">{dl.name}</span>
              <span className="text-xs text-mist-500 dark:text-mist-400">{dl.note}</span>
            </a>
          ))}
        </div>
        <Card.Text
          className={cn(
            "mt-8 text-center text-xs",
            loaderData.unlinked
              ? "text-yellow-600 dark:text-yellow-400"
              : "text-mist-600 dark:text-mist-300",
          )}
        >
          {loaderData.unlinked ? t("home.unlinked") : t("home.noAccess")}
        </Card.Text>
      </Card>
    </div>
  );
}
