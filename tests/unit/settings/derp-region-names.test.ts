import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  DERP_REGION_NAMES_FILE,
  derpRegionNameFor,
  derpRegionNamesPath,
  parseDerpRegionNames,
  readDerpRegionNames,
  removeDerpRegionName,
  serializeDerpRegionNames,
  setDerpRegionName,
  writeDerpRegionNames,
} from "~/server/headscale/derp-region-names";

describe("DERP region name parsing", () => {
  test("reads a plain id to name object", () => {
    expect(parseDerpRegionNames('{"901":"Amsterdam","999":"Home"}')).toEqual({
      "901": "Amsterdam",
      "999": "Home",
    });
  });

  test("tolerates missing, corrupt and unexpected documents", () => {
    expect(parseDerpRegionNames(undefined)).toEqual({});
    expect(parseDerpRegionNames("")).toEqual({});
    expect(parseDerpRegionNames("{not json")).toEqual({});
    expect(parseDerpRegionNames("[1,2,3]")).toEqual({});
    expect(parseDerpRegionNames("null")).toEqual({});
    expect(parseDerpRegionNames('"a string"')).toEqual({});
  });

  test("drops entries that are not a positive id with a non-blank name", () => {
    expect(
      parseDerpRegionNames(
        JSON.stringify({
          "901": "Amsterdam",
          "0": "Zero",
          "-1": "Negative",
          abc: "Named",
          "902": "",
          "903": "   ",
          "904": 12,
          "905": null,
        }),
      ),
    ).toEqual({ "901": "Amsterdam" });
  });

  test("normalizes equivalent id spellings to one key", () => {
    expect(parseDerpRegionNames('{"0901":"Amsterdam"," 901 ":"Utrecht"}')).toEqual({
      "901": "Utrecht",
    });
  });

  test("serializes ids ascending with a trailing newline", () => {
    expect(serializeDerpRegionNames({ "999": "Home", "901": "Amsterdam" })).toBe(
      ["{", '  "901": "Amsterdam",', '  "999": "Home"', "}", ""].join("\n"),
    );
  });
});

describe("DERP region name helpers", () => {
  test("set adds or replaces one pair without mutating the input", () => {
    const original = { "901": "Amsterdam" };
    expect(setDerpRegionName(original, 902, " Utrecht ")).toEqual({
      "901": "Amsterdam",
      "902": "Utrecht",
    });
    expect(setDerpRegionName(original, 901, "Rotterdam")).toEqual({ "901": "Rotterdam" });
    expect(original).toEqual({ "901": "Amsterdam" });
    // Invalid ids and blank names are no-ops.
    expect(setDerpRegionName(original, 0, "Zero")).toEqual(original);
    expect(setDerpRegionName(original, 903, "  ")).toEqual(original);
  });

  test("remove deletes one pair without mutating the input", () => {
    const original = { "901": "Amsterdam", "999": "Home" };
    expect(removeDerpRegionName(original, "901")).toEqual({ "999": "Home" });
    expect(removeDerpRegionName(original, 404)).toEqual(original);
    expect(original).toEqual({ "901": "Amsterdam", "999": "Home" });
  });

  test("resolves a name by numeric id and normalizes the key", () => {
    expect(derpRegionNameFor({ "901": "Amsterdam" }, 901)).toBe("Amsterdam");
    expect(derpRegionNameFor(undefined, 901)).toBeUndefined();
    expect(derpRegionNameFor({ "901": "Amsterdam" }, 902)).toBeUndefined();
  });
});

describe("DERP region name file", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "headplane-derp-region-names-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("lives in the data directory under a fixed name", () => {
    expect(DERP_REGION_NAMES_FILE).toBe("derp-region-names.json");
    expect(derpRegionNamesPath(dir)).toBe(join(dir, DERP_REGION_NAMES_FILE));
  });

  test("round-trips a mapping through an atomic write", async () => {
    expect(await writeDerpRegionNames(dir, { "901": "Amsterdam", "999": "Home" })).toBe(true);

    // The temp file is renamed into place, so only the target remains.
    expect(await readdir(dir)).toEqual([DERP_REGION_NAMES_FILE]);
    expect(await readDerpRegionNames(dir)).toEqual({ "901": "Amsterdam", "999": "Home" });

    const raw = await readFile(join(dir, DERP_REGION_NAMES_FILE), "utf8");
    expect(raw.endsWith("\n")).toBe(true);
  });

  test("an overwrite replaces the previous mapping", async () => {
    await writeDerpRegionNames(dir, { "901": "Amsterdam" });
    await writeDerpRegionNames(dir, { "902": "Utrecht" });

    expect(await readDerpRegionNames(dir)).toEqual({ "902": "Utrecht" });
    expect(await readdir(dir)).toEqual([DERP_REGION_NAMES_FILE]);
  });

  test("a missing file reads as an empty map", async () => {
    expect(await readDerpRegionNames(dir)).toEqual({});
  });

  test("a corrupt file reads as an empty map instead of throwing", async () => {
    await writeFile(join(dir, DERP_REGION_NAMES_FILE), "{ not json", "utf8");
    expect(await readDerpRegionNames(dir)).toEqual({});
  });

  test("delete writes the mapping without the removed pair", async () => {
    await writeDerpRegionNames(dir, { "901": "Amsterdam", "999": "Home" });
    const names = await readDerpRegionNames(dir);
    await writeDerpRegionNames(dir, removeDerpRegionName(names, 901));

    expect(await readDerpRegionNames(dir)).toEqual({ "999": "Home" });
  });

  test("an unwritable data directory reports failure instead of throwing", async () => {
    const blocker = join(dir, "blocked");
    await writeFile(blocker, "not a directory", "utf8");

    expect(await writeDerpRegionNames(blocker, { "901": "Amsterdam" })).toBe(false);
    expect(await readDerpRegionNames(blocker)).toEqual({});
  });
});
