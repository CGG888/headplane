// MARK: Mirror map generation
//
// Pure functions that turn the official DERP map into Headplane's local mirror:
// which official region becomes which number, and the document that is written.
// Nothing here touches the filesystem or the network, so every rule below is
// unit tested directly.
//
// Numbering rule
// --------------
// No region has a fixed number. The selected regions are ranked by measured
// latency, fastest first, and that ranking hands out the 900s from 901 upward,
// so a selection of one mirrors it as 901 and a selection of five numbers them
// 901-905. Equal latencies are settled by official region id. 900 is held back
// as the fallback slot and 999 — Headscale's embedded region id — is never given
// to anything else. The latencies
// this server probed itself take precedence over the ones the agent's machines
// reported, so a mirror can rank the official regions the clients cannot see.
// That comparison is a total order over distinct ids, so the result never
// depends on the order the caller listed the selection in. (The official region
// *code* would be the finer tie-break an operator sees, but this call receives
// ids and latencies only, so the id decides and the caller's order is the last
// resort.)
//
// The assignment is sticky. A stored assignment that still covers every selected
// region is returned unchanged and `rankedAt` is left alone, so a scheduled run
// does not shuffle region numbers — and therefore every client's relay choice —
// just because a latency sample moved. Only regions the stored assignment does
// not cover are numbered, and they are appended after the highest number in use.
// A re-rank is an explicit operator action (`reassign()`), which drops the
// stored assignment first.

import { parseDocument, stringify } from "yaml";

import { chineseRegionName } from "./names";
import type { LocalDerpMap, LocalDerpNode, LocalDerpRegion, OfficialRegion } from "./types";

/** The lowest mirrored number; only ever used as a fallback, never by ranking. */
export const MIRROR_NUMBER_MIN = 900;

/** The highest mirrored number. */
export const MIRROR_NUMBER_MAX = 999;

/** The first number ranking hands out: the fastest selected region is 901. */
export const MIRROR_NUMBER_FIRST_RANKED = 901;

/**
 * Headscale's default embedded-region id. The embedded relay is a region of its
 * own in the map Headscale serves, so a mirror must never be numbered 999: two
 * regions with one id is a map Headscale cannot merge.
 */
export const EMBEDDED_REGION_ID = 999;

/** Numbers no ranked region may ever take. 900 stays free for a fallback. */
const RESERVED_NUMBERS: ReadonlySet<number> = new Set([EMBEDDED_REGION_ID]);

/**
 * Whether a mirrored number may appear in the rendered map. Everything in the
 * 900s counts; 999 is the embedded region's own id and is not one of them.
 */
function isMirrorNumber(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= MIRROR_NUMBER_MIN &&
    value <= MIRROR_NUMBER_MAX &&
    value !== EMBEDDED_REGION_ID
  );
}

/** One official region id as this module uses it, or undefined for junk. */
function readId(value: unknown): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }

  const text = String(value).trim();
  if (!/^\d+$/.test(text)) {
    return undefined;
  }

  const id = Number(text);
  return Number.isSafeInteger(id) && id > 0 ? String(id) : undefined;
}

/** A mirrored number that may be handed to a region, or undefined. */
function readNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    return undefined;
  }

  if (value < MIRROR_NUMBER_MIN || value > MIRROR_NUMBER_MAX) {
    return undefined;
  }

  return RESERVED_NUMBERS.has(value) ? undefined : value;
}

/** The selected ids, deduplicated, in the order the caller listed them. */
function readSelection(selected: readonly string[]): string[] {
  const ids: string[] = [];
  for (const entry of selected) {
    const id = readId(entry);
    if (id !== undefined && !ids.includes(id)) {
      ids.push(id);
    }
  }

  return ids;
}

/** The stored assignment, reduced to the entries that can actually be kept. */
function readExisting(existing: Record<string, number> | undefined): Map<string, number> {
  const kept = new Map<string, number>();
  if (existing === undefined) {
    return kept;
  }

  for (const [key, value] of Object.entries(existing)) {
    const id = readId(key);
    const number = readNumber(value);
    if (id === undefined || number === undefined) {
      continue;
    }

    kept.set(id, number);
  }

  return kept;
}

