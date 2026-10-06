import {
  Check,
  CircleQuestionMark,
  CircleUser,
  Gauge,
  Globe,
  Lock,
  Monitor,
  Moon,
  RefreshCw,
  Server,
  Settings,
  Sun,
  Users,
} from "lucide-react";
import { NavLink, unstable_useRoute as useRoute, useLocation, useSubmit } from "react-router";

import { LanguageMenuItems } from "~/components/language-switcher";
import Link from "~/components/link";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "~/components/menu";
import type { TranslationKey } from "~/i18n";
import { useI18n } from "~/i18n/provider";
import logoBg from "~/logo/dark-bg.svg";
import logoDark from "~/logo/dark.svg";
import logoLight from "~/logo/light.svg";
import cn from "~/utils/cn";
import type { ColorScheme } from "~/utils/color-scheme";
import { useLiveData } from "~/utils/live-data";

export interface HeaderProps {
  user: {
    subject: string;
    name: string;
    email?: string;
    username?: string;
    picture?: string;
  };
  access: {
    ui: boolean;
    machines: boolean;
    dns: boolean;
    users: boolean;
    policy: boolean;
    settings: boolean;
  };
  configAvailable: boolean;
}

const tabs = [
  { to: "/overview", icon: Gauge, labelKey: "header.tabs.overview", key: "ui" },
  { to: "/machines", icon: Server, labelKey: "header.tabs.machines", key: "machines" },
  { to: "/users", icon: Users, labelKey: "header.tabs.users", key: "users" },
  { to: "/acls", icon: Lock, labelKey: "header.tabs.policy", key: "policy" },
  { to: "/dns", icon: Globe, labelKey: "header.tabs.dns", key: "dns" },
  { to: "/settings", icon: Settings, labelKey: "header.tabs.settings", key: "settings" },
] as const satisfies ReadonlyArray<{
  to: string;
  icon: typeof Server;
  labelKey: TranslationKey;
  key: keyof HeaderProps["access"];
}>;

const colorSchemes = [
  { value: "system", labelKey: "header.colorScheme.system", icon: Monitor },
  { value: "light", labelKey: "header.colorScheme.light", icon: Sun },
  { value: "dark", labelKey: "header.colorScheme.dark", icon: Moon },
] as const satisfies ReadonlyArray<{
  value: ColorScheme;
  labelKey: TranslationKey;
  icon: typeof Monitor;
}>;

