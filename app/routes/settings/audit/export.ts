import { data } from "react-router";

import { AUDIT_EXPORT_LIMIT } from "~/server/audit/constants";
import { auditContext, authContext } from "~/server/context";
import { Capabilities } from "~/server/web/roles";
import { getLocale } from "~/utils/locale";

import type { Route } from "./+types/export";
import {
  auditExportContentType,
  auditExportFilename,
  auditExportHeader,
  isAuditExportFormat,
  toAuditCsv,
  toAuditJson,
} from "./export-format";
import { auditRangeSince, parseAuditFilters } from "./filters";

/**
 * Resource route that writes the current audit selection out as a file. It sits
 * outside the application layout, like the snapshot download, so a download
 * never renders the UI around it.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const auth = context.get(authContext);
  const audit = context.get(auditContext);

  const principal = await auth.require(request);
  if (!auth.can(principal, Capabilities.configure_iam)) {
    throw data({ localized: { key: "errors.permission.viewIam" } }, { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const format = params.get("format") ?? "csv";
  if (!isAuditExportFormat(format)) {
    throw data({ localized: { key: "errors.generic.requestFailed" } }, { status: 400 });
  }

  // The page's filters decide the selection; the page cursor does not, so an
  // export always covers the whole selection, newest first.
  const filters = parseAuditFilters(params);
  const { entries, total } = await audit.list({
    actor: filters.actor || undefined,
    action: filters.action || undefined,
    since: auditRangeSince(filters.range),
    limit: AUDIT_EXPORT_LIMIT,
    offset: 0,
  });

  const locale = await getLocale(request);
  const body =
    format === "csv" ? toAuditCsv(entries, auditExportHeader(locale)) : toAuditJson(entries);

  const headers = new Headers({
    "Content-Type": auditExportContentType(format),
    "Content-Disposition": `attachment; filename="${auditExportFilename(format, new Date())}"`,
    "Cache-Control": "no-store",
  });

  // A downloaded file cannot explain itself, so a capped export is flagged for
  // the browser and for whatever the file is fed into.
  if (total > entries.length) {
    headers.set("X-Audit-Export-Truncated", "true");
    headers.set("X-Audit-Export-Total", String(total));
  }

  return new Response(body, { headers });
}
