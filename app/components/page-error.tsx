import { RefreshCw, ServerOff } from "lucide-react";
import { isRouteErrorResponse, useRevalidator } from "react-router";

import { useI18n } from "~/i18n/provider";
import { isConnectionError } from "~/server/headscale/api/error-client";
import cn from "~/utils/cn";

import Button from "./button";
import { ErrorBanner } from "./error-banner";

/** Page names as passed by each route's error boundary. */
export type PageName = "Machines" | "Users" | "Access Control" | "DNS" | "Settings";

interface PageErrorProps {
  error: unknown;
  page: PageName;
}

export default function PageError({ error, page }: PageErrorProps) {
  const { revalidate, state } = useRevalidator();
  const { t } = useI18n();

  if (isRouteErrorResponse(error) && isConnectionError(error.data)) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <ServerOff className={cn("h-12 w-12", "text-mist-400 dark:text-mist-500")} />
        <h2 className="mt-4 text-lg font-semibold">
          {t("pages.unavailableTitle", { page: t(`pages.${page}`) })}
        </h2>
        <p className="mt-1 max-w-sm text-sm text-mist-500 dark:text-mist-400">
          {t("pages.unavailableBody")}
        </p>
        <Button
          className="mt-6"
          variant="light"
          onClick={() => revalidate()}
          disabled={state === "loading"}
        >
          <RefreshCw
            className={cn("mr-2 inline-block h-4 w-4", state === "loading" && "animate-spin")}
          />
          {t("common.retry")}
        </Button>
      </div>
    );
  }

  return <ErrorBanner className="max-w-2xl" error={error} />;
}