/** A latency sample that can be ranked, or undefined for "not measured". */
function readLatency(latenciesMs: Record<string, number>, id: string): number | undefined {
  const value = latenciesMs[id];
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

/**
 * The latency one region is ranked by, when it has one: the value this server
 * measured itself first, the machine-reported value next.
 *
 * The local probe is the newer signal and the only one that can see the
 * official regions a mirrored setup hands out, so it wins wherever it exists —
 * but only while it is current: the caller passes the measured values that are
 * still inside their TTL (see `locallyMeasuredRegionLatencies`), so an ancient
 * measurement can never silently outrank the reported value. A region nobody
 * probed here keeps exactly the reported value it had before.
 */
function readRankingLatency(
  reportedMs: Record<string, number>,
  measuredMs: Record<string, number> | undefined,
  id: string,
): number | undefined {
  const measured = measuredMs === undefined ? undefined : readLatency(measuredMs, id);
  return measured ?? readLatency(reportedMs, id);
}

/** Ids in ascending numeric order: the tie-break when latencies are equal. */
function compareIds(a: string, b: string): number {
  return Number(a) - Number(b) || a.localeCompare(b);
}

/** The free number to hand out, starting at `start` and staying inside the 900s. */
function takeNumber(start: number, used: ReadonlySet<number>): number | undefined {
  const from = Math.max(start, MIRROR_NUMBER_MIN);
  for (let number = from; number <= MIRROR_NUMBER_MAX; number += 1) {
    if (!RESERVED_NUMBERS.has(number) && !used.has(number)) {
      return number;
    }
  }

  // The tail of the range is full (or 999 was reached): the gaps below the
  // starting point are used before giving up on the region.
  for (let number = MIRROR_NUMBER_MIN; number < from; number += 1) {
    if (!RESERVED_NUMBERS.has(number) && !used.has(number)) {
      return number;
    }
  }

  return undefined;
}

/** Keys in mirrored-number order, so the rendered file reads top to bottom. */
function ordered(assignment: ReadonlyMap<string, number>): Record<string, number> {
  const entries = [...assignment.entries()].toSorted(
    (a, b) => a[1] - b[1] || compareIds(a[0], b[0]),
  );

  return Object.fromEntries(entries);
}

export interface RegionNumbering {
  assignment: Record<string, number>;
  /**
   * Selected regions the mirrored range had no free number left for, in ranking
   * order. Empty for every map the official source describes; a caller that gets
   * a non-empty list must not write a mirror, because the file would silently
   * lose the regions listed here.
   */
  unassigned: string[];
  /** Set only when this call ranked afresh; absent when the stored one was kept. */
  rankedAt?: string;
}

/**
 * Assigns every selected official region a mirrored number.
 *
 * `existing` is the stored assignment; when it covers the whole selection it is
 * returned as it is and the caller keeps its `rankedAt`. Otherwise the covered
 * regions keep their numbers, the new ones are ranked by `measuredMs` first and
 * `latenciesMs` next (a region with no sample at all ranks last) and appended
 * after the highest number in use, and the returned `rankedAt` says when that
 * happened. Every returned number is inside 900-999 and outside the reserved
 * set, and no number is handed out twice.
 *
 * `latenciesMs` are the latencies the Headplane Agent's machines reported;
 * `measuredMs` are the ones this server probed itself, and a local value wins
 * over a reported one for the same region.
 *
 * When the selection is larger than the 99 numbers the mirrored range offers
 * (900-998; 999 belongs to the embedded region), the surplus regions are
 * returned in `unassigned` instead of being dropped quietly: the caller turns
 * that into a recorded reason and writes nothing.
 */
export function assignRegionNumbers(
  selectedOfficialIds: string[],
  latenciesMs: Record<string, number>,
  existing?: Record<string, number>,
  measuredMs?: Record<string, number>,
): RegionNumbering {
  const selected = readSelection(selectedOfficialIds);
  const previous = readExisting(existing);
  const used = new Set<number>(RESERVED_NUMBERS);

  // The stored assignment first: a region it still numbers keeps that number
  // unless another region already took it.
  const kept = new Map<string, number>();
  for (const id of selected) {
    const number = previous.get(id);
    if (number === undefined || used.has(number)) {
      continue;
    }

    kept.set(id, number);
    used.add(number);
  }

  // Covered: every selected region already has a number, so nothing is ranked
  // and the timestamp the caller recorded for that ranking survives untouched.
  if (existing !== undefined && selected.every((id) => kept.has(id))) {
    return { assignment: ordered(kept), unassigned: [] };
  }

  const ranked = selected
    .filter((id) => !kept.has(id))
    .map((id, index) => ({
      id,
      index,
      latency: readRankingLatency(latenciesMs, measuredMs, id),
    }))
    .toSorted((a, b) => {
      // Unmeasured regions rank behind measured ones, then by official id. The
      // recorded position is the last resort: `compareIds` is already a total
      // order over distinct ids, so it only ever settles a repeated id.
      const left = a.latency ?? Number.POSITIVE_INFINITY;
      const right = b.latency ?? Number.POSITIVE_INFINITY;
      return left - right || compareIds(a.id, b.id) || a.index - b.index;
    });

  let next = MIRROR_NUMBER_FIRST_RANKED;
  for (const number of kept.values()) {
    next = Math.max(next, number + 1);
  }

  const unassigned: string[] = [];
  for (const entry of ranked) {
    const number = takeNumber(next, used);
    if (number === undefined) {
      // 99 of the 900s are usable and the official map has far fewer regions, so
      // a pasted map is the only way to get here. The region is reported rather
      // than given a number outside the mirrored range, and the caller refuses
      // to write a map that leaves it out.
      unassigned.push(entry.id);
      continue;
    }

    kept.set(entry.id, number);
    used.add(number);
    next = number + 1;
  }

  return { assignment: ordered(kept), unassigned, rankedAt: new Date().toISOString() };
}

/** `a`, `b`, ... `z`, `aa`, ... — the suffix of a node's `<number><letter>` name. */
function nodeLetter(index: number): string {
  let value = index + 1;
  let suffix = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    suffix = String.fromCharCode(97 + remainder) + suffix;
    value = Math.floor((value - 1) / 26);
  }

  return suffix;
}

