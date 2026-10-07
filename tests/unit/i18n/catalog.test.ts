import { describe, expect, test } from "vitest";

import { isPlural, translate, translateRich } from "~/i18n";
import en from "~/i18n/locales/en";
import zhHans from "~/i18n/locales/zh-Hans";
import zhHant from "~/i18n/locales/zh-Hant";

const catalogs = {
  en,
  "zh-Hans": zhHans,
  "zh-Hant": zhHant,
};

function flatten(value: unknown, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof value === "string") {
    out.set(prefix, value);
    return out;
  }

  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    for (const [nested, text] of flatten(child, prefix ? `${prefix}.${key}` : key)) {
      out.set(nested, text);
    }
  }

  return out;
}

function placeholders(value: string): string[] {
  return [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
}

const flatEn = flatten(en);

describe("i18n catalogs", () => {
  test("every locale defines exactly the english key space", () => {
    for (const [locale, catalog] of Object.entries(catalogs)) {
      expect([...flatten(catalog).keys()].sort(), locale).toEqual([...flatEn.keys()].sort());
    }
  });

  test("no translation is empty", () => {
    for (const [locale, catalog] of Object.entries(catalogs)) {
      for (const [key, value] of flatten(catalog)) {
        expect(value.trim(), `${locale}:${key}`).not.toBe("");
      }
    }
  });

  test("placeholder sets match english so interpolation never breaks", () => {
    for (const [locale, catalog] of Object.entries(catalogs)) {
      for (const [key, value] of flatten(catalog)) {
        expect(placeholders(value), `${locale}:${key}`).toEqual(
          placeholders(flatEn.get(key) ?? ""),
        );
      }
    }
  });

  test("traditional chinese does not contain simplified-only characters", () => {
    // Characters whose traditional form differs, plus the language name key
    // that intentionally renders as 简体中文 in every locale.
    const simplifiedOnly =
      "设备网权确认删关闭语务称间签标组键钥证验连线节点机录过页据库辑丢弃选择请响应错误时门开长个们为会后从说话让记训试询调转载输频简单体汉统计议许览显习临";
    const exempt = new Set(["language.zh-Hans"]);

    for (const [key, value] of flatten(zhHant)) {
      if (exempt.has(key)) {
        continue;
      }

      const found = [...value].filter((char) => simplifiedOnly.includes(char));
      expect(found, `zh-Hant:${key} -> ${value}`).toEqual([]);
    }
  });

  test("chinese catalogs are actually localized", () => {
    // Guards against shipping a locale whose strings were never translated.
    // Brand names, code tokens and placeholders legitimately stay in ASCII, so
    // this only asserts that the bulk of each catalog is Chinese.
    const cjk = /[\u4e00-\u9fff]/;
    for (const [locale, catalog] of Object.entries({ "zh-Hans": zhHans, "zh-Hant": zhHant })) {
      const entries = [...flatten(catalog)];
      const localized = entries.filter(([, value]) => cjk.test(value)).length;
      expect(localized / entries.length, locale).toBeGreaterThan(0.8);
    }
  });
});

describe("translate", () => {
  test("interpolates variables in the requested locale", () => {
    expect(translate("en", "pages.unavailableTitle", { page: "DNS" })).toBe("DNS Unavailable");
    expect(translate("zh-Hans", "pages.unavailableTitle", { page: "DNS" })).toBe("DNS 不可用");
    expect(translate("zh-Hant", "pages.unavailableTitle", { page: "DNS" })).toBe("DNS 無法使用");
  });

  test("keeps unknown placeholders untouched", () => {
    expect(translate("en", "pages.unavailableTitle")).toBe("{page} Unavailable");
  });

  test("returns the key when it cannot be resolved", () => {
    expect(translate("en", "does.not.exist" as never)).toBe("does.not.exist");
  });

  test("only treats an entry with two string forms as plural", () => {
    expect(isPlural({ one: "1 node", other: "{count} nodes" })).toBe(true);
    // A half-filled entry must not be rendered: `other` would be `undefined`.
    expect(isPlural({ one: "1 node" })).toBe(false);
    expect(isPlural({ one: "1 node", other: ["{count} nodes"] })).toBe(false);
    expect(isPlural({ other: "{count} nodes" })).toBe(false);
    expect(isPlural("1 node")).toBe(false);
    expect(isPlural(null)).toBe(false);
  });
});

describe("translateRich", () => {
  test("interpolates nodes into the sentence", () => {
    const nodes = translateRich("en", "footer.about", {
      upstream: "UPSTREAM",
      fork: "FORK",
    });
    const text = JSON.stringify(nodes);

    expect(Array.isArray(nodes)).toBe(true);
    expect(text).toContain("UPSTREAM");
    expect(text).toContain("FORK");
  });

  test("keeps the surrounding text of every locale", () => {
    for (const locale of ["en", "zh-Hans", "zh-Hant"] as const) {
      const nodes = translateRich(locale, "footer.about", {
        upstream: "U",
        fork: "F",
      });
      const text = JSON.stringify(nodes);

      expect(text, locale).toContain("U");
      expect(text, locale).toContain("F");
    }
  });
});
