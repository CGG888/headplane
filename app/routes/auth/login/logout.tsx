import Card from "~/components/card";
import { useI18n } from "~/i18n/provider";

export default function Logout() {
  const { t } = useI18n();

  return (
    <div className="flex h-screen w-screen items-center justify-center">
      <Card className="m-4 max-w-md sm:m-0">
        <Card.Title>{t("login.logout.title")}</Card.Title>
        <Card.Text>{t("login.logout.body")}</Card.Text>
      </Card>
    </div>
  );
}
