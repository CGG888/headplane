// MARK: Which country a DERP region belongs to
//
// Every surface that names a relay region (the machine card, the machine list,
// the settings status table, the mirror cards) wants the same small flag next to
// the name. The region data itself never says which country a region is in: the
// official map names regions after their city (`Tokyo`, `Hong Kong`) and codes
// them with the airport-style code (`tok`, `hkg`), and Headplane's own Chinese
// table (`~/server/derp-mirror/names`) translates those names without adding a
// country.
//
// So the country is derived, in this order:
//
//   1. the region code, which is stable per city and is what every region row
//      carries anyway (see `CHINESE_REGION_NAMES` for why the code, not the id);
//   2. the name the operator sees — Chinese first (the mirrored map writes
//      Chinese names), then the official English name a non-mirrored region or a
//      hand-typed mapping still carries;
//   3. nothing. An unknown city renders without a flag rather than with a wrong
//      one: a flag is an assertion, and a guess about a country is worse than no
//      flag at all.
//
// Nothing here talks to the network and nothing here is stored: the table is a
// compile-time constant, so the flag can be rendered on the server and in the
// browser from the same data.

import { CHINESE_REGION_NAMES } from "~/server/derp-mirror/names";

/**
 * Official region code (lowercase) -> ISO 3166-1 alpha-2 country code. The keys
 * are the codes the official DERP map uses; the flag assets in
 * `~/assets/flags` are exactly the values used here.
 */
export const REGION_COUNTRY_CODES: Record<string, string> = {
  // Greater China and nearby
  hkg: "HK",
  tpe: "TW",
  mnl: "PH",
  sin: "SG",
  kul: "MY",
  cgk: "ID",

  // Japan and Korea
  tok: "JP",
  hnd: "JP",
  nrt: "JP",
  kix: "JP",
  osk: "JP",
  osa: "JP",
  icn: "KR",
  sel: "KR",

  // South and Southeast Asia
  bom: "IN",
  blr: "IN",
  maa: "IN",
  del: "IN",
  ccu: "IN",

  // North America
  nyc: "US",
  iad: "US",
  bos: "US",
  atl: "US",
  mia: "US",
  ord: "US",
  dal: "US",
  dfw: "US",
  den: "US",
  sea: "US",
  sfo: "US",
  lax: "US",
  hnl: "US",
  gdl: "MX",
  mex: "MX",
  yyz: "CA",
  tor: "CA",
  yul: "CA",

  // South America
  gru: "BR",
  sao: "BR",
  eze: "AR",
  scl: "CL",
  lim: "PE",
  bog: "CO",

  // Europe
  lhr: "GB",
  man: "GB",
  gla: "GB",
  dub: "IE",
  ams: "NL",
  bru: "BE",
  par: "FR",
  cdg: "FR",
  fra: "DE",
  nue: "DE",
  ber: "DE",
  mad: "ES",
  bcn: "ES",
  lis: "PT",
  mil: "IT",
  zrh: "CH",
  gva: "CH",
  vie: "AT",
  prg: "CZ",
  bud: "HU",
  waw: "PL",
  sto: "SE",
  arn: "SE",
  osl: "NO",
  cph: "DK",
  hel: "FI",
  tal: "EE",
  rix: "LV",
  sof: "BG",
  otp: "RO",
  kiv: "MD",

  // Middle East, Africa, Oceania and Russia
  ist: "TR",
  tlv: "IL",
  dxb: "AE",
  dbi: "AE",
  ruh: "SA",
  jed: "SA",
  doh: "QA",
  mct: "OM",
  jnb: "ZA",
  cpt: "ZA",
  nbo: "KE",
  nai: "KE",
  los: "NG",
  syd: "AU",
  mel: "AU",
  bne: "AU",
  per: "AU",
  adl: "AU",
  akl: "NZ",
  dme: "RU",
  led: "RU",
  svx: "RU",
  kja: "RU",
  oms: "RU",
  ala: "KZ",
  tse: "KZ",
  bak: "AZ",
  tbs: "GE",
  evn: "AM",
};

/**
 * Self-hosted regions do not come from the official map at all, so the operator
 * names them by hand — usually in Chinese, and usually after the city the relay
 * sits in. These are the names a hand-written region is likely to carry; a name
 * the table does not know simply renders without a flag.
 */
const CHINESE_COUNTRY_NAMES: Record<string, string> = {
  北京: "CN",
  上海: "CN",
  广州: "CN",
  深圳: "CN",
  东莞: "CN",
  广东: "CN",
  杭州: "CN",
  成都: "CN",
  重庆: "CN",
  武汉: "CN",
  西安: "CN",
  南京: "CN",
  苏州: "CN",
  青岛: "CN",
  厦门: "CN",
  长沙: "CN",
  郑州: "CN",
  天津: "CN",
  香港: "HK",
  澳门: "MO",
  台北: "TW",
  台中: "TW",
  高雄: "TW",
};

/**
 * The official map's own names, normalized: lowercase, no diacritics, single
 * spaces. Only cities whose flag the repository ships appear here, and a name is
 * matched whole — never as a substring, so `New York` cannot match `York`.
 */