export default function Header({ user, access, configAvailable }: HeaderProps) {
  const submit = useSubmit();
  const { t } = useI18n();
  const { liveUpdates, setLiveUpdates } = useLiveData();
  const showTabs = access.ui;
  const rootRoute = useRoute("root");
  const currentColorScheme: ColorScheme = rootRoute?.loaderData?.colorScheme ?? "system";
  // useLocation returns the path with the basename already stripped, which is
  // what `redirect()` expects — react-router re-applies the basename when
  // following the redirect on the client.
  const location = useLocation();
  const returnTo = location.pathname + location.search;

  return (
    <header
      className={cn(
        "bg-mist-200 dark:bg-mist-950 text-mist-800 dark:text-mist-200",
        "dark:border-b dark:border-mist-800 shadow-inner",
      )}
    >
      <div className="container flex items-center gap-x-4 py-4">
        <div className="flex min-w-0 items-center gap-x-4">
          <div className="flex items-center gap-x-2">
            <picture className="min-w-8">
              <source srcSet={logoLight} media="(prefers-color-scheme: dark)" />
              <source srcSet={logoDark} media="(prefers-color-scheme: light)" />
              <img src={logoBg} alt={t("header.logoAlt")} />
            </picture>
            <h1 className="text-2xl font-semibold">{t("header.brand")}</h1>
          </div>
          {showTabs && (
            <nav className="hidden items-center gap-x-2 overflow-x-auto p-1 text-sm font-medium md:flex">
              {tabs.map((tab) => {
                if (!access[tab.key]) return null;
                if ((tab.key === "dns" || tab.key === "settings") && !configAvailable) return null;

                return (
                  <NavLink
                    key={tab.to}
                    className={({ isActive }) =>
                      cn(
                        "px-3 py-1.5 flex items-center gap-x-1.5 rounded-md text-nowrap",
                        "hover:bg-mist-300/50 dark:hover:bg-mist-800",
                        "focus:outline-hidden focus:ring-2 focus:ring-indigo-500/40 focus:ring-offset-1",
                        "dark:focus:ring-indigo-400/40 dark:focus:ring-offset-mist-900",
                        isActive
                          ? "bg-mist-300/70 dark:bg-mist-800 text-mist-900 dark:text-mist-50"
                          : "text-mist-600 dark:text-mist-300",
                      )
                    }
                    prefetch="intent"
                    to={tab.to}
                  >
                    <tab.icon className="w-4" />
                    {t(tab.labelKey)}
                  </NavLink>
                );
              })}
            </nav>
          )}
        </div>
        <div className="ml-auto grid shrink-0 grid-cols-2 gap-x-4">
          <Menu>
            <MenuTrigger className="size-8 rounded-full p-1">
              <CircleQuestionMark className="w-5" />
              <span className="sr-only">{t("header.help.label")}</span>
            </MenuTrigger>
            <MenuContent align="end">
              <MenuItem>
                <Link external to="https://cgg888.github.io/headplaneCN/">
                  {t("header.help.docs")}
                </Link>
              </MenuItem>
              <MenuItem>
                <Link external to="https://headscale.net">
                  {t("header.help.headscale")}
                </Link>
              </MenuItem>
              <MenuItem>
                <Link external to="https://tailscale.com/download">
                  {t("header.help.download")}
                </Link>
              </MenuItem>
            </MenuContent>
          </Menu>
          <Menu>
            <MenuTrigger className="size-8 overflow-hidden rounded-full">
              {user.picture ? (
                <img alt={user.name} className="size-8" src={user.picture} />
              ) : (
                <CircleUser className="size-8" />
              )}
            </MenuTrigger>
            <MenuContent align="end">
              <MenuItem disabled>
                <div className="text-mist-900 dark:text-mist-50">
                  {user.subject === "api_key" ? (
                    <>
                      <p className="font-bold">{t("header.apiKey")}</p>
                      <p>{user.name}</p>
                    </>
                  ) : (
                    <>
                      <p className="font-bold">{user.name}</p>
                      {user.email && <p>{user.email}</p>}
                    </>
                  )}
                </div>
              </MenuItem>
              <MenuSeparator />
              {colorSchemes.map(({ value, labelKey, icon: Icon }) => (
                <MenuItem
                  key={value}
                  onClick={() =>
                    submit(
                      { colorScheme: value, returnTo },
                      // GET keeps the value in the query string so the switch
                      // survives proxies that drop POST bodies.
                      { action: "/api/color-scheme", method: "GET" },
                    )
                  }
                >
                  <div className="flex items-center gap-x-2">
                    <Icon className="size-4" />
                    <span className="flex-1">{t(labelKey)}</span>
                    {currentColorScheme === value && <Check className="size-4" />}
                  </div>
                </MenuItem>
              ))}
              <MenuSeparator />
              <LanguageMenuItems />
              <MenuSeparator />
              <MenuItem onClick={() => setLiveUpdates(!liveUpdates)}>
                <div className="flex w-full items-center gap-x-2">
                  <RefreshCw
                    className={cn("size-4", liveUpdates ? "text-indigo-500" : "text-mist-400")}
                  />
                  <span className="flex-1">{t("header.liveUpdates.label")}</span>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-xs font-medium",
                      liveUpdates
                        ? "bg-indigo-500/15 text-indigo-600 dark:text-indigo-400"
                        : "bg-mist-300/60 text-mist-600 dark:bg-mist-800 dark:text-mist-300",
                    )}
                  >
                    {liveUpdates ? t("header.liveUpdates.on") : t("header.liveUpdates.off")}
                  </span>
                  {liveUpdates && <Check className="size-4" />}
                </div>
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                variant="danger"
                // A plain navigation instead of a form POST: submitting to a
                // resource route can degrade into a native POST, which reverse
                // proxies are known to forward without its body.
                onClick={() => window.location.assign(`${__PREFIX__}/logout`)}
              >
                {t("header.logout")}
              </MenuItem>
            </MenuContent>
          </Menu>
        </div>
      </div>
      {showTabs && (
        <div className="block overflow-x-auto p-2 md:hidden">
          <nav className="flex items-center gap-x-2 text-sm font-medium">
            {tabs.map((tab) => {
              if (!access[tab.key]) return null;
              if ((tab.key === "dns" || tab.key === "settings") && !configAvailable) return null;

              return (
                <NavLink
                  key={tab.to}
                  className={({ isActive }) =>
                    cn(
                      "relative px-3 py-1.5 flex items-center gap-x-1.5 rounded-md text-nowrap",
                      "hover:bg-mist-300/50 dark:hover:bg-mist-800",
                      "focus:outline-hidden focus:ring-2 focus:ring-indigo-500/40 focus:ring-offset-1",
                      "dark:focus:ring-indigo-400/40 dark:focus:ring-offset-mist-900",
                      "text-mist-600 dark:text-mist-300",
                      isActive &&
                        "text-mist-900 dark:text-mist-50 after:content-[''] after:absolute after:-bottom-2 after:inset-x-1 after:h-0.5 after:rounded-full after:bg-indigo-500",
                    )
                  }
                  prefetch="intent"
                  to={tab.to}
                >
                  <tab.icon className="w-4" />
                  {t(tab.labelKey)}
                </NavLink>
              );
            })}
          </nav>
        </div>
      )}
    </header>
  );
}
