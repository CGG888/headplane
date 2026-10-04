import { data } from "react-router";

import Card from "~/components/card";
import Link from "~/components/link";
import { translate } from "~/i18n";
import { getLocale } from "~/utils/locale";

import type { Route } from "./+types/not-found";

export async function loader({ request }: Route.LoaderArgs) {
  // Unmatched requests can bypass the root loader, so the locale is resolved
  // here and passed down instead of relying on the i18n context.
  const locale = await getLocale(request);
  return data({ locale }, { status: 404 });
}

export default function NotFound({ loaderData }: Route.ComponentProps) {
  const { locale } = loaderData;

  return (
    <div className="flex h-screen w-screen items-center justify-center">
      <Card className="m-4 max-w-md sm:m-0">
        <Card.Title>{translate(locale, "notFound.title")}</Card.Title>
        <Card.Text>{translate(locale, "notFound.body")}</Card.Text>
        <Link className="mt-4 inline-block text-blue-500 dark:text-blue-400" to="/machines">
          {translate(locale, "notFound.back")}
        </Link>
      </Card>
    </div>
  );
}
