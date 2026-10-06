import type { ActionFunctionArgs } from "react-router";
import { data, useLoaderData } from "react-router";

import Code from "~/components/code";
import Notice from "~/components/notice";
import PageError from "~/components/page-error";
import { useI18n } from "~/i18n/provider";
import { authContext, headscaleConfigContext } from "~/server/context";
import { Capabilities } from "~/server/web/roles";

import type { Route } from "./+types/overview";
import DnsSection from "./components/dns-section";
import ManageDomains from "./components/manage-domains";
import ManageNS from "./components/manage-ns";
import ManageRecords from "./components/manage-records";
import RenameTailnet from "./components/rename-tailnet";
import ToggleMagic from "./components/toggle-magic";
import { dnsAction } from "./dns-actions";

// We do not want to expose every config value
export async function loader({ request, context }: Route.LoaderArgs) {
  const auth = context.get(authContext);
  const headscaleConfig = context.get(headscaleConfigContext);

  if (!headscaleConfig.readable()) {
    throw new Error("No configuration is available");
  }

  const principal = await auth.require(request);
  const check = auth.can(principal, Capabilities.read_network);
  if (!check) {
    // Not authorized to view this page
    throw data({ localized: { key: "errors.permission.view" } }, { status: 403 });
  }

  const writablePermission = auth.can(principal, Capabilities.write_network);

  const dns = headscaleConfig.getDNSConfig();

  return {
    ...dns,
    access: writablePermission,
    writable: headscaleConfig.writable(),
  };
}

export async function action(data: ActionFunctionArgs) {
  return dnsAction(data);
}

export default function Page() {
  const data = useLoaderData<typeof loader>();
  const { t } = useI18n();

  const allNs: Record<string, string[]> = {};
  for (const key of Object.keys(data.splitDns)) {
    allNs[key] = data.splitDns[key];
  }

  allNs.global = data.nameservers;
  const isDisabled = data.access === false || data.writable === false;

  return (
    // The page box is the header's own content box, like the machines list.
    <div className="flex w-full flex-col gap-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">{t("header.tabs.dns")}</h1>
      </header>

      {data.writable ? undefined : <Notice>{t("dns.readOnlyNotice")}</Notice>}
      {data.access ? undefined : <Notice>{t("dns.noAccessNotice")}</Notice>}

      {/* Naming the tailnet and switching MagicDNS on both answer "how do
          devices address this tailnet", so they share the first row. */}
      <div className="grid gap-6 lg:grid-cols-2">
        <RenameTailnet isDisabled={isDisabled} name={data.baseDomain} />
        <MagicDnsSection
          baseDomain={data.baseDomain}
          isDisabled={isDisabled}
          isEnabled={data.magicDns}
        />
      </div>

      <ManageNS isDisabled={isDisabled} nameservers={allNs} overrideLocalDns={data.overrideDns} />
      <ManageRecords isDisabled={isDisabled} records={data.extraRecords} />
      <ManageDomains
        isDisabled={isDisabled}
        magic={data.magicDns ? data.baseDomain : undefined}
        searchDomains={data.searchDomains}
      />
    </div>
  );
}

/** MagicDNS is one switch, plus the naming rule it turns on. */
function MagicDnsSection({
  baseDomain,
  isEnabled,
  isDisabled,
}: {
  baseDomain: string;
  isEnabled: boolean;
  isDisabled: boolean;
}) {
  const { t, tr } = useI18n();

  return (
    <DnsSection
      description={tr("dns.magicBody", {
        code: (
          <Code>
            [device].
            {baseDomain}
          </Code>
        ),
      })}
      title={t("dns.magicTitle")}
    >
      <div className="flex flex-wrap items-center gap-2">
        <ToggleMagic isDisabled={isDisabled} isEnabled={isEnabled} />
      </div>
    </DnsSection>
  );
}

export function ErrorBoundary({ error }: { error: unknown }) {
  return <PageError error={error} page="DNS" />;
}
