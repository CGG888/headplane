import { Info } from "lucide-react";
import { Form, useSubmit } from "react-router";

import Button from "~/components/button";
import Link from "~/components/link";
import Switch from "~/components/switch";
import TableList from "~/components/table-list";
import Tooltip from "~/components/tooltip";
import { useI18n } from "~/i18n/provider";
import cn from "~/utils/cn";

import AddNS from "../dialogs/add-ns";
import DnsSection from "./dns-section";

interface Props {
  nameservers: Record<string, string[]>;
  overrideLocalDns: boolean;
  isDisabled: boolean;
}

export default function ManageNS({ nameservers, isDisabled, overrideLocalDns }: Props) {
  const { t, tr } = useI18n();

  const splitNames = Object.keys(nameservers).filter((key) => key !== "global");

  return (
    <DnsSection
      description={tr("dns.ns.body", {
        link: (
          <Link external styled to="https://tailscale.com/kb/1054/dns">
            {t("common.learnMore")}
          </Link>
        ),
      })}
      title={t("dns.ns.title")}
    >
      <div className="flex flex-col gap-6">
        {/* The global list carries the override switch, so it stays on its own
            row; the per-domain lists are peers and pair up once there is room. */}
        <NameserverList
          isDisabled={isDisabled}
          isGlobal
          name="global"
          nameservers={nameservers}
          overrideLocalDns={overrideLocalDns}
        />

        <div className="grid gap-6 xl:grid-cols-2">
          {splitNames.map((key) => (
            <NameserverList
              isDisabled={isDisabled}
              isGlobal={false}
              key={key}
              name={key}
              nameservers={nameservers}
              overrideLocalDns={overrideLocalDns}
            />
          ))}
        </div>

        {isDisabled ? undefined : <AddNS nameservers={nameservers} />}
      </div>
    </DnsSection>
  );
}

interface ListProps {
  isGlobal: boolean;
  isDisabled: boolean;
  nameservers: Record<string, string[]>;
  overrideLocalDns: boolean;
  name: string;
}

function NameserverList({ isGlobal, isDisabled, nameservers, overrideLocalDns, name }: ListProps) {
  const { t, tr } = useI18n();
  const list = isGlobal ? nameservers.global : nameservers[name];
  const submit = useSubmit();

  if (list.length === 0) {
    return null;
  }

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h3 className="text-sm font-medium text-mist-600 dark:text-mist-400">
          {isGlobal ? t("dns.ns.global") : name}
        </h3>
        {isGlobal ? (
          <div className="flex items-center gap-2 text-sm">
            <Tooltip
              content={
                <>
                  {tr("dns.ns.overrideTooltip", {
                    link: (
                      <Link
                        external
                        styled
                        to="https://tailscale.com/kb/1054/dns#global-nameservers"
                      >
                        {t("common.learnMore")}
                      </Link>
                    ),
                  })}
                </>
              }
            >
              <Info className="size-4" />
            </Tooltip>
            <p>{t("dns.ns.override")}</p>
            <Switch
              className="h-[15px] w-[23px] p-0.5"
              defaultChecked={overrideLocalDns}
              label={t("dns.ns.overrideLabel")}
              name="override_dns"
              onCheckedChange={(v) => {
                submit(
                  {
                    action_id: "override_dns",
                    override_dns: v ? "true" : "false",
                  },
                  {
                    method: "POST",
                  },
                );
              }}
              switchClassName="h-[9px] w-[9px]"
            />
          </div>
        ) : undefined}
      </div>
      {/* Addresses are short; the list keeps a readable measure instead of
          stretching one per row across the page. */}
      <TableList className="max-w-4xl">
        {list.map((ns) => (
          <TableList.Item key={ns}>
            <p className="min-w-0 flex-1 truncate font-mono text-sm" title={ns}>
              {ns}
            </p>
            <Form method="POST">
              <input name="action_id" type="hidden" value="remove_ns" />
              <input name="ns" type="hidden" value={ns} />
              <input name="split_name" type="hidden" value={isGlobal ? "global" : name} />
              <Button
                className={cn("px-2 py-1 rounded-md", "text-red-500 dark:text-red-400")}
                disabled={isDisabled}
                type="submit"
              >
                {t("dns.remove")}
              </Button>
            </Form>
          </TableList.Item>
        ))}
      </TableList>
    </div>
  );
}
