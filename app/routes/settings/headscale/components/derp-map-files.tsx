import { Eye, FileCode2, Pencil, RotateCcw, Save, Sparkles, X } from "lucide-react";
import { memo, useEffect, useState, type ReactNode } from "react";
import { useFetcher } from "react-router";

import Button from "~/components/button";
import CodeBlock from "~/components/code-block";
import { useI18n } from "~/i18n/provider";
import type { DerpMapFileView } from "~/server/headscale/derp-map-files";
import cn from "~/utils/cn";
import type { Locale } from "~/utils/locale";

import { computeDerpMapChecks, type DerpMapCheck } from "../derp-map-checks";
import { MAX_DERP_MAP_BYTES } from "../derp-map-limits";
import type { DerpMapIssue } from "../derp-map-schema";
import {
  buildDerpMapTemplate,
  DERP_MAP_TEMPLATE_IDS,
  derpMapTemplateNote,
  derpMapTemplateTitle,
  type DerpMapTemplateId,
} from "../derp-map-templates";
import {
  DERP_MAP_ISSUE_KEYS,
  HEADSCALE_SETTINGS_ERROR_KEYS,
  type HeadscaleSettingsResult,
} from "../error-keys";

/**
 * The recommended mount for the directory holding every `derp.paths` file. Only
 * this directory is shared read-write, so the rest of Headscale's data directory
 * stays out of the container.
 */
const MOUNT_SNIPPET = '- "/vol1/@appdata/headscale/derp-maps:/etc/headscale/derp-maps"';

const EDITOR_CLASS = cn(
  "min-h-64 w-full rounded-md px-3 py-2 font-mono text-xs",
  "focus:outline-hidden focus:ring-2 focus:ring-indigo-500/40 focus:ring-offset-1",
  "dark:focus:ring-indigo-400/40 dark:focus:ring-offset-mist-900",
  "bg-white dark:bg-mist-900",
  "border border-mist-200 dark:border-mist-800",
);

/** What the loader could not tell us about a path the config still lists. */
const UNKNOWN_VIEW = {
  exists: false,
  readable: false,
  writable: false,
  isFile: false,
  size: 0,
  tooLarge: false,
  unavailable: false,
  issues: [] as DerpMapIssue[],
};

interface DerpMapFilesProps {
  /** `derp.paths`, in the order Headscale's configuration lists them. */
  paths: string[];
  /** The loader's inspection of the same paths, in the same order. */
  files: DerpMapFileView[];
  /** True when nothing may be saved (permission, or a read-only config file). */
  isDisabled: boolean;
}

export default function DerpMapFiles({ paths, files, isDisabled }: DerpMapFilesProps) {
  const { t } = useI18n();
  const byPath = new Map(files.map((file) => [file.path, file]));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">{t("settings.headscale.derp.mapsMountTitle")}</p>
        <p className="text-sm text-mist-600 dark:text-mist-400">
          {t("settings.headscale.derp.mapsMountBody")}
        </p>
        <CodeBlock>{MOUNT_SNIPPET}</CodeBlock>
        <p className="text-xs text-mist-500 dark:text-mist-400">
          {t("settings.headscale.derp.mapsMountNote")}
        </p>
      </div>

      <div className="flex flex-col divide-y divide-mist-200 rounded-lg border border-mist-200 dark:divide-mist-800 dark:border-mist-800">
        {paths.map((path) => (
          <DerpMapFileRow file={byPath.get(path)} isDisabled={isDisabled} key={path} path={path} />
        ))}
      </div>
    </div>
  );
}

interface DerpMapFileRowProps {
  file: DerpMapFileView | undefined;
  isDisabled: boolean;
  path: string;
}

type RowMode = "closed" | "view" | "edit" | "templates";

