import {
  AlertCircle,
  CheckCircle,
  Construction,
  Eye,
  FlaskConical,
  Pencil,
  Route as RouteIcon,
  Shield,
  TagsIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import {
  isRouteErrorResponse,
  useFetcher,
  useRevalidator,
  type ShouldRevalidateFunction,
} from "react-router";

import Button from "~/components/button";
import Card from "~/components/card";
import Code from "~/components/code";
import Link from "~/components/link";
import Notice from "~/components/notice";
import PageError from "~/components/page-error";
import { Tabs, TabsList, TabsPanel, TabsTab } from "~/components/tabs";
import { useI18n } from "~/i18n/provider";
import { isApiError } from "~/server/headscale/api/error-client";
import {
  parsePolicy,
  policyDestinations,
  policySshDestinations,
  policySshSources,
  policySources,
  serializePolicy,
  unsupportedPolicySections,
  type Policy,
} from "~/utils/acl-policy";
import toast from "~/utils/toast";

import type { Route } from "./+types/overview";
import { aclAction } from "./acl-action";
import { aclLoader } from "./acl-loader";
import Fallback from "./components/fallback";
import RulesEditor from "./components/rules-editor";
import TagsGroupsEditor from "./components/tags-groups-editor";
import TailnetPolicyEditor from "./components/tailnet-policy-editor";
import { ACL_ERROR_KEYS } from "./error-keys";
import { POLICY_CHECK_ACTION_ID, shouldRevalidateAcls } from "./should-revalidate";

const LazyEditor = lazy(() =>
  import("./components/cm.client").then((m) => ({ default: m.Editor })),
);
const LazyDiffer = lazy(() =>
  import("./components/cm.client").then((m) => ({ default: m.Differ })),
);

export const loader = aclLoader;
export const action = aclAction;

/**
 * The parse-only "Check" request stores nothing, so it must not re-run this
 * loader. See `./should-revalidate.ts`.
 */
export const shouldRevalidate: ShouldRevalidateFunction = shouldRevalidateAcls;

export default function Page({
  loaderData: { access, writable, policy, users, tagUsage },
}: Route.ComponentProps) {
  const { t, tr } = useI18n();
  const [codePolicy, setCodePolicy] = useState(policy);
  const [checkedPolicy, setCheckedPolicy] = useState<string | null>(null);
  const fetcher = useFetcher<typeof action>();
  const checkFetcher = useFetcher<typeof action>();
  const { revalidate } = useRevalidator();
  const disabled = !access || !writable; // Disable if no permission or not writable
  const busy = fetcher.state !== "idle" || checkFetcher.state !== "idle";

  const parsed = useMemo(() => parsePolicy(codePolicy), [codePolicy]);
  const sources = useMemo(
    () => (parsed.ok ? policySources(parsed.policy, users) : []),
    [parsed, users],
  );
  const destinations = useMemo(
    () => (parsed.ok ? policyDestinations(parsed.policy, users) : []),
    [parsed, users],
  );
  // SSH rules take a much smaller set of sources and destinations than plain
  // access rules, so the SSH dialog gets its own catalogs.
  const sshSources = useMemo(
    () => (parsed.ok ? policySshSources(parsed.policy, users) : []),
    [parsed, users],
  );
  const sshDestinations = useMemo(
    () => (parsed.ok ? policySshDestinations(parsed.policy, users) : []),
    [parsed, users],
  );
  // Sections such as postures or ipSets that Headscale rejects but that the
  // structured editors cannot touch.
  const unsupportedSections = useMemo(
    () => (parsed.ok ? unsupportedPolicySections(parsed.policy) : []),
    [parsed],
  );

  useEffect(() => {
    // Update the codePolicy when the loader data changes
    if (policy !== codePolicy) {
      setCodePolicy(policy);
    }
  }, [policy]);

  useEffect(() => {
    if (!fetcher.data) {
      // No data yet, return
      return;
    }

    if (fetcher.data.success === true) {
      toast(t("acls.updated"));
      revalidate();
    }
  }, [fetcher.data]);

  useEffect(() => {
    // A validation verdict only describes the exact text that was checked, so
    // it stops applying as soon as the editor changes.
    setCheckedPolicy(null);
  }, [codePolicy]);

  // Headscale's rejection of a policy, whether it came from the validate button
  // or from a save that was stopped before it reached storage.
  const rejection =
    checkFetcher.data?.errorCode != null
      ? checkFetcher.data
      : fetcher.data?.errorCode != null
        ? fetcher.data
        : undefined;
  const checkSucceeded =
    rejection == null &&
    checkFetcher.data?.success === true &&
    checkedPolicy != null &&
    checkedPolicy === codePolicy;

  // The structured editors round-trip through the policy text, so the file
  // editor, the diff view and Save all work off one source of truth.
  function applyPolicy(next: Policy) {
    setCodePolicy(serializePolicy(next));
  }

  function structuredPanel(render: (value: Policy) => ReactNode) {
    if (!parsed.ok) {
      return (
        <div className="p-4">
          <Notice title={t("acls.parseError.title")} variant="error">
            {tr("acls.parseError.body", {
              error: parsed.error,
              editFile: <Code>{t("acls.editor.tabs.editFile")}</Code>,
            })}
          </Notice>
        </div>
      );
    }

    return (
      <div className="flex flex-col gap-4 p-4">
        {parsed.hasComments ? (
          <Notice title={t("acls.commentsWarning.title")} variant="warning">
            {t("acls.commentsWarning.body")}
          </Notice>
        ) : null}
        {render(parsed.policy)}
      </div>
    );
  }

  return (
    <div>
      {!access ? (
        <Notice title={t("acls.restricted.title")} variant="warning">
          {t("acls.restricted.body")}
        </Notice>
      ) : !writable ? (
        <Notice title={t("acls.readOnly.title")} variant="error">
          {tr("acls.readOnly.body", {
            file: <Code>file</Code>,
            policyMode: <Code>policy.mode</Code>,
            database: <Code>database</Code>,
          })}
        </Notice>
      ) : undefined}
      <h1 className="mb-4 text-2xl font-medium">{t("acls.title")}</h1>
      <p className="mb-4 max-w-prose">
        {tr("acls.body", {
          tailscaleGuide: (
            <Link external styled to="https://tailscale.com/kb/1018/acls">
              {t("acls.links.tailscaleGuide")}
            </Link>
          ),
          headscaleDocs: (
            <Link external styled to="https://headscale.net/stable/ref/acls/">
              {t("acls.links.headscaleDocs")}
            </Link>
          ),
        })}
      </p>
      {fetcher.data?.error !== undefined ? (
        <Notice
          title={fetcher.data.error.split(":")[0] || t("acls.updateError.fallbackTitle")}
          variant="error"
        >
          {fetcher.data.error.split(":").slice(1).join(": ") || t("acls.updateError.fallbackBody")}
        </Notice>
      ) : undefined}
      {rejection?.detail !== undefined ? (
        <Notice title={t("acls.check.failure.title")} variant="error">
          <p>{t("acls.check.failure.body")}</p>
          <p className="mt-1">{t(ACL_ERROR_KEYS[rejection.errorCode ?? "policyRejected"])}</p>
          <Code className="mt-2 block whitespace-pre-wrap">{rejection.detail}</Code>
        </Notice>
      ) : undefined}
      {checkSucceeded ? (
        <Notice
          title={t("acls.check.success.title")}
          icon={<CheckCircle className="text-green-500" />}
        >
          {t("acls.check.success.body")}
        </Notice>
      ) : undefined}
      {unsupportedSections.length > 0 ? (
        <Notice title={t("acls.unsupported.title")} variant="warning">
          {t("acls.unsupported.body", {
            sections: unsupportedSections.map((section) => `"${section}"`).join(", "),
          })}
        </Notice>
      ) : undefined}
      <Tabs className="mb-4" label={t("acls.editor.label")} defaultValue="rules">
        <TabsList>
          <TabsTab value="rules">
            <div className="flex items-center gap-2">
              <Shield className="p-1" />
              <span>{t("acls.editor.tabs.rules")}</span>
            </div>
          </TabsTab>
          <TabsTab value="grants">
            <div className="flex items-center gap-2">
              <RouteIcon className="p-1" />
              <span>{t("acls.editor.tabs.grants")}</span>
            </div>
          </TabsTab>
          <TabsTab value="tags">
            <div className="flex items-center gap-2">
              <TagsIcon className="p-1" />
              <span>{t("acls.editor.tabs.tagsGroups")}</span>
            </div>
          </TabsTab>
          <TabsTab value="edit">
            <div className="flex items-center gap-2">
              <Pencil className="p-1" />
              <span>{t("acls.editor.tabs.editFile")}</span>
            </div>
          </TabsTab>
          <TabsTab value="diff">
            <div className="flex items-center gap-2">
              <Eye className="p-1" />
              <span>{t("acls.editor.tabs.diff")}</span>
            </div>
          </TabsTab>
          <TabsTab value="preview">
            <div className="flex items-center gap-2">
              <FlaskConical className="p-1" />
              <span>{t("acls.editor.tabs.preview")}</span>
            </div>
          </TabsTab>
        </TabsList>
        <TabsPanel value="rules">
          {structuredPanel((value) => (
            <RulesEditor
              destinations={destinations}
              isDisabled={disabled}
              onChange={applyPolicy}
              policy={value}
              sources={sources}
              sshDestinations={sshDestinations}
              sshSources={sshSources}
            />
          ))}
        </TabsPanel>
        <TabsPanel value="grants">
          {structuredPanel((value) => (
            <TailnetPolicyEditor
              destinations={destinations}
              isDisabled={disabled}
              onChange={applyPolicy}
              policy={value}
              sources={sources}
            />
          ))}
        </TabsPanel>
        <TabsPanel value="tags">
          {structuredPanel((value) => (
            <TagsGroupsEditor
              isDisabled={disabled}
              onChange={applyPolicy}
              policy={value}
              tagUsage={tagUsage}
              users={users}
            />
          ))}
        </TabsPanel>
        <TabsPanel value="edit">
          <Suspense fallback={<Fallback />}>
            <LazyEditor isDisabled={disabled} onChange={setCodePolicy} value={codePolicy} />
          </Suspense>
        </TabsPanel>
        <TabsPanel value="diff">
          <Suspense fallback={<Fallback />}>
            <LazyDiffer left={policy} right={codePolicy} />
          </Suspense>
        </TabsPanel>
        <TabsPanel value="preview">
          <div className="flex flex-col items-center py-8">
            <Construction />
            <p className="mt-4 w-1/2 text-center">{t("acls.editor.previewPending")}</p>
          </div>
        </TabsPanel>
      </Tabs>
      <Button
        className="mr-2"
        disabled={disabled || busy || codePolicy.length === 0}
        onClick={() => {
          // Ask Headscale to parse the policy without storing it, so a bad
          // policy can be fixed before Save ever touches the stored one.
          const formData = new FormData();
          formData.append("action_id", POLICY_CHECK_ACTION_ID);
          formData.append("policy", codePolicy);
          setCheckedPolicy(codePolicy);
          checkFetcher.submit(formData, { method: "PATCH" });
        }}
      >
        {t("acls.check.button")}
      </Button>
      <Button
        className="mr-2"
        disabled={disabled || busy || codePolicy.length === 0 || codePolicy === policy}
        onClick={() => {
          const formData = new FormData();
          formData.append("policy", codePolicy);
          fetcher.submit(formData, { method: "PATCH" });
        }}
        variant="heavy"
      >
        {t("acls.editor.save")}
      </Button>
      <Button
        disabled={disabled || busy || codePolicy === policy}
        onClick={() => {
          // Reset the editor to the original policy
          setCodePolicy(policy);
        }}
      >
        {t("acls.editor.discard")}
      </Button>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  const { t, tr } = useI18n();

  if (
    isRouteErrorResponse(error) &&
    isApiError(error.data) &&
    error.data.detail.includes("reading policy from path") &&
    error.data.detail.includes("no such file or directory")
  ) {
    return (
      <div className="flex flex-col gap-4">
        <Card className="max-w-2xl" variant="flat">
          <div className="flex items-center justify-between gap-4">
            <Card.Title>{t("acls.unavailable.title")}</Card.Title>
            <AlertCircle className="mb-2 h-6 w-6 text-red-500" />
          </div>
          <Card.Text>{tr("acls.unavailable.body", { file: <Code>file</Code> })}</Card.Text>
        </Card>
        <Card className="max-w-2xl" variant="flat">
          <Card.Text>{t("acls.unavailable.actions")}</Card.Text>
          <ul className="mt-2 ml-4 list-outside list-disc space-y-1 text-sm">
            <li>{t("acls.unavailable.createFile")}</li>
            <li>{tr("acls.unavailable.switchDatabase", { database: <Code>database</Code> })}</li>
          </ul>
        </Card>
      </div>
    );
  }

  return <PageError error={error} page="Access Control" />;
}
