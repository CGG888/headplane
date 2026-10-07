import { AlertCircle } from "lucide-react";
import { isRouteErrorResponse } from "react-router";

import { useI18n, type I18nValue } from "~/i18n/provider";
import { isApiError, isConnectionError } from "~/server/headscale/api/error-client";
import cn from "~/utils/cn";
import { isLocalizedPayload } from "~/utils/localized-error";

import Card from "./card";
import Code from "./code";
import Link from "./link";

type Translate = I18nValue["t"];
type TranslateRich = I18nValue["tr"];

export function getErrorMessage(
  error: Error | unknown,
  t: Translate,
  tr: TranslateRich,
): {
  title: string;
  jsxMessage: React.ReactNode;
} {
  // Errors that carry a translation key (for example permission failures)
  // render as localized text instead of the raw English message.
  if (isRouteErrorResponse(error) && isLocalizedPayload(error.data)) {
    return {
      jsxMessage: t(error.data.localized.key, error.data.localized.vars),
      title: t("errors.generic.title"),
    };
  }

  if (isRouteErrorResponse(error)) {
    if (isApiError(error.data)) {
      const { statusCode, detail, data, requestUrl } = error.data;
      if (statusCode >= 500) {
        return {
          jsxMessage: (
            <>
              <Card.Text>
                {tr("errors.api.serverBody", { status: <strong>{statusCode}</strong> })}
              </Card.Text>
              {(error.data.data != null || error.data.detail.length > 0) && (
                <pre className="mt-2 overflow-x-auto rounded-lg bg-mist-100 p-2 dark:bg-mist-800">
                  {error.data.data != null ? (
                    <code>{JSON.stringify(error.data.data, null, 2)}</code>
                  ) : (
                    <code>{error.data.detail}</code>
                  )}
                </pre>
              )}
            </>
          ),
          title: t("errors.api.serverTitle"),
        };
      }

      const authError = error.data.statusCode === 401 || error.data.statusCode === 403;

      return {
        jsxMessage: (
          <>
            <Card.Text className="leading-snug">
              {t("errors.api.invalidBody")}{" "}
              {authError ? t("errors.api.invalidAuth") : t("errors.api.invalidOther")}
            </Card.Text>
            <ul className="mt-2 list-inside list-disc">
              <li>
                {t("errors.api.requestUrl")} <Code>{requestUrl}</Code>
              </li>
              <li>
                {t("errors.api.statusCodeLabel")}{" "}
                <Code>
                  {/* @ts-expect-error */}
                  {data === null ? (
                    <>
                      {statusCode} {detail}
                    </>
                  ) : (
                    <>
                      {statusCode} {error.statusText}
                    </>
                  )}
                </Code>
              </li>
            </ul>
            <Card.Text className="mt-4 text-lg font-semibold">{t("errors.api.details")}</Card.Text>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-mist-100 p-2 dark:bg-mist-800">
              <code>{data != null ? JSON.stringify(data, null, 2) : detail}</code>
            </pre>
          </>
        ),
        title: t("errors.api.invalidTitle"),
      };
    }

    if (isConnectionError(error.data)) {
      const { requestUrl, errorCode, errorMessage, extraData } = error.data;
      return {
        jsxMessage: (
          <>
            <Card.Text className="leading-snug">{t("errors.api.connectionBody")}</Card.Text>
            <Card.Text className="mt-4 text-lg font-semibold">{t("errors.api.details")}</Card.Text>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-mist-100 p-2 dark:bg-mist-800">
              {requestUrl}
              <br />
              {errorCode}: {errorMessage}
              {extraData != null && (
                <>
                  <br />
                  <br />
                  <code>{JSON.stringify(extraData, null, 2)}</code>
                </>
              )}
            </pre>
          </>
        ),
        title: t("errors.api.connectionTitle"),
      };
    }

    return {
      jsxMessage: (
        <>
          {t("errors.generic.requestFailed")}
          <br />
          {t("errors.generic.statusCode")}: <strong>{error.status}</strong>
          <br />
          {t("errors.generic.statusText")}: <strong>{error.data}</strong>
        </>
      ),
      title: t("errors.generic.withStatus", { status: error.status }),
    };
  }

  if (!(error instanceof Error)) {
    return {
      jsxMessage: (
        <>
          <Card.Text>
            {tr("errors.api.unexpectedBody", {
              link: (
                <Link external styled to="https://github.com/CGG888/headplaneCN/issues">
                  {t("errors.api.unexpectedLink")}
                </Link>
              ),
            })}
          </Card.Text>
          <Card.Text className="mt-4 text-lg font-semibold">{t("errors.api.details")}</Card.Text>
          <pre className="mt-2 overflow-x-auto rounded-lg bg-mist-100 p-2 dark:bg-mist-800">
            <code>{JSON.stringify(error, null, 2)}</code>
          </pre>
        </>
      ),
      title: t("errors.api.unexpectedTitle"),
    };
  }

  // Traverse the error chain to find the root cause. `cause` is unknown, so it
  // is only followed while it is an Error: a string or plain-object cause used
  // to be dereferenced as an Error and threw during render.
  let rootError: Error = error;
  let cause: unknown = error.cause;
  for (let depth = 0; depth < 8 && cause instanceof Error && cause !== rootError; depth += 1) {
    rootError = cause;
    cause = cause.cause;
  }

  const titleOf = (target: Error): string =>
    target.name.length > 0 && target.name !== "Error"
      ? t("errors.generic.withName", { name: target.name })
      : t("errors.generic.title");

  // An AggregateError carries its members in `errors`; rendering them beats
  // throwing inside the component that exists to render errors.
  if (rootError instanceof AggregateError) {
    const members = rootError.errors.map((item) =>
      item instanceof Error ? item.message : String(item),
    );

    return {
      jsxMessage: (
        <>
          {rootError.message}
          {members.length > 0 ? (
            <ul className="mt-2 list-disc pl-5">
              {members.map((member, index) => (
                // The list is a fixed snapshot of one error, so the index is a
                // stable key here (members may repeat).
                <li key={`${index}:${member}`}>{member}</li>
              ))}
            </ul>
          ) : undefined}
        </>
      ),
      title: titleOf(rootError),
    };
  }

  return {
    jsxMessage: rootError.message,
    title: titleOf(rootError),
  };
}

interface ErrorBannerProps {
  error: unknown;
  className?: string;
}

export function ErrorBanner({ error, className }: ErrorBannerProps) {
  const { t, tr } = useI18n();
  const { title, jsxMessage } = getErrorMessage(error, t, tr);

  return (
    <Card className={cn("w-screen", className)} variant="flat">
      <div className="flex items-center justify-between gap-4">
        <Card.Title>{title}</Card.Title>
        <AlertCircle className="mb-2 h-6 w-6 text-red-500" />
      </div>
      {jsxMessage}
    </Card>
  );
}