function DerpMapFileRow({ file, isDisabled, path }: DerpMapFileRowProps) {
  const { t, locale } = useI18n();
  const saveFetcher = useFetcher<HeadscaleSettingsResult>();
  const restoreFetcher = useFetcher<HeadscaleSettingsResult>();
  const removeFetcher = useFetcher<HeadscaleSettingsResult>();

  const [mode, setMode] = useState<RowMode>("closed");
  const [draft, setDraft] = useState("");
  const [inlineIssues, setInlineIssues] = useState<DerpMapIssue[] | undefined>();

  const view = file ?? { path, ...UNKNOWN_VIEW };

  const checks = computeDerpMapChecks({
    path,
    exists: view.exists,
    isFile: view.isFile,
    readable: view.readable,
    writable: view.writable,
    tooLarge: view.tooLarge,
    unavailable: view.unavailable,
    issues: view.issues,
  });
  const failures = checks.filter((check) => check.status !== "pass");

  // Inline validation while typing. The validator is the module the action uses
  // too; it is loaded on demand so the YAML parser only reaches a browser that
  // actually opens an editor.
  useEffect(() => {
    if (mode !== "edit") {
      setInlineIssues(undefined);
      return;
    }

    let cancelled = false;
    const handle = setTimeout(() => {
      void import("../derp-map-schema").then(({ validateDerpMap }) => {
        if (!cancelled) {
          setInlineIssues(validateDerpMap(draft));
        }
      });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [draft, mode]);

  const busy =
    saveFetcher.state !== "idle" ||
    restoreFetcher.state !== "idle" ||
    removeFetcher.state !== "idle";
  const saveError =
    saveFetcher.data && !saveFetcher.data.success
      ? { code: saveFetcher.data.errorCode, issues: saveFetcher.data.issues }
      : undefined;
  const restoreError =
    restoreFetcher.data && !restoreFetcher.data.success
      ? t(HEADSCALE_SETTINGS_ERROR_KEYS[restoreFetcher.data.errorCode])
      : undefined;
  const removeError =
    removeFetcher.data && !removeFetcher.data.success
      ? t(HEADSCALE_SETTINGS_ERROR_KEYS[removeFetcher.data.errorCode])
      : undefined;
  const settled = saveFetcher.state === "idle" ? saveFetcher.data : undefined;
  const saved = settled?.success === true ? settled : undefined;
  const restored = restoreFetcher.state === "idle" && restoreFetcher.data?.success === true;

  // The server is the authority: its issues replace the inline ones, which only
  // exist so a mistake is visible before the save button is pressed.
  const reportedIssues = saveError?.issues ?? inlineIssues ?? [];
  const draftTooLarge = new TextEncoder().encode(draft).length > MAX_DERP_MAP_BYTES;
  const saveBlocked = isDisabled || busy || draftTooLarge || (inlineIssues?.length ?? 0) > 0;
  // An editor that cannot show what is in the file must not be able to replace
  // it: an unreadable or oversized map is offered for nothing but removal.
  const canEdit = !view.unavailable && (view.exists ? view.readable && !view.tooLarge : true);

  function issueText(issue: DerpMapIssue): string {
    const message = t(DERP_MAP_ISSUE_KEYS[issue.code], issue.vars);
    if (issue.line === undefined) {
      return message;
    }

    return t("settings.headscale.derp.mapIssues.position", {
      message,
      line: issue.line,
      column: issue.column ?? 1,
    });
  }

  function openEditor(content: string) {
    setDraft(content);
    setMode("edit");
  }

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 p-2">
        <div className="flex min-w-0 flex-col">
          <p className="truncate font-mono text-sm" title={path}>
            {path}
          </p>
          <StatusLine failures={failures} />
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <Button
            disabled={!view.content}
            onClick={() => setMode(mode === "view" ? "closed" : "view")}
            type="button"
            variant="ghost"
          >
            <Eye className="size-4" />
            {t("settings.headscale.derp.mapsView")}
          </Button>
          <Button
            disabled={isDisabled || !canEdit}
            onClick={() => openEditor(view.content ?? "")}
            type="button"
            variant="ghost"
          >
            <Pencil className="size-4" />
            {t("settings.headscale.derp.mapsEdit")}
          </Button>
          <Button
            disabled={isDisabled || !canEdit}
            onClick={() => setMode(mode === "templates" ? "closed" : "templates")}
            type="button"
            variant="ghost"
          >
            <Sparkles className="size-4" />
            {t("settings.headscale.derp.mapsFromExample")}
          </Button>
          {view.snapshotId ? (
            <restoreFetcher.Form method="post">
              <input name="action_id" type="hidden" value="restore_derp_map" />
              <input name="path" type="hidden" value={path} />
              <Button disabled={isDisabled || busy} type="submit" variant="ghost">
                <RotateCcw className="size-4" />
                {t("settings.headscale.derp.mapsRollback")}
              </Button>
            </restoreFetcher.Form>
          ) : undefined}
          <removeFetcher.Form method="post">
            <input name="action_id" type="hidden" value="remove_derp_path" />
            <input name="path" type="hidden" value={path} />
            <Button
              className="text-red-500 dark:text-red-400"
              disabled={isDisabled || busy}
              type="submit"
              variant="ghost"
            >
              {t("settings.headscale.derp.removePath")}
            </Button>
          </removeFetcher.Form>
        </div>
      </div>

      {failures.length > 0 ? (
        <ul className="flex flex-col gap-1 px-2 pb-2 text-xs">
          {failures.map((failure) => (
            <li
              className={cn(
                failure.status === "fail"
                  ? "text-red-600 dark:text-red-400"
                  : "text-amber-700 dark:text-amber-400",
              )}
              key={failure.id}
            >
              • {t(failure.bodyKey, failure.vars)}
            </li>
          ))}
        </ul>
      ) : undefined}

      {restoreError ? <RowError message={restoreError} /> : undefined}
      {removeError ? <RowError message={removeError} /> : undefined}
      {restored && view.snapshotId ? (
        <RowNote>
          {t("settings.headscale.derp.mapsRolledBack", { snapshot: view.snapshotId })}
        </RowNote>
      ) : undefined}

      {mode === "view" ? (
        <div className="px-2 pb-3">
          <YamlLines content={view.content ?? ""} />
        </div>
      ) : undefined}

      {mode === "templates" ? (
        <div className="flex flex-col gap-2 px-2 pb-3">
          <p className="text-xs text-mist-500 dark:text-mist-400">
            {t("settings.headscale.derp.mapsTemplateIntro")}
          </p>
          <div className="flex flex-wrap gap-2">
            {DERP_MAP_TEMPLATE_IDS.map((id) => (
              <TemplateButton
                id={id}
                key={id}
                locale={locale}
                onPick={() => openEditor(buildDerpMapTemplate(id, locale))}
              />
            ))}
          </div>
        </div>
      ) : undefined}

      {mode === "edit" ? (
        <saveFetcher.Form className="flex flex-col gap-2 px-2 pb-3" method="post">
          <input name="action_id" type="hidden" value="save_derp_map" />
          <input name="path" type="hidden" value={path} />
          <label className="flex flex-col gap-1">
            <span className="text-sm font-medium text-mist-700 dark:text-mist-200">
              {t("settings.headscale.derp.mapsEditorLabel")}
            </span>
            <textarea
              className={EDITOR_CLASS}
              disabled={busy}
              name="content"
              onChange={(event) => setDraft(event.target.value)}
              spellCheck={false}
              value={draft}
            />
          </label>

          {draftTooLarge ? (
            <p className="text-xs text-red-600 dark:text-red-400">
              {t("settings.headscale.errors.derpMapTooLarge")}
            </p>
          ) : undefined}

          {reportedIssues.length > 0 ? (
            <ul className="flex flex-col gap-1 text-xs text-red-600 dark:text-red-400">
              {reportedIssues.map((issue, index) => (
                <li key={`${issue.code}-${index}`}>{issueText(issue)}</li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-emerald-600 dark:text-emerald-400">
              {t("settings.headscale.derp.mapsValid")}
            </p>
          )}

          {saveError ? (
            <RowError message={t(HEADSCALE_SETTINGS_ERROR_KEYS[saveError.code])} />
          ) : undefined}

          {saved && !saveError ? (
            <RowNote>
              {t("settings.headscale.derp.mapsSavedRestart")}{" "}
              {saved.snapshotTaken
                ? t("settings.headscale.derp.mapsSavedSnapshot", {
                    snapshot: saved.snapshotId ?? "",
                  })
                : t("settings.headscale.derp.mapsSavedNoSnapshot")}
            </RowNote>
          ) : undefined}

          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={saveBlocked} type="submit" variant="heavy">
              <Save className="size-4" />
              {t("settings.headscale.derp.mapsSave")}
            </Button>
            <Button onClick={() => setMode("closed")} type="button">
              <X className="size-4" />
              {t("settings.headscale.derp.mapsClose")}
            </Button>
          </div>
          <p className="text-xs text-mist-500 dark:text-mist-400">
            {t("settings.headscale.derp.mapsSaveNote")}
          </p>
        </saveFetcher.Form>
      ) : undefined}
    </div>
  );
}

function TemplateButton({
  id,
  locale,
  onPick,
}: {
  id: DerpMapTemplateId;
  locale: Locale;
  onPick: () => void;
}) {
  const { t } = useI18n();

  return (
    <div className="flex w-64 flex-col gap-1 rounded-md border border-mist-200 p-2 dark:border-mist-800">
      <span className="text-sm font-medium">{derpMapTemplateTitle(id, locale)}</span>
      <span className="flex-1 text-xs text-mist-500 dark:text-mist-400">
        {derpMapTemplateNote(id, locale)}
      </span>
      <Button onClick={onPick} type="button">
        <FileCode2 className="size-4" />
        {t("settings.headscale.derp.mapsTemplateUse")}
      </Button>
    </div>
  );
}

function StatusLine({ failures }: { failures: DerpMapCheck[] }) {
  const { t } = useI18n();

  if (failures.length === 0) {
    return (
      <span className="text-xs text-emerald-600 dark:text-emerald-400">
        {t("settings.headscale.derp.mapsStatusValid")}
      </span>
    );
  }

  return (
    <span
      className={cn(
        "text-xs",
        failures.some((check) => check.status === "fail")
          ? "text-red-600 dark:text-red-400"
          : "text-amber-700 dark:text-amber-400",
      )}
    >
      {failures.map((failure) => t(failure.bodyKey, failure.vars)).join(" · ")}
    </span>
  );
}

function RowError({ message }: { message: string }) {
  return (
    <p className="mx-2 mb-2 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
      {message}
    </p>
  );
}

function RowNote({ children }: { children: ReactNode }) {
  return (
    <p className="mx-2 mb-2 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-300">
      {children}
    </p>
  );
}

interface Token {
  kind: "comment" | "key" | "string" | "number" | "atom" | "plain";
  text: string;
}

const TOKEN_CLASS: Record<Token["kind"], string> = {
  comment: "text-mist-400 dark:text-mist-500",
  key: "text-indigo-600 dark:text-indigo-400",
  string: "text-emerald-600 dark:text-emerald-400",
  number: "text-amber-600 dark:text-amber-400",
  atom: "text-fuchsia-600 dark:text-fuchsia-400",
  plain: "",
};

/** Splits one line into the handful of pieces worth colouring. */
function tokenize(line: string): Token[] {
  const commentAt = findComment(line);
  const body = commentAt === -1 ? line : line.slice(0, commentAt);
  const comment = commentAt === -1 ? "" : line.slice(commentAt);
  const tokens: Token[] = [];
  const match = /^(\s*)(-\s+)?([^:]+):(\s*)(.*)$/.exec(body);

  if (match) {
    const [, indent, dash, key, gap, value] = match;
    tokens.push({ kind: "plain", text: `${indent}${dash ?? ""}` });
    tokens.push({ kind: "key", text: `${key}:` });
    if (gap.length > 0 || value.length > 0) {
      tokens.push({ kind: "plain", text: gap });
    }

    if (value.length > 0) {
      tokens.push(valueToken(value));
    }
  } else if (body.length > 0) {
    tokens.push(valueToken(body));
  }

  if (comment.length > 0) {
    tokens.push({ kind: "comment", text: comment });
  }

  return tokens;
}

function valueToken(value: string): Token {
  const trimmed = value.trim();
  if (/^".*"$/.test(trimmed) || /^'.*'$/.test(trimmed)) {
    return { kind: "string", text: value };
  }

  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return { kind: "number", text: value };
  }

  if (/^(true|false|null|~)$/.test(trimmed)) {
    return { kind: "atom", text: value };
  }

  return { kind: "plain", text: value };
}

/** Index of a `#` that starts a comment, ignoring anything inside quotes. */
function findComment(line: string): number {
  let quote: string | undefined;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (quote) {
      if (char === quote) {
        quote = undefined;
      }

      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === "#" && (index === 0 || /\s/.test(line[index - 1]))) {
      return index;
    }
  }

  return -1;
}

/** A read-only rendering with a line-number gutter and light YAML colouring. */
const YamlLines = memo(function YamlLines({ content }: { content: string }) {
  const lines = content.replace(/\n$/, "").split("\n");

  return (
    <div className="flex max-h-96 overflow-auto rounded-md border border-mist-200 bg-mist-50 dark:border-mist-800 dark:bg-mist-900">
      <pre
        aria-hidden
        className="shrink-0 border-r border-mist-200 px-2 py-3 text-right font-mono text-xs text-mist-400 select-none dark:border-mist-800 dark:text-mist-500"
      >
        {lines.map((_, index) => (
          <div key={index}>{index + 1}</div>
        ))}
      </pre>
      <pre className="min-w-0 flex-1 px-3 py-3 font-mono text-xs whitespace-pre-wrap">
        {lines.map((line, index) => (
          <div key={index}>
            {line.length === 0
              ? "\u00a0"
              : tokenize(line).map((token, tokenIndex) => (
                  <span className={TOKEN_CLASS[token.kind]} key={tokenIndex}>
                    {token.text}
                  </span>
                ))}
          </div>
        ))}
      </pre>
    </div>
  );
});
