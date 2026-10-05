import { describe, expect, test, vi } from "vitest";

vi.mock("~/utils/log", () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import {
  AUDIT_EXPORT_COLUMNS,
  auditExportFilename,
  auditExportHeader,
  auditExportRecord,
  escapeCsvField,
  toAuditCsv,
  toAuditJson,
} from "~/routes/settings/audit/export-format";
import {
  auditExportHref,
  auditRangeSince,
  parseAuditFilters,
} from "~/routes/settings/audit/filters";
import { AUDIT_ACTIONS } from "~/server/audit/actions";
import { AUDIT_EXPORT_LIMIT } from "~/server/audit/constants";
import type { AuditEntry, AuditQuery } from "~/server/audit/types";
import { auditContext, authContext } from "~/server/context";

const AT = new Date("2026-01-01T12:00:00.000Z");

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: "01J0000000000000000000000",
    at: AT,
    actor: "alice",
    actorType: "user",
    action: AUDIT_ACTIONS.apiKeyCreate,
    target: "hskey-api-abcdefghijkl",
    detail: null,
    result: "success",
    ...overrides,
  };
}

interface ExportOptions {
  allowed?: boolean;
  entries?: AuditEntry[];
  total?: number;
  headers?: Record<string, string>;
}

interface ThrownResult {
  data?: { localized?: { key: string } };
  init?: { status?: number } | null;
}

interface ExportCall {
  response?: Response;
  thrown?: ThrownResult;
  list: ReturnType<typeof vi.fn<(query: AuditQuery) => Promise<unknown>>>;
}

async function callExport(url: string, options: ExportOptions = {}): Promise<ExportCall> {
  const { loader } = await import("~/routes/settings/audit/export");

  const entries = options.entries ?? [];
  const list = vi.fn(async (_query: AuditQuery) => ({
    entries,
    total: options.total ?? entries.length,
  }));

  const context = {
    get: (key: unknown) => {
      if (key === authContext) {
        return {
          require: () => Promise.resolve({ kind: "oidc", profile: { name: "Alice" } }),
          can: () => options.allowed ?? true,
        };
      }

      if (key === auditContext) {
        return { list };
      }

      return undefined;
    },
  };

  try {
    const response = (await loader({
      request: new Request(url, { headers: options.headers }),
      context,
      params: {},
    } as never)) as Response;
    return { response, list };
  } catch (thrown) {
    return { thrown: thrown as ThrownResult, list };
  }
}

function exportUrl(query = ""): string {
  return `http://localhost/settings/audit/export${query}`;
}

describe("csv escaping", () => {
  test("quotes and doubles a value holding a quote, a comma and a newline", () => {
    expect(escapeCsvField('He said "hi", then\nleft')).toBe('"He said ""hi"", then\nleft"');
    expect(escapeCsvField("carriage\rreturn")).toBe('"carriage\rreturn"');
    expect(escapeCsvField("just, commas")).toBe('"just, commas"');
  });

  test("leaves an ordinary value untouched", () => {
    expect(escapeCsvField("alice")).toBe("alice");
    expect(escapeCsvField("")).toBe("");
    expect(escapeCsvField("semi;colon")).toBe("semi;colon");
  });

  test("writes rows in column order with CRLF endings", () => {
    const csv = toAuditCsv([entry({ detail: "note" })], [...AUDIT_EXPORT_COLUMNS]);

    expect(csv).toBe(
      "time,actor,actorType,action,result,target,detail\r\n" +
        "2026-01-01T12:00:00.000Z,alice,user,api_key.create,success,hskey-api-abcdefghijkl,note\r\n",
    );
  });

  test("the header row is translated for every locale, never a raw key", () => {
    for (const locale of ["en", "zh-Hans", "zh-Hant"] as const) {
      const header = auditExportHeader(locale);
      expect(header, locale).toHaveLength(AUDIT_EXPORT_COLUMNS.length);
      for (const label of header) {
        expect(label.startsWith("settings."), locale).toBe(false);
      }
    }
  });
});

describe("json export", () => {
  test("is an array of the same records with ISO timestamps", () => {
    const records = [entry({ detail: "note" }), entry({ id: "second", result: "failure" })];
    const parsed = JSON.parse(toAuditJson(records)) as Array<Record<string, unknown>>;

    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toEqual(records.map((record) => auditExportRecord(record)));
    expect(parsed[0]?.at).toBe("2026-01-01T12:00:00.000Z");
    expect(parsed[0]?.detail).toBe("note");
    expect(parsed[1]?.detail).toBeNull();
  });
});

