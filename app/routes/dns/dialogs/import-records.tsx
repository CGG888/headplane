import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";

import Button from "~/components/button";
import Dialog, { DialogPanel } from "~/components/dialog";
import RadioGroup from "~/components/radio-group";
import Text from "~/components/text";
import Title from "~/components/title";
import { useI18n } from "~/i18n/provider";
import cn from "~/utils/cn";

import { IMPORT_ERROR_KEYS, importErrorVars } from "../import-error-keys";
import {
  importRecords,
  parseImportMode,
  type DNSRecordInput,
  type ImportActionData,
  type ImportMode,
} from "../records-io";

interface Props {
  records: DNSRecordInput[];
}

/** How many records of each kind the preview lists before summarizing. */
const PREVIEW_LIMIT = 8;

/**
 * Imports records from pasted or picked JSON. The dialog validates and previews
 * the change locally with the same pure module the action uses, so nothing is
 * written before the user confirms.
 */
export default function ImportRecords({ records }: Props) {
  const { t } = useI18n();
  const fetcher = useFetcher<ImportActionData>();
  const submittingRef = useRef(false);
  const [isOpen, setIsOpen] = useState(false);
  const [text, setText] = useState("");
  const [mode, setMode] = useState<ImportMode>("append");

  const parsed = useMemo(() => importRecords(text, records, mode), [text, records, mode]);
  const isEmpty = text.trim().length === 0;
  const localError = isEmpty || parsed.ok ? undefined : parsed.error;
  const plan = !isEmpty && parsed.ok ? parsed.plan : undefined;
  const result = fetcher.data;
  const error = localError ?? (result && !result.success ? result.error : undefined);
  const summary = result?.success ? result : undefined;

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) {
      return;
    }

    submittingRef.current = false;
    // The records were written, so the pasted JSON has been consumed.
    if (fetcher.data.success) {
      setText("");
    }
  }, [fetcher.data, fetcher.state]);

  useEffect(() => {
    if (!isOpen) {
      fetcher.data = undefined;
    }
  }, [isOpen]);

  async function handleFile(file: File | undefined) {
    if (!file) {
      return;
    }

    try {
      setText(await file.text());
    } catch {
      setText("");
    }
  }

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
      <Button onClick={() => setIsOpen(true)} type="button">
        {t("dns.importExport.importButton")}
      </Button>
      <DialogPanel
        isDisabled={fetcher.state !== "idle" || isEmpty || localError !== undefined}
        onSubmit={(event) => {
          event.preventDefault();
          submittingRef.current = true;
          const form = new FormData(event.currentTarget as HTMLFormElement);
          form.set("action_id", "import_dns_records");
          fetcher.submit(form, { method: "POST" });
        }}
      >
        <Title>{t("dns.importExport.title")}</Title>
        <Text>{t("dns.importExport.body")}</Text>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-mist-700 dark:text-mist-200">
            {t("dns.importExport.jsonLabel")}
          </span>
          <textarea
            className={cn(
              "min-h-40 w-full rounded-md px-3 py-2 font-mono text-xs",
              "focus:outline-hidden focus:ring-2 focus:ring-indigo-500/40 focus:ring-offset-1",
              "dark:focus:ring-indigo-400/40 dark:focus:ring-offset-mist-900",
              "bg-white dark:bg-mist-900",
              "border border-mist-200 dark:border-mist-800",
            )}
            name="records_json"
            onChange={(event) => setText(event.target.value)}
            placeholder={t("dns.importExport.jsonPlaceholder")}
            spellCheck={false}
            value={text}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-mist-700 dark:text-mist-200">
            {t("dns.importExport.fileLabel")}
          </span>
          <input
            accept=".json,application/json"
            className={cn(
              "text-xs",
              "file:mr-2 file:rounded-md file:px-2 file:py-1 file:text-xs",
              "file:border file:border-mist-200 file:bg-white",
              "dark:file:border-mist-700 dark:file:bg-mist-800/50",
            )}
            onChange={(event) => {
              void handleFile(event.target.files?.[0]);
            }}
            type="file"
          />
        </label>

        <input name="import_mode" type="hidden" value={mode} />
        <RadioGroup
          label={t("dns.importExport.modeLabel")}
          onValueChange={(value) => setMode(parseImportMode(value))}
          value={mode}
        >
          <RadioGroup.Radio label={t("dns.importExport.modeAppend")} value="append">
            <div className="block">
              <p className="font-bold">{t("dns.importExport.modeAppend")}</p>
              <p className="opacity-70">{t("dns.importExport.modeAppendBody")}</p>
            </div>
          </RadioGroup.Radio>
          <RadioGroup.Radio label={t("dns.importExport.modeReplace")} value="replace">
            <div className="block">
              <p className="font-bold">{t("dns.importExport.modeReplace")}</p>
              <p className="opacity-70">{t("dns.importExport.modeReplaceBody")}</p>
            </div>
          </RadioGroup.Radio>
        </RadioGroup>

        {error ? (
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
            {t(IMPORT_ERROR_KEYS[error.code], importErrorVars(error))}
          </p>
        ) : undefined}

        {summary ? (
          <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-400">
            {t("dns.importExport.success", {
              imported: summary.imported,
              skipped: summary.skipped,
            })}
          </p>
        ) : undefined}

        {summary ? undefined : (
          <div className="rounded-lg bg-mist-50 p-3 text-sm dark:bg-mist-800/50">
            <p className="font-medium">{t("dns.importExport.previewTitle")}</p>
            {plan ? (
              <>
                <ul className="mt-1 flex flex-col gap-0.5 opacity-80">
                  <li>{t("dns.importExport.previewAdd", { count: plan.added.length })}</li>
                  {mode === "replace" ? (
                    <li>{t("dns.importExport.previewRemove", { count: plan.removed.length })}</li>
                  ) : undefined}
                  <li>{t("dns.importExport.previewSkip", { count: plan.skipped })}</li>
                  <li>{t("dns.importExport.previewTotal", { count: plan.records.length })}</li>
                </ul>
                <RecordPreview records={plan.added} />
                {mode === "replace" ? <RecordPreview records={plan.removed} /> : undefined}
              </>
            ) : (
              <p className="mt-1 opacity-60">{t("dns.importExport.previewIdle")}</p>
            )}
          </div>
        )}
      </DialogPanel>
    </Dialog>
  );
}

/** Lists the affected records, so the change is visible before confirming. */
function RecordPreview({ records }: { records: DNSRecordInput[] }) {
  const { t } = useI18n();
  const shown = records.slice(0, PREVIEW_LIMIT);
  if (shown.length === 0) {
    return null;
  }

  return (
    <ul className="mt-1 flex flex-col gap-0.5 font-mono text-xs opacity-70">
      {shown.map((record) => (
        <li className="truncate" key={`${record.type} ${record.name} ${record.value}`}>
          {record.type} {record.name} {record.value}
        </li>
      ))}
      {records.length > shown.length ? (
        <li>{t("dns.importExport.previewMore", { count: records.length - shown.length })}</li>
      ) : undefined}
    </ul>
  );
}