const OFFICIAL_COUNTRY_NAMES: Record<string, string> = {
  "new york": "US",
  "new york city": "US",
  "san francisco": "US",
  seattle: "US",
  "los angeles": "US",
  chicago: "US",
  dallas: "US",
  denver: "US",
  miami: "US",
  atlanta: "US",
  washington: "US",
  "washington dc": "US",
  boston: "US",
  honolulu: "US",
  toronto: "CA",
  montreal: "CA",
  "mexico city": "MX",
  guadalajara: "MX",
  "sao paulo": "BR",
  "buenos aires": "AR",
  santiago: "CL",
  lima: "PE",
  bogota: "CO",
  london: "GB",
  manchester: "GB",
  glasgow: "GB",
  dublin: "IE",
  amsterdam: "NL",
  brussels: "BE",
  paris: "FR",
  frankfurt: "DE",
  nuremberg: "DE",
  berlin: "DE",
  madrid: "ES",
  barcelona: "ES",
  lisbon: "PT",
  milan: "IT",
  zurich: "CH",
  geneva: "CH",
  vienna: "AT",
  prague: "CZ",
  budapest: "HU",
  warsaw: "PL",
  stockholm: "SE",
  oslo: "NO",
  copenhagen: "DK",
  helsinki: "FI",
  tallinn: "EE",
  riga: "LV",
  sofia: "BG",
  bucharest: "RO",
  chisinau: "MD",
  istanbul: "TR",
  "tel aviv": "IL",
  dubai: "AE",
  riyadh: "SA",
  jeddah: "SA",
  doha: "QA",
  muscat: "OM",
  johannesburg: "ZA",
  "cape town": "ZA",
  nairobi: "KE",
  lagos: "NG",
  sydney: "AU",
  melbourne: "AU",
  brisbane: "AU",
  perth: "AU",
  adelaide: "AU",
  auckland: "NZ",
  moscow: "RU",
  "saint petersburg": "RU",
  "st petersburg": "RU",
  yekaterinburg: "RU",
  krasnoyarsk: "RU",
  omsk: "RU",
  almaty: "KZ",
  astana: "KZ",
  baku: "AZ",
  tbilisi: "GE",
  yerevan: "AM",
  tokyo: "JP",
  osaka: "JP",
  seoul: "KR",
  mumbai: "IN",
  bangalore: "IN",
  bengaluru: "IN",
  chennai: "IN",
  delhi: "IN",
  "new delhi": "IN",
  kolkata: "IN",
  singapore: "SG",
  "hong kong": "HK",
  taipei: "TW",
  manila: "PH",
  "kuala lumpur": "MY",
  jakarta: "ID",
  beijing: "CN",
  shanghai: "CN",
  shenzhen: "CN",
  guangzhou: "CN",
  dongguan: "CN",
  hangzhou: "CN",
  chengdu: "CN",
  chongqing: "CN",
  wuhan: "CN",
  xian: "CN",
};

/**
 * The Chinese name the mirror writes for one official code (for example `东京`),
 * mapped to the code's country. It is built once from `CHINESE_REGION_NAMES` and
 * the table above, so a code added there picks up its flag without a second
 * entry: several codes can share a name (`tok`, `hnd` and `nrt` are all `东京`),
 * and the first one wins because they agree.
 */
const CHINESE_COUNTRY_NAME_BY_CODE: Record<string, string> = (() => {
  const byName: Record<string, string> = {};
  for (const [code, name] of Object.entries(CHINESE_REGION_NAMES)) {
    const country = REGION_COUNTRY_CODES[code];
    if (country !== undefined && byName[name] === undefined) {
      byName[name] = country;
    }
  }
  return byName;
})();

/** Lowercase, no diacritics, single spaces: the form both name tables use. */
function normalizeRegionName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The country a region *name* names, or `undefined` when no table knows it.
 * Chinese names match as substrings — an operator's `广东东莞` still resolves —
 * while English names must match whole to keep `York` from becoming `New York`.
 *
 * A name may also just be the region's code: a surface that falls back to the
 * map's own code (`hkg`) passes it as the name, so a three-letter token is read
 * as a code before giving up.
 */
export function regionCountryFromName(name: string | undefined): string | undefined {
  const trimmed = name?.trim();
  if (trimmed === undefined || trimmed === "") {
    return undefined;
  }

  const chinese = CHINESE_COUNTRY_NAME_BY_CODE[trimmed] ?? CHINESE_COUNTRY_NAMES[trimmed];
  if (chinese !== undefined) {
    return chinese;
  }
  for (const [candidate, country] of Object.entries(CHINESE_COUNTRY_NAMES)) {
    if (trimmed.includes(candidate)) {
      return country;
    }
  }
  for (const [candidate, country] of Object.entries(CHINESE_COUNTRY_NAME_BY_CODE)) {
    if (trimmed.includes(candidate)) {
      return country;
    }
  }

  const normalized = normalizeRegionName(trimmed);
  const official = OFFICIAL_COUNTRY_NAMES[normalized];
  if (official !== undefined) {
    return official;
  }

  return normalized.length === 3 ? REGION_COUNTRY_CODES[normalized] : undefined;
}

/**
 * The country of one region: its code first (exact and stable), then the name it
 * is shown under. Both inputs are optional because different surfaces hold
 * different halves of a region — the mirror table has a code and a Chinese name,
 * a hand-typed mapping may only have a name.
 */
export function regionCountryCode(region: {
  code?: string | undefined;
  name?: string | undefined;
}): string | undefined {
  const code = region.code?.trim().toLowerCase();
  if (code !== undefined && code !== "") {
    const country = REGION_COUNTRY_CODES[code];
    if (country !== undefined) {
      return country;
    }
  }

  return regionCountryFromName(region.name);
}
