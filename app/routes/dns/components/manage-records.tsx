import { Form } from "react-router";

import Button from "~/components/button";
import Code from "~/components/code";
import Link from "~/components/link";
import MaskedText from "~/components/masked-text";
import TableList from "~/components/table-list";
import { useI18n } from "~/i18n/provider";
import cn from "~/utils/cn";

import AddRecord from "../dialogs/add-record";
import ImportRecords from "../dialogs/import-records";
import DnsSection from "./dns-section";
import ExportRecords from "./export-records";

interface Props {
  records: { name: string; type: "A" | string; value: string }[];
  isDisabled: boolean;
}

export default function ManageRecords({ records, isDisabled }: Props) {
  const { t, tr } = useI18n();

  return (
    <DnsSection
      description={tr("dns.records.body", {
        a: <Code>A</Code>,
        aaaa: <Code>AAAA</Code>,
        link: (
          <Link external styled to="https://headscale.net/stable/ref/dns">
            {t("common.learnMore")}
          </Link>
        ),
      })}
      title={t("dns.records.title")}
    >
      <div className="flex flex-col gap-4">
        {/* Type, name and target are columns, so records line up with each
            other instead of each row floating on its own. */}
        <TableList className="max-w-4xl">
          {records.length === 0 ? (
            <TableList.Item>
              <p className="mx-auto opacity-50">{t("dns.records.empty")}</p>
            </TableList.Item>
          ) : (
            records.map((record) => (
              <TableList.Item
                className="gap-2 p-3 sm:grid sm:grid-cols-[3.5rem_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-center sm:gap-3"
                key={`${record.name}-${record.value}`}
              >
                <p
                  className={cn(
                    "font-mono text-sm font-bold py-1 px-2 rounded-md text-center",
                    "bg-mist-100 dark:bg-mist-700/30 min-w-12",
                  )}
                >
                  {record.type}
                </p>
                <div className="flex min-w-0 flex-1 flex-col gap-0.5 sm:contents">
                  {/* The record name and its target are a hostname and an
                      address, so both are masked until revealed. The add and
                      remove controls below are untouched. */}
                  <MaskedText className="min-w-0 font-mono text-sm" value={record.name} />
                  <MaskedText
                    className="min-w-0 font-mono text-sm opacity-70 sm:opacity-100"
                    value={record.value}
                  />
                </div>
                <Form method="POST">
                  <input name="action_id" type="hidden" value="remove_record" />
                  <input name="record_name" type="hidden" value={record.name} />
                  <input name="record_type" type="hidden" value={record.type} />
                  <Button
                    className={cn("px-2 py-1 rounded-md", "text-red-500 dark:text-red-400")}
                    disabled={isDisabled}
                    type="submit"
                  >
                    {t("dns.remove")}
                  </Button>
                </Form>
              </TableList.Item>
            ))
          )}
        </TableList>

        <div className="flex flex-wrap items-center gap-2">
          {isDisabled ? undefined : <AddRecord records={records} />}
          {isDisabled ? undefined : <ImportRecords records={records} />}
          <ExportRecords records={records} />
        </div>
      </div>
    </DnsSection>
  );
}
