import { KeyRound } from "lucide-react";
import { data } from "react-router";

import Link from "~/components/link";
import TableList from "~/components/table-list";
import { useI18n } from "~/i18n/provider";
import { authContext, requestApiContext } from "~/server/context";
import { Capabilities } from "~/server/web/roles";

import type { Route } from "./+types/overview";
import { apiKeysAction } from "./actions";
import ApiKeyRow from "./api-key-row";
import CreateApiKey from "./dialogs/create-api-key";

export async function loader({ request, context }: Route.LoaderArgs) {
  const auth = context.get(authContext);
  const getRequestApi = context.get(requestApiContext);

  const principal = await auth.require(request);
  const check = auth.can(principal, Capabilities.configure_iam);
  if (!check) {
    throw data(
      { localized: { key: "errors.permission.viewIam" } },
      {
        status: 403,
      },
    );
  }

  const { api } = await getRequestApi(request);
  const keys = await api.apiKeys.list();

  return { keys };
}

export const action = apiKeysAction;

export default function Page({ loaderData: { keys } }: Route.ComponentProps) {
  const { t } = useI18n();

  return (
    <div className="flex flex-col md:w-2/3">
      <p className="text-md mb-8">
        <Link className="font-medium" to="/settings">
          {t("settings.overview.title")}
        </Link>
        <span className="mx-2">/</span> {t("settings.apiKeys.breadcrumb")}
      </p>
      <h1 className="mb-2 text-2xl font-medium">{t("settings.apiKeys.title")}</h1>
      <p className="mb-4">{t("settings.apiKeys.body")}</p>
      <CreateApiKey />
      <TableList className="mt-4">
        {keys.length === 0 ? (
          <TableList.Item className="flex flex-col items-center gap-2.5 py-4 opacity-70">
            <KeyRound />
            <p className="font-semibold">{t("settings.apiKeys.empty")}</p>
          </TableList.Item>
        ) : (
          keys.map((key) => (
            <TableList.Item key={key.id}>
              <ApiKeyRow apiKey={key} />
            </TableList.Item>
          ))
        )}
      </TableList>
    </div>
  );
}
