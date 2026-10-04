import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

import Button from "~/components/button";
import CodeBlock from "~/components/code-block";
import Dialog, { DialogPanel } from "~/components/dialog";
import Input from "~/components/input";
import Link from "~/components/link";
import NumberInput from "~/components/number-input";
import Select from "~/components/select";
import Switch from "~/components/switch";
import Text from "~/components/text";
import Title from "~/components/title";
import { useI18n } from "~/i18n/provider";
import type { User } from "~/types";
import { getUserDisplayName } from "~/utils/user";

interface AddAuthKeyProps {
  users: User[];
  url: string;
  selfServiceOnly: boolean;
  currentHeadscaleUserId?: string;
  currentSubject?: string;
}

function findCurrentUser(
  users: User[],
  headscaleUserId: string | undefined,
  subject: string | undefined,
): User | undefined {
  if (headscaleUserId) {
    const linked = users.find((u) => u.id === headscaleUserId);
    if (linked) {
      return linked;
    }
  }

  if (!subject) {
    return undefined;
  }
  return users.find((u) => {
    if (u.provider !== "oidc" || !u.providerId) {
      return false;
    }
    const segment = u.providerId.split("/").pop();
    return segment ? decodeURIComponent(segment) === subject : false;
  });
}

export default function AddAuthKey({
  users,
  url,
  selfServiceOnly,
  currentHeadscaleUserId,
  currentSubject,
}: AddAuthKeyProps) {
  const { t, tr } = useI18n();
  const fetcher = useFetcher();
  const submittingRef = useRef(false);
  const [isOpen, setIsOpen] = useState(false);
  const [reusable, setReusable] = useState(false);
  const [ephemeral, setEphemeral] = useState(false);
  const [tagOnly, setTagOnly] = useState(false);
  const currentUser = selfServiceOnly
    ? findCurrentUser(users, currentHeadscaleUserId, currentSubject)
    : null;
  const availableUsers = selfServiceOnly && currentUser ? [currentUser] : users;
  const [userId, setUserId] = useState<string | null>(availableUsers[0]?.id);
  const [tags, setTags] = useState("");

  const createdKey = fetcher.data?.success ? fetcher.data.key : null;

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      submittingRef.current = false;
    }
  }, [fetcher.data, fetcher.state]);

  useEffect(() => {
    if (!isOpen) {
      setReusable(false);
      setEphemeral(false);
      setTagOnly(false);
      setUserId(availableUsers[0]?.id);
      setTags("");
      fetcher.data = undefined;
    }
  }, [isOpen]);

  const parsedTags = tags
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => (entry.startsWith("tag:") ? entry : `tag:${entry}`));

  const canSubmit = tagOnly ? parsedTags.length > 0 : userId != null;

  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open && submittingRef.current) {
          return;
        }
        setIsOpen(open);
      }}
    >
      <Button className="my-4" onClick={() => setIsOpen(true)}>
        {t("settings.addKey.create")}
      </Button>
      {createdKey ? (
        <DialogPanel variant="unactionable">
          <Title>{t("settings.addKey.createdTitle")}</Title>
          <Text>{t("settings.addKey.createdBody")}</Text>
          <CodeBlock className="mt-4">{createdKey}</CodeBlock>
          <Text className="mt-4 text-sm">{t("settings.addKey.registerBody")}</Text>
          <CodeBlock className="mt-1">
            {`tailscale up --login-server=${url} --authkey ${createdKey}`}
          </CodeBlock>
        </DialogPanel>
      ) : (
        <DialogPanel
          onSubmit={(event) => {
            event.preventDefault();
            submittingRef.current = true;
            const form = new FormData(event.currentTarget as HTMLFormElement);
            form.set("action_id", "add_preauthkey");
            form.set("user_id", tagOnly ? "" : (userId?.toString() ?? ""));
            form.set("reusable", reusable ? "on" : "off");
            form.set("ephemeral", ephemeral ? "on" : "off");
            form.set("acl_tags", parsedTags.join(","));
            fetcher.submit(form, { method: "POST" });
          }}
          isDisabled={fetcher.state !== "idle" || !canSubmit}
        >
          <Title>{t("settings.addKey.title")}</Title>

          {!selfServiceOnly && (
            <div className="mb-4 flex items-center justify-between gap-2">
              <div>
                <Text className="font-semibold">{t("settings.addKey.tagOnlyTitle")}</Text>
                <Text className="text-sm">{t("settings.addKey.tagOnlyBody")}</Text>
              </div>
              <Switch
                defaultChecked={tagOnly}
                label={t("settings.addKey.tagOnlyLabel")}
                onCheckedChange={() => setTagOnly(!tagOnly)}
              />
            </div>
          )}

          {!tagOnly && (
            <Select
              className="mb-2"
              description={
                selfServiceOnly
                  ? t("settings.addKey.userDescriptionSelf")
                  : t("settings.addKey.userDescription")
              }
              disabled={selfServiceOnly}
              required
              label={t("settings.authKeys.userLabel")}
              onValueChange={(value) => setUserId(value)}
              placeholder={t("settings.authKeys.userPlaceholder")}
              value={userId}
              items={availableUsers.map((user) => ({
                value: user.id,
                label: getUserDisplayName(user, t("machines.common.tagOwned")),
              }))}
            />
          )}

          <Input
            className="mb-2"
            description={t("settings.addKey.tagsDescription")}
            required={tagOnly}
            label={t("settings.addKey.tagsLabel")}
            onChange={(value) => setTags(value)}
            placeholder={t("settings.addKey.tagsPlaceholder")}
            value={tags}
          />
          <NumberInput
            defaultValue={90}
            description={t("settings.addKey.expiryDescription")}
            required
            label={t("settings.addKey.expiryLabel")}
            max={365_000}
            min={1}
            name="expiry"
          />
          <div className="mt-6 flex items-center justify-between gap-2">
            <div>
              <Text className="font-semibold">{t("settings.addKey.reusableTitle")}</Text>
              <Text className="text-sm">{t("settings.addKey.reusableBody")}</Text>
            </div>
            <Switch
              defaultChecked={reusable}
              label={t("settings.addKey.reusableTitle")}
              onCheckedChange={() => setReusable(!reusable)}
            />
          </div>
          <div className="mt-6 flex items-center justify-between gap-2">
            <div>
              <Text className="font-semibold">{t("settings.addKey.ephemeralTitle")}</Text>
              <Text className="text-sm">
                {tr("settings.addKey.ephemeralBody", {
                  link: (
                    <Link external styled to="https://tailscale.com/kb/1111/ephemeral-nodes">
                      {t("common.learnMore")}
                    </Link>
                  ),
                })}
              </Text>
            </div>
            <Switch
              defaultChecked={ephemeral}
              label={t("settings.addKey.ephemeralTitle")}
              onCheckedChange={() => setEphemeral(!ephemeral)}
            />
          </div>
        </DialogPanel>
      )}
    </Dialog>
  );
}
