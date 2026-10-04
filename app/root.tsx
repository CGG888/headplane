import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  unstable_useRoute as useRoute,
} from "react-router";

import { translate } from "~/i18n";
import { I18nProvider } from "~/i18n/provider";
import { LiveDataProvider } from "~/utils/live-data";
import { DEFAULT_LOCALE, getLocale } from "~/utils/locale";
import ToastProvider from "~/utils/toast-provider";

import type { Route } from "./+types/root";
import { ErrorBanner } from "./components/error-banner";

import "@fontsource-variable/inter/opsz.css";
import "./tailwind.css";
import { getColorScheme } from "./utils/color-scheme";

export function meta({ loaderData }: Route.MetaArgs) {
  const locale = loaderData?.locale ?? DEFAULT_LOCALE;

  return [
    { title: "Headplane" },
    {
      name: "description",
      content: translate(locale, "meta.description"),
    },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  const [colorScheme, locale] = await Promise.all([getColorScheme(request), getLocale(request)]);

  return { colorScheme, locale };
}

export function Layout({ children }: { readonly children: React.ReactNode }) {
  const { loaderData } = useRoute("root");
  const locale = loaderData?.locale ?? DEFAULT_LOCALE;

  // LiveDataProvider is wrapped at the top level since dialogs and things
  // that control its state are usually open in portal containers which
  // are not a part of the normal React tree.
  return (
    <LiveDataProvider>
      <I18nProvider locale={locale}>
        <html
          lang={locale}
          dir="ltr"
          className={
            loaderData?.colorScheme === "dark"
              ? "dark"
              : loaderData?.colorScheme === "light"
                ? "light"
                : ""
          }
        >
          <head>
            <meta charSet="utf-8" />
            <meta content="width=device-width, initial-scale=1" name="viewport" />
            <Meta />
            <Links />
            <link href={`${__PREFIX__}/favicon.ico`} rel="icon" />
          </head>
          <body className="w-full overflow-x-hidden overscroll-none dark:bg-mist-900 dark:text-mist-50">
            {children}
            <ToastProvider />
            <ScrollRestoration />
            <Scripts />
          </body>
        </html>
      </I18nProvider>
    </LiveDataProvider>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return (
    <div className="flex h-screen w-screen items-center justify-center p-4">
      <ErrorBanner className="max-w-2xl" error={error} />
    </div>
  );
}

export default function App() {
  return <Outlet />;
}
