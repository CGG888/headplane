/**
 * Starting points for a new local DERP map file (`derp.paths`).
 *
 * Every template is a real file Headscale can load: the tests feed each one back
 * through `validateDerpMap`, so a template can never teach a shape the save
 * button then rejects. The comments are generated in the caller's language and
 * explain every field a region and a node carry, because the file lands on the
 * Headscale host where nobody is holding this documentation.
 */

import { translate, type TranslationKey } from "~/i18n";
import type { Locale } from "~/utils/locale";

export type DerpMapTemplateId = "one-region" | "two-regions" | "skeleton";

/** The templates the editor offers, in the order it lists them. */
export const DERP_MAP_TEMPLATE_IDS: readonly DerpMapTemplateId[] = [
  "one-region",
  "two-regions",
  "skeleton",
];

const TITLE_KEYS: Record<DerpMapTemplateId, TranslationKey> = {
  "one-region": "settings.headscale.derp.mapTemplates.titleOneRegion",
  "two-regions": "settings.headscale.derp.mapTemplates.titleTwoRegions",
  skeleton: "settings.headscale.derp.mapTemplates.titleSkeleton",
};

/** One-line summary shown under each template button. */
const NOTE_KEYS: Record<DerpMapTemplateId, TranslationKey> = {
  "one-region": "settings.headscale.derp.mapTemplates.noteOneRegion",
  "two-regions": "settings.headscale.derp.mapTemplates.noteTwoRegions",
  skeleton: "settings.headscale.derp.mapTemplates.noteSkeleton",
};

/**
 * The field reference every template carries. Kept as single-line catalog
 * entries and turned into `#` comments here, so a translation can never break
 * the YAML it explains.
 */
const FIELD_KEYS: readonly TranslationKey[] = [
  "settings.headscale.derp.mapTemplates.fields.regionKey",
  "settings.headscale.derp.mapTemplates.fields.regionId",
  "settings.headscale.derp.mapTemplates.fields.regionCode",
  "settings.headscale.derp.mapTemplates.fields.regionName",
  "settings.headscale.derp.mapTemplates.fields.nodeName",
  "settings.headscale.derp.mapTemplates.fields.hostname",
  "settings.headscale.derp.mapTemplates.fields.derpPort",
  "settings.headscale.derp.mapTemplates.fields.stunPort",
  "settings.headscale.derp.mapTemplates.fields.stunOnly",
  "settings.headscale.derp.mapTemplates.fields.ipv4",
  "settings.headscale.derp.mapTemplates.fields.ipv6",
  "settings.headscale.derp.mapTemplates.fields.resolve",
  "settings.headscale.derp.mapTemplates.fields.ports",
  "settings.headscale.derp.mapTemplates.fields.reload",
];

export function derpMapTemplateTitle(id: DerpMapTemplateId, locale: Locale): string {
  return translate(locale, TITLE_KEYS[id]);
}

export function derpMapTemplateNote(id: DerpMapTemplateId, locale: Locale): string {
  return translate(locale, NOTE_KEYS[id]);
}

/** A `#` comment line per catalog entry. */
function fieldComments(locale: Locale): string[] {
  return FIELD_KEYS.map((key) => `# ${translate(locale, key)}`);
}

function header(id: DerpMapTemplateId, locale: Locale): string[] {
  return [`# ${derpMapTemplateTitle(id, locale)}`, `# ${derpMapTemplateNote(id, locale)}`, "#"];
}

/**
 * One region with one relay node: the smallest map Headscale accepts, and the
 * shape most operators start from.
 */
function oneRegion(locale: Locale): string {
  return [
    ...header("one-region", locale),
    ...fieldComments(locale),
    "",
    "regions:",
    "  901:",
    "    regionid: 901",
    "    regioncode: ams",
    '    regionname: "Amsterdam"',
    "    nodes:",
    '      - name: "901a"',
    "        regionid: 901",
    "        hostname: derp.example.com",
    "        derpport: 443",
    "        stunport: 3478",
    "        ipv4: 198.51.100.10",
    "",
  ].join("\n");
}

/**
 * Two regions where the second one is STUN-only: that node helps clients
 * discover their NAT mapping but never relays DERP traffic.
 */
function twoRegions(locale: Locale): string {
  return [
    ...header("two-regions", locale),
    ...fieldComments(locale),
    "",
    "regions:",
    "  901:",
    "    regionid: 901",
    "    regioncode: ams",
    '    regionname: "Amsterdam"',
    "    nodes:",
    '      - name: "901a"',
    "        regionid: 901",
    "        hostname: derp-ams.example.com",
    "        derpport: 443",
    "        stunport: 3478",
    "        ipv4: 198.51.100.10",
    "  902:",
    "    regionid: 902",
    "    regioncode: fra",
    '    regionname: "Frankfurt"',
    "    nodes:",
    '      - name: "902a"',
    "        regionid: 902",
    "        hostname: stun-fra.example.com",
    "        stunonly: true",
    "        stunport: 3478",
    "        ipv4: 198.51.100.11",
    "",
  ].join("\n");
}

/**
 * A field-by-field skeleton, commented out in full, followed by the minimal map
 * that makes the file usable as it stands. The commented half is the reference;
 * the live half is what Headscale reads.
 */
function skeleton(locale: Locale): string {
  const commented = [
    "regions:",
    "  901:",
    "    regionid: 901",
    "    regioncode: ams",
    '    regionname: "Amsterdam"',
    "    nodes:",
    '      - name: "901a"',
    "        regionid: 901",
    "        hostname: derp.example.com",
    "        derpport: 443",
    "        stunport: 3478",
    "        stunonly: false",
    "        ipv4: 198.51.100.10",
    "        ipv6: 2001:db8::10",
  ].map((line) => `# ${line}`);

  return [
    ...header("skeleton", locale),
    ...fieldComments(locale),
    "#",
    `# ${translate(locale, "settings.headscale.derp.mapTemplates.fields.optional")}`,
    ...commented,
    "",
    "regions:",
    "  901:",
    "    regionid: 901",
    "    regioncode: ams",
    '    regionname: "Amsterdam"',
    "    nodes:",
    '      - name: "901a"',
    "        regionid: 901",
    "        hostname: derp.example.com",
    "",
  ].join("\n");
}

/** The file content for one template, commented in `locale`. */
export function buildDerpMapTemplate(id: DerpMapTemplateId, locale: Locale): string {
  switch (id) {
    case "two-regions": {
      return twoRegions(locale);
    }
    case "skeleton": {
      return skeleton(locale);
    }
    default: {
      return oneRegion(locale);
    }
  }
}
