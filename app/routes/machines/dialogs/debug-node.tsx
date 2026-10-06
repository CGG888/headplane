import { type } from "arktype";
import { useEffect, useRef, useState } from "react";
import { useFetcher } from "react-router";

import Dialog, { DialogPanel } from "~/components/dialog";
import Input from "~/components/input";
import Link from "~/components/link";
import Text from "~/components/text";
import Title from "~/components/title";
import { useForm } from "~/hooks/use-form";
import type { TranslationKey } from "~/i18n";
import { useI18n } from "~/i18n/provider";

import {
  confirmedDebugNodeRequest,
  isCidr,
  parseRouteList,
  type DebugNodeFields,
  type DebugNodeResult,
  type DebugNodeSummary,
} from "../debug-node-request";

const debugSchema = type({
  user: "string",
  key: "string",
  name: "string",
  routes: "string",
});

/** Stable codes the action answers with, mapped onto localized messages. */
const ERROR_KEYS: Record<string, TranslationKey> = {
  failed: "machines.debug.errors.failed",
  invalidRoutes: "machines.debug.routesInvalid",
};

interface DebugNodeProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}

/**
 * The danger zone's escape hatch for a node that does not exist yet.
 *
 * `POST /api/v1/debug/node` fabricates a node server-side, which is why it
 * lives behind the destructive confirm and says so in as many words: the node
 * is real, it stays on the tailnet until it is deleted, and the operator is the
 * one who has to remove it again. Every field is optional and is passed through
 * exactly as filled in, so Headscale sees only what was asked for.
 */
export default function DebugNode({ isOpen, setIsOpen }: DebugNodeProps) {
  const { t } = useI18n();
  const fetcher = useFetcher<DebugNodeResult>();
  const submittingRef = useRef(false);
  const [created, setCreated] = useState<DebugNodeSummary | null>(null);

  const form = useForm({
    schema: debugSchema,
    validate: (values) => {
      const invalid = parseRouteList(String(values.routes ?? "")).find((route) => !isCidr(route));
      return invalid === undefined ? undefined : { routes: t("machines.debug.routesInvalid") };
    },
  });
  const { reset } = form;

  const error =
    fetcher.data && !fetcher.data.success
      ? (fetcher.data.error ??
        t(ERROR_KEYS[fetcher.data.errorCode ?? ""] ?? "machines.debug.errors.failed"))
      : null;

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data) {
      submittingRef.current = false;
      if (fetcher.data.success) {
        setCreated(fetcher.data.node);
      }
    }
  }, [fetcher.data, fetcher.state]);

  // Opening starts from an empty form: a leftover name or key from the last
  // node would be submitted as if the operator had typed it.
  useEffect(() => {
    if (isOpen) {
      reset();
    } else {
      setCreated(null);
    }
  }, [isOpen, reset]);

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
      {created ? (
        <DialogPanel variant="unactionable">
          <Title>{t("machines.debug.createdTitle")}</Title>
          <Text>{t("machines.debug.createdBody")}</Text>
          <p className="text-sm font-medium">
            <Link className="text-indigo-600 dark:text-indigo-400" to={created.href}>
              {created.name || t("machines.debug.unnamed")}
            </Link>
          </p>
          <Text>{t("machines.debug.createdDelete")}</Text>
        </DialogPanel>
      ) : (
        <DialogPanel
          isDisabled={fetcher.state !== "idle" || !form.canSubmit}
          onSubmit={(event) => {
            event.preventDefault();

            const fields: DebugNodeFields = {
              key: String(form.values.key ?? ""),
              name: String(form.values.name ?? ""),
              routes: parseRouteList(String(form.values.routes ?? "")),
              user: String(form.values.user ?? ""),
            };

            // The only path that submits: the confirmation dialog is open and
            // the operator pressed its destructive confirm button. A payload
            // that would not be built (a blank submission) is dropped here.
            const body = confirmedDebugNodeRequest(isOpen, fields);
            if (!body) {
              return;
            }

            submittingRef.current = true;
            fetcher.submit(body, { method: "POST" });
          }}
          variant="destructive"
        >
          <Title>{t("machines.debug.title")}</Title>
          <Text>{t("machines.debug.body")}</Text>
          <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
            {t("machines.debug.lifetime")}
          </p>
          {error ? (
            <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
              {error}
            </p>
          ) : null}
          <Input
            {...form.field("user")}
            description={t("machines.debug.userDescription")}
            label={t("machines.debug.userLabel")}
          />
          <Input
            {...form.field("key")}
            description={t("machines.debug.keyDescription")}
            label={t("machines.debug.keyLabel")}
          />
          <Input
            {...form.field("name")}
            description={t("machines.debug.nameDescription")}
            label={t("machines.debug.nameLabel")}
          />
          <Input
            {...form.field("routes")}
            description={t("machines.debug.routesDescription")}
            label={t("machines.debug.routesLabel")}
          />
          <p className="text-sm opacity-70">{t("machines.debug.defaults")}</p>
        </DialogPanel>
      )}
    </Dialog>
  );
}
