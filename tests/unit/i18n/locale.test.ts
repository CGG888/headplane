import { describe, expect, test } from "vitest";

import { isLocale, negotiateLocale } from "~/utils/locale";

describe("negotiateLocale", () => {
  test("maps english tags", () => {
    expect(negotiateLocale("en-US,en;q=0.9")).toBe("en");
  });

  test("maps simplified chinese tags", () => {
    expect(negotiateLocale("zh-CN,zh;q=0.9")).toBe("zh-Hans");
    expect(negotiateLocale("zh")).toBe("zh-Hans");
    expect(negotiateLocale("zh-Hans")).toBe("zh-Hans");
  });

  test("maps traditional chinese tags", () => {
    expect(negotiateLocale("zh-TW")).toBe("zh-Hant");
    expect(negotiateLocale("zh-Hant")).toBe("zh-Hant");
    expect(negotiateLocale("zh-HK,zh;q=0.8")).toBe("zh-Hant");
    expect(negotiateLocale("zh-MO")).toBe("zh-Hant");
  });

  test("honours q-values", () => {
    expect(negotiateLocale("en;q=0.4,zh-Hant;q=0.9")).toBe("zh-Hant");
    expect(negotiateLocale("zh-Hant;q=0.2,en;q=0.8")).toBe("en");
  });

  test("skips unsupported tags in order", () => {
    expect(negotiateLocale("fr-FR,de;q=0.8,zh-Hans;q=0.5")).toBe("zh-Hans");
  });

  test("returns undefined when nothing matches", () => {
    expect(negotiateLocale("fr-FR,de;q=0.8")).toBeUndefined();
    expect(negotiateLocale(null)).toBeUndefined();
    expect(negotiateLocale("")).toBeUndefined();
    expect(negotiateLocale("en;q=0")).toBeUndefined();
  });
});

describe("isLocale", () => {
  test("accepts only supported locales", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("zh-Hans")).toBe(true);
    expect(isLocale("zh-Hant")).toBe(true);
    expect(isLocale("zh")).toBe(false);
    expect(isLocale("en-US")).toBe(false);
    expect(isLocale(null)).toBe(false);
  });
});
