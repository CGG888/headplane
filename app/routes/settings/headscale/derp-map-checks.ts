/**
 * The configuration checks behind every path in `derp.paths`.
 *
 * Pure, like the engine behind Settings → System: the loader probes the file and
 * validates its content, then hands plain values in and gets localized key
 * references out. A path the container cannot see at all is reported with the
 * same "cannot check this" wording the other configuration checks use, so a
 * missing bind mount never looks like a broken map.
 */

import type { TranslationKey } from "~/i18n";

import { MAX_DERP_MAP_BYTES } from "./derp-map-limits";
import type { DerpMapIssue } from "./derp-map-schema";

export type DerpMapCheckStatus = "pass" | "warning" | "fail";

export type DerpMapCheckId =
  | "exists"
  | "readable"
  | "writable"
  | "size"
  | "parses"
  | "schema"
  | "unique";

/** One verdict about one configured DERP map path. */
export interface DerpMapCheck {
  id: DerpMapCheckId;
  status: DerpMapCheckStatus;
  bodyKey: TranslationKey;
  vars?: Record<string, string | number>;
}

/** The plain values the checks read; the loader fills them from the filesystem. */
export interface DerpMapCheckInput {
  /** Only used by the "cannot check" wording, which names the path. */
  path: string;
  exists: boolean;
  isFile: boolean;
  readable: boolean;
  writable: boolean;
  tooLarge: boolean;
  unavailable: boolean;
  issues: readonly DerpMapIssue[];
}

/** Issue codes that are about duplication rather than about the shape itself. */
const UNIQUE_ISSUE_CODES = new Set(["derpRegionDuplicateId", "derpRegionDuplicateCode"]);

const PARSE_PREFIX = "settings.headscale.derp.mapChecks.";
const UNAVAILABLE_KEY: TranslationKey = "settings.system.configChecks.pathUnavailable";

/** Kept in KiB because that is how operators read file sizes. */
const MAX_KIB = Math.round(MAX_DERP_MAP_BYTES / 1024);

function check(
  id: DerpMapCheckId,
  status: DerpMapCheckStatus,
  body: string,
  vars?: Record<string, string | number>,
): DerpMapCheck {
  return { id, status, bodyKey: `${PARSE_PREFIX}${body}` as TranslationKey, vars };
}

/**
 * Every check for one configured path. `path` only appears in the messages, so
 * the engine stays a pure function of the probe results.
 */
export function computeDerpMapChecks(input: DerpMapCheckInput): DerpMapCheck[] {
  const schemaIssues = input.issues.filter((issue) => !UNIQUE_ISSUE_CODES.has(issue.code));
  const uniqueIssues = input.issues.filter((issue) => UNIQUE_ISSUE_CODES.has(issue.code));
  const syntax = input.issues.find((issue) => issue.code === "yamlSyntax");
  const structural = schemaIssues.find((issue) => issue.code !== "yamlSyntax");

  const checks: DerpMapCheck[] = [
    input.exists && input.isFile
      ? check("exists", "pass", "exists.pass")
      : input.exists
        ? check("exists", "fail", "exists.notFile")
        : check("exists", "warning", "exists.missing"),
    input.exists && input.isFile && input.readable
      ? check("readable", "pass", "readable.pass")
      : check("readable", input.exists ? "fail" : "warning", "readable.fail"),
    input.writable
      ? check("writable", "pass", "writable.pass")
      : check("writable", "warning", "writable.fail"),
    input.tooLarge
      ? check("size", "warning", "size.fail", { limit: MAX_KIB })
      : check("size", "pass", "size.pass", { limit: MAX_KIB }),
    syntax
      ? check("parses", "fail", "parses.fail", positionVars(syntax))
      : check("parses", "pass", "parses.pass"),
    structural
      ? check("schema", "fail", "schema.fail", positionVars(structural))
      : check("schema", "pass", "schema.pass"),
    uniqueIssues.length > 0
      ? check("unique", "fail", "unique.fail", positionVars(uniqueIssues[0]))
      : check("unique", "pass", "unique.pass"),
  ];

  // A path whose whole tree is invisible (a container without that mount) cannot
  // be judged at all: keep the shape of the list but report the existing
  // "cannot check" wording for everything that did not pass.
  if (!input.unavailable) {
    return checks;
  }

  return checks.map((entry) =>
    entry.status === "pass"
      ? entry
      : { ...entry, status: "warning", bodyKey: UNAVAILABLE_KEY, vars: { path: input.path } },
  );
}

/** `{line}`/`{column}` for the localized "at line X, column Y" suffix. */
function positionVars(issue: DerpMapIssue): Record<string, string | number> | undefined {
  if (issue.line === undefined) {
    return undefined;
  }

  return { line: issue.line, column: issue.column ?? 1 };
}