describe("audit export route", () => {
  test("returns a CSV attachment named after the timestamp", async () => {
    const { response } = await callExport(exportUrl("?format=csv"), {
      entries: [entry({ detail: 'a "quoted", comma\nand newline' })],
    });

    expect(response?.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
    expect(response?.headers.get("Content-Disposition")).toMatch(
      /^attachment; filename="headplane-audit-\d{8}-\d{6}\.csv"$/,
    );

    const lines = (await response?.text())?.split("\r\n") ?? [];
    expect(lines[0]).toBe("Time,Actor,Actor type,Action,Result,Target,Detail");
    expect(lines[1]).toBe(
      '2026-01-01T12:00:00.000Z,alice,user,api_key.create,success,hskey-api-abcdefghijkl,"a ""quoted"", comma\nand newline"',
    );
  });

  test("defaults to CSV and rejects an unknown format", async () => {
    const { response } = await callExport(exportUrl(), { entries: [] });
    expect(response?.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");

    const { thrown, list } = await callExport(exportUrl("?format=xlsx"));
    expect(thrown?.init?.status).toBe(400);
    expect(thrown?.data?.localized?.key).toBe("errors.generic.requestFailed");
    expect(list).not.toHaveBeenCalled();
  });

  test("returns a JSON attachment in the requested format", async () => {
    const { response } = await callExport(exportUrl("?format=json"), { entries: [entry()] });

    expect(response?.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(response?.headers.get("Content-Disposition")).toMatch(
      /^attachment; filename="headplane-audit-\d{8}-\d{6}\.json"$/,
    );
    expect(JSON.parse((await response?.text()) ?? "null")).toEqual([auditExportRecord(entry())]);
  });

  test("localizes the header row from the request locale", async () => {
    const hant = await callExport(exportUrl("?format=csv"), {
      entries: [],
      headers: { "Accept-Language": "zh-Hant" },
    });
    const hans = await callExport(exportUrl("?format=csv"), {
      entries: [],
      headers: { "Accept-Language": "zh-Hans" },
    });

    expect((await hant.response?.text())?.split("\r\n")[0]).toBe(
      "時間,操作者,操作者類型,操作,結果,目標,詳情",
    );
    expect((await hans.response?.text())?.split("\r\n")[0]).toBe(
      "时间,操作者,操作者类型,操作,结果,目标,详情",
    );
  });

  test("caps the export at the newest rows and flags the truncation", async () => {
    const entries = Array.from({ length: AUDIT_EXPORT_LIMIT }, (_, index) =>
      entry({ id: `id-${index}` }),
    );
    const { response, list } = await callExport(exportUrl("?format=csv&page=4"), {
      entries,
      total: AUDIT_EXPORT_LIMIT + 12,
    });

    expect(AUDIT_EXPORT_LIMIT).toBe(5000);
    expect(list.mock.calls[0]?.[0]).toMatchObject({ limit: AUDIT_EXPORT_LIMIT, offset: 0 });
    expect(response?.headers.get("X-Audit-Export-Truncated")).toBe("true");
    expect(response?.headers.get("X-Audit-Export-Total")).toBe(String(AUDIT_EXPORT_LIMIT + 12));

    const rows = (await response?.text())?.split("\r\n").filter((row) => row.length > 0) ?? [];
    expect(rows).toHaveLength(AUDIT_EXPORT_LIMIT + 1);
  });

  test("does not flag an export that fits under the cap", async () => {
    const { response } = await callExport(exportUrl("?format=json"), { entries: [entry()] });

    expect(response?.headers.get("X-Audit-Export-Truncated")).toBeNull();
    expect(response?.headers.get("X-Audit-Export-Total")).toBeNull();
  });

  test("uses the page's filter semantics and ignores the page cursor", async () => {
    const url = exportUrl("?format=csv&actor=%20alice%20&action=api_key.create&range=7d&page=9");
    const { list } = await callExport(url, { entries: [] });
    const query = list.mock.calls[0]?.[0];
    const filters = parseAuditFilters(new URL(url).searchParams);

    expect(query).toMatchObject({ actor: "alice", action: "api_key.create", offset: 0 });
    expect(query?.actor).toBe(filters.actor);
    expect(query?.action).toBe(filters.action);

    const expected = auditRangeSince(filters.range)?.getTime() ?? 0;
    expect(Math.abs((query?.since?.getTime() ?? 0) - expected)).toBeLessThan(5000);
  });

  test("falls back to all time for an unknown range, like the page", async () => {
    const url = exportUrl("?format=csv&range=99d");
    const { list } = await callExport(url, { entries: [] });

    expect(parseAuditFilters(new URL(url).searchParams).range).toBe("all");
    expect(list.mock.calls[0]?.[0]?.since).toBeUndefined();
  });

  test("refuses to export without the IAM capability", async () => {
    const { thrown, list } = await callExport(exportUrl("?format=csv"), { allowed: false });

    expect(thrown?.init?.status).toBe(403);
    expect(thrown?.data?.localized?.key).toBe("errors.permission.viewIam");
    expect(list).not.toHaveBeenCalled();
  });
});

describe("export links", () => {
  test("keep the active filters and drop the page cursor", () => {
    expect(auditExportHref({ actor: "alice", action: "x y", range: "7d", page: 3 }, "csv")).toBe(
      "/settings/audit/export?actor=alice&action=x+y&range=7d&format=csv",
    );
    expect(auditExportHref({ range: "all" }, "json")).toBe("/settings/audit/export?format=json");
  });
});

describe("export filename", () => {
  test("stamps the download in UTC", () => {
    expect(auditExportFilename("json", new Date("2026-10-05T14:52:19.123Z"))).toBe(
      "headplane-audit-20261005-145219.json",
    );
  });
});