/** One official node, renamed and re-homed onto the mirrored region. */
function toLocalNode(
  node: OfficialRegion["nodes"][number],
  number: number,
  index: number,
): LocalDerpNode {
  return {
    name: `${number}${nodeLetter(index)}`,
    hostname: node.hostname,
    regionid: number,
    ...(node.derpPort === undefined ? {} : { derpport: node.derpPort }),
    ...(node.stunPort === undefined ? {} : { stunport: node.stunPort }),
    // Only a real `true` is written; the format's default is a normal DERP node.
    ...(node.stunOnly ? { stunonly: true } : {}),
    ...(node.ipv4 === undefined ? {} : { ipv4: node.ipv4 }),
    ...(node.ipv6 === undefined ? {} : { ipv6: node.ipv6 }),
  };
}

/**
 * Builds the local map for the selected regions: every region renumbered as the
 * assignment says, its `regioncode` kept from the official map so a client's
 * region choice is still recognizable, its `regionname` in Chinese, and every
 * node the official map lists for it.
 *
 * A selected region the official map does not describe, and one the assignment
 * has no number for, are skipped: the map must not name a region Headscale
 * cannot dial.
 */
export function buildMirrorMap(
  regions: OfficialRegion[],
  assignment: Record<string, number>,
  selected: string[],
): LocalDerpMap {
  const wanted = new Set(readSelection(selected));
  const scheduled = regions
    .map((region) => ({ region, id: readId(region.regionId) }))
    .filter(
      (entry): entry is { region: OfficialRegion; id: string } =>
        entry.id !== undefined && wanted.has(entry.id),
    )
    .map((entry) => ({ ...entry, number: assignment[entry.id] }))
    .filter((entry): entry is { region: OfficialRegion; id: string; number: number } =>
      isMirrorNumber(entry.number),
    )
    .toSorted(
      (a, b) =>
        a.number - b.number ||
        Number(a.id) - Number(b.id) ||
        a.region.code.localeCompare(b.region.code),
    );

  const output: Record<string, LocalDerpRegion> = {};
  for (const { region, number } of scheduled) {
    const key = String(number);
    if (output[key] !== undefined) {
      // Two regions cannot share a number; the first one (by id) keeps it.
      continue;
    }

    output[key] = {
      regionid: number,
      regioncode: region.code,
      regionname: chineseRegionName(region.code, region.name),
      nodes: region.nodes.map((node, index) => toLocalNode(node, number, index)),
    };
  }

  return { regions: output };
}

/**
 * Renders the map as the YAML file Headscale reads. Region keys are the mirrored
 * numbers, so the file reads like the official map it came from and an operator
 * can hand-edit it.
 */
export function renderMirrorYaml(map: LocalDerpMap): string {
  const regions = new Map<number, LocalDerpRegion>();
  for (const entry of Object.values(map.regions)) {
    regions.set(entry.regionid, entry);
  }

  return stringify({ regions }, { lineWidth: 0, indent: 2 });
}

/** A value with every object key in ascending order, for a canonical comparison. */
function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalValue);
  }

  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(source)
        .toSorted()
        .map((key) => [key, canonicalValue(source[key])]),
    );
  }

  return value;
}

/** The document as a canonical string, or undefined when it cannot be parsed. */
function canonicalYaml(source: string): string | undefined {
  const document = parseDocument(source);
  if (document.errors.length > 0) {
    return undefined;
  }

  return JSON.stringify(canonicalValue(document.toJS()));
}

/**
 * Whether the file on disk has to be replaced. The comparison is canonical: two
 * documents that describe the same map are the same map, whatever their comments,
 * key order or quoting say, so a run that changes nothing never rewrites the file
 * (and therefore never reloads Headscale). A missing or unparsable file always
 * counts as a change, so a hand-broken mirror is repaired.
 */
export function mirrorMapChanged(previousYaml: string | undefined, nextYaml: string): boolean {
  if (previousYaml === undefined) {
    return true;
  }

  const previous = canonicalYaml(previousYaml);
  if (previous === undefined) {
    return true;
  }

  return previous !== canonicalYaml(nextYaml);
}
