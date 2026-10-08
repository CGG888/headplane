import { describe, expect, test } from "vitest";

import { FLAG_URLS } from "~/assets/flags";
import { CHINESE_REGION_NAMES } from "~/server/derp-mirror/names";
import {
  REGION_COUNTRY_CODES,
  regionCountryCode,
  regionCountryFromName,
} from "~/utils/region-country";

describe("the region country table", () => {
  test("every region code resolves to a country, and every country ships a flag", () => {
    // The two halves of the feature have to agree: a code whose country has no
    // asset would render nothing, and an asset no code reaches is dead weight.
    const unresolvable = Object.entries(REGION_COUNTRY_CODES)
      .filter(([, country]) => FLAG_URLS[country.toLowerCase()] === undefined)
      .map(([code, country]) => `${code} -> ${country}`);

    const malformed = Object.entries(REGION_COUNTRY_CODES)
      .filter(([, country]) => !/^[A-Z]{2}$/.test(country))
      .map(([code, country]) => `${code} -> ${country}`);

    expect({ malformed, unresolvable }).toEqual({ malformed: [], unresolvable: [] });
  });

  test("every region the mirror names resolves to a country", () => {
    const missing = Object.keys(CHINESE_REGION_NAMES).filter(
      (code) => regionCountryCode({ code }) === undefined,
    );

    expect(missing).toEqual([]);
  });
});

describe("the country of one region", () => {
  test("the code decides, and it is read case-insensitively", () => {
    expect(regionCountryCode({ code: "hkg" })).toBe("HK");
    expect(regionCountryCode({ code: " FRA " })).toBe("DE");
    expect(regionCountryCode({ code: "New" })).toBeUndefined();
  });

  test("the code wins over a name that disagrees", () => {
    expect(regionCountryCode({ code: "hkg", name: "东京" })).toBe("HK");
  });

  test("the mirrored Chinese name resolves when no code is at hand", () => {
    expect(regionCountryCode({ name: "香港" })).toBe("HK");
    expect(regionCountryCode({ name: "东京" })).toBe("JP");
    expect(regionCountryCode({ name: "法兰克福" })).toBe("DE");
    expect(regionCountryCode({ name: "圣保罗" })).toBe("BR");
  });

  test("an operator's own Chinese wording still resolves", () => {
    // A hand-typed mapping is whatever the operator wrote; the city name inside
    // is what carries the country, so a longer name keeps its flag.
    expect(regionCountryCode({ name: "中国香港" })).toBe("HK");
    expect(regionCountryCode({ name: "广东东莞" })).toBe("CN");
    expect(regionCountryCode({ name: "东京 机房" })).toBe("JP");
  });

  test("an official English name resolves, diacritics and all", () => {
    expect(regionCountryCode({ name: "São Paulo" })).toBe("BR");
    expect(regionCountryCode({ name: "Frankfurt" })).toBe("DE");
    expect(regionCountryCode({ name: "Hong Kong" })).toBe("HK");
  });

  test("an English name matches whole, never as a substring", () => {
    // `New York` contains `York`; reading the shorter name as a country would
    // put a flag on a city that is not in it.
    expect(regionCountryFromName("York")).toBeUndefined();
    expect(regionCountryFromName("New York")).toBe("US");
  });

  test("a surface that only kept the region's code still resolves it", () => {
    // Some rows print the map's own code as the name (`hkg`), so a three-letter
    // token reads as a code before the lookup gives up.
    expect(regionCountryFromName("hkg")).toBe("HK");
    expect(regionCountryFromName(" HKG ")).toBe("HK");
    expect(regionCountryFromName("zzz")).toBeUndefined();
  });

  test("an unknown region resolves to nothing rather than to a guess", () => {
    expect(regionCountryCode({})).toBeUndefined();
    expect(regionCountryCode({ code: "", name: "   " })).toBeUndefined();
    expect(regionCountryCode({ name: "Atlantis" })).toBeUndefined();
    expect(regionCountryCode({ code: "qqq", name: "Nowhere" })).toBeUndefined();
  });
});
