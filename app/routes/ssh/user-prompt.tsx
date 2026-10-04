import { Form } from "react-router";

import Button from "~/components/button";
import Card from "~/components/card";
import Code from "~/components/code";
import Input from "~/components/input";
import Link from "~/components/link";
import { useI18n } from "~/i18n/provider";

interface UserPromptProps {
  hostname: string;
}

export default function UserPrompt({ hostname }: UserPromptProps) {
  const { t, tr } = useI18n();

  return (
    <div className="flex h-screen items-center justify-center">
      <Card>
        <Card.Title>{t("ssh.prompt.title")}</Card.Title>
        <Card.Text className="mb-4">
          {tr("ssh.prompt.body", {
            hostname: <Code>{hostname}</Code>,
            link: (
              <Link external styled to="https://headplane.net/features/ssh#troubleshooting">
                {t("ssh.prompt.troubleshooting")}
              </Link>
            ),
          })}
        </Card.Text>
        <Form
          method="GET"
          onSubmit={(e) => {
            const formData = new FormData(e.currentTarget);
            const username = formData.get("user");
            if (!username) {
              e.preventDefault();
              return;
            }

            // We have to do a full navigation, since the page needs a full
            // reload to initialize the SSH connection due to us disabling the
            // revalidator.
            const url = new URL(window.location.href);
            url.searchParams.set("user", username.toString());
            window.location.assign(url.toString());
          }}
        >
          <Input
            labelHidden
            type="text"
            label={t("ssh.prompt.usernameLabel")}
            name="user"
            placeholder={t("ssh.prompt.usernameLabel")}
            className="mb-2"
            required
          />
          <Button type="submit" variant="heavy" className="w-full">
            {t("ssh.prompt.connect")}
          </Button>
        </Form>
      </Card>
    </div>
  );
}
