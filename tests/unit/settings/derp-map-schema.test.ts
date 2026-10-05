import { describe, expect, test } from "vitest";

import { computeDerpMapChecks } from "~/routes/settings/headscale/derp-map-checks";
import {
  isDerpMap,
  MAX_DERP_MAP_ISSUES,
  validateDerpMap,
  type DerpMapIssueCode,
} from "~/routes/settings/headscale/derp-map-schema";
import {
  buildDerpMapTemplate,
  DERP_MAP_TEMPLATE_IDS,
} from "~/routes/settings/headscale/derp-map-templates";

const VALID_TWO_REGIONS = `regions:
  901:
    regionid: 901
    regioncode: ams
    regionname: "Amsterdam"
    nodes:
      - name: "901a"
        regionid: 901
        hostname: derp-ams.example.com
        derpport: 443
        stunport: 3478
        ipv4: 198.51.100.10
  902:
    regionid: 902
    regioncode: fra
    regionname: "Frankfurt"
    nodes:
      - name: "902a"
        regionid: 902
        hostname: stun-fra.example.com
        stunonly: true
        stunport: 0
        ipv6: 2001:db8::11
`;

function codes(source: string): DerpMapIssueCode[] {
  return validateDerpMap(source).map((issue) => issue.code);
}

/** Replaces the single node of the one-region map with `body`. */
function withNode(body: string): string {
  return `regions:
  901:
    regionid: 901
    regioncode: ams
    regionname: "Amsterdam"
    nodes:
      - ${body}
`;
}

describe("validateDerpMap", () => {
  test("accepts a valid two-region map", () => {
    expect(validateDerpMap(VALID_TWO_REGIONS)).toEqual([]);
    expect(isDerpMap(VALID_TWO_REGIONS)).toBe(true);
  });

  test("accepts a node without derpport, stunport or addresses", () => {
    expect(
      codes(withNode("name: a\n        regionid: 901\n        hostname: d.example.com")),
    ).toEqual([]);
  });

  test("reports YAML syntax errors with the parser's position", () => {
    const issues = validateDerpMap("regions: [1,\n");
    expect(issues).toHaveLength(1);
    expect(issues[0].code).toBe("yamlSyntax");
    expect(issues[0].line).toBe(2);
    expect(typeof issues[0].column).toBe("number");
  });

  test("rejects a document that is not a mapping", () => {
    expect(codes("- one\n- two\n")).toEqual(["derpMapInvalidRoot"]);
  });

  test("requires a regions mapping", () => {
    expect(codes("foo: bar\n")).toEqual(["derpMapMissingRegions"]);
    expect(codes("regions: []\n")).toEqual(["derpMapInvalidRegions"]);
  });

  test("rejects a region that is not a mapping", () => {
    expect(codes("regions:\n  901: nope\n")).toContain("derpRegionInvalid");
  });

  test("requires regionid, regioncode and regionname", () => {
    expect(
      codes("regions:\n  901:\n    regioncode: ams\n    regionname: A\n    nodes: []\n"),
    ).toEqual(["derpRegionMissingId"]);
    expect(
      codes(
        "regions:\n  901:\n    regionid: abc\n    regioncode: ams\n    regionname: A\n    nodes: []\n",
      ),
    ).toEqual(["derpRegionInvalidId"]);
    expect(
      codes("regions:\n  901:\n    regionid: 901\n    regionname: A\n    nodes: []\n"),
    ).toEqual(["derpRegionMissingCode"]);
    expect(
      codes("regions:\n  901:\n    regionid: 901\n    regioncode: ams\n    nodes: []\n"),
    ).toEqual(["derpRegionMissingName"]);
  });

  test("requires a nodes list on every region", () => {
    expect(
      codes("regions:\n  901:\n    regionid: 901\n    regioncode: ams\n    regionname: A\n"),
    ).toEqual(["derpRegionMissingNodes"]);
    expect(
      codes(
        "regions:\n  901:\n    regionid: 901\n    regioncode: ams\n    regionname: A\n    nodes: 3\n",
      ),
    ).toEqual(["derpRegionInvalidNodes"]);
  });

  test("rejects duplicate region ids and codes", () => {
    const duplicateIds = `regions:
  901:
    regionid: 901
    regioncode: ams
    regionname: A
    nodes: []
  902:
    regionid: 901
    regioncode: fra
    regionname: B
    nodes: []
`;
    expect(codes(duplicateIds)).toEqual(["derpRegionDuplicateId"]);

    const duplicateCodes = `regions:
  901:
    regionid: 901
    regioncode: ams
    regionname: A
    nodes: []
  902:
    regionid: 902
    regioncode: ams
    regionname: B
    nodes: []
`;
    expect(codes(duplicateCodes)).toEqual(["derpRegionDuplicateCode"]);
  });

  test("requires name, hostname and regionid on every node", () => {
    expect(codes(withNode("regionid: 901\n        hostname: d.example.com"))).toEqual([
      "derpNodeMissingName",
    ]);
    expect(codes(withNode("name: a\n        regionid: 901"))).toEqual(["derpNodeMissingHostname"]);
    expect(codes(withNode("name: a\n        hostname: d.example.com"))).toEqual([
      "derpNodeMissingRegionId",
    ]);
    expect(
      codes(withNode("name: a\n        regionid: zero\n        hostname: d.example.com")),
    ).toEqual(["derpNodeInvalidRegionId"]);
    expect(codes(withNode("not: a node"))).toEqual([
      "derpNodeMissingName",
      "derpNodeMissingHostname",
      "derpNodeMissingRegionId",
    ]);
  });

  test("rejects a node whose regionid is not the region it is listed under", () => {
    const issues = validateDerpMap(
      withNode("name: a\n        regionid: 5\n        hostname: d.example.com"),
    );
    expect(issues.map((issue) => issue.code)).toEqual(["derpNodeRegionMismatch"]);
    expect(issues[0].vars).toEqual({ node: 5, region: 901 });
  });

  test("rejects an out of range derpport but accepts the default and a string port", () => {
    expect(
      codes(
        withNode(
          "name: a\n        regionid: 901\n        hostname: d.example.com\n        derpport: 0",
        ),
      ),
    ).toEqual(["derpNodeInvalidDerpPort"]);
    expect(
      codes(
        withNode(
          "name: a\n        regionid: 901\n        hostname: d.example.com\n        derpport: 70000",
        ),
      ),
    ).toEqual(["derpNodeInvalidDerpPort"]);
    expect(
      codes(
        withNode(
          "name: a\n        regionid: 901\n        hostname: d.example.com\n        derpport: always",
        ),
      ),
    ).toEqual(["derpNodeInvalidDerpPort"]);
    expect(
      codes(
        withNode(
          'name: a\n        regionid: 901\n        hostname: d.example.com\n        derpport: "443"',
        ),
      ),
    ).toEqual([]);
  });

  test("accepts stunport 0 and absence, rejects anything out of range", () => {
    const base = "name: a\n        regionid: 901\n        hostname: d.example.com";
    expect(codes(withNode(`${base}\n        stunport: 0`))).toEqual([]);
    expect(codes(withNode(`${base}\n        stunport: 3478`))).toEqual([]);
    expect(codes(withNode(`${base}\n        stunport: -1`))).toEqual(["derpNodeInvalidStunPort"]);
    expect(codes(withNode(`${base}\n        stunport: 70000`))).toEqual([
      "derpNodeInvalidStunPort",
    ]);
  });

  test("validates the optional node addresses", () => {
    const base = "name: a\n        regionid: 901\n        hostname: d.example.com";
    expect(codes(withNode(`${base}\n        ipv4: 300.1.1.1`))).toEqual(["derpNodeInvalidIpv4"]);
    expect(codes(withNode(`${base}\n        ipv6: 2001:db8:::1`))).toEqual(["derpNodeInvalidIpv6"]);
    expect(
      codes(withNode(`${base}\n        ipv4: "198.51.100.10"\n        ipv6: "2001:db8::10"`)),
    ).toEqual([]);
    // A blank address is how the format spells "none of this family".
    expect(codes(withNode(`${base}\n        ipv4: ""`))).toEqual([]);
    expect(codes(withNode(`${base}\n        ipv4: [1, 2]`))).toEqual(["derpNodeInvalidIpv4"]);
  });

  test("stunonly has to be a boolean", () => {
    const base = "name: a\n        regionid: 901\n        hostname: d.example.com";
    expect(codes(withNode(`${base}\n        stunonly: true`))).toEqual([]);
    expect(codes(withNode(`${base}\n        stunonly: "yes"`))).toEqual([
      "derpNodeInvalidStunOnly",
    ]);
  });

  test("reports the line of a structural problem and caps the list", () => {
    const issues = validateDerpMap(
      "regions:\n  901:\n    regionid: nope\n    regioncode: ams\n    regionname: A\n    nodes: []\n",
    );
    expect(issues[0].code).toBe("derpRegionInvalidId");
    expect(issues[0].line).toBe(3);

    const many = `regions:\n${Array.from(
      { length: MAX_DERP_MAP_ISSUES + 5 },
      (_, index) => `  ${index + 1}:\n    regioncode: c${index}\n`,
    ).join("")}`;
    expect(validateDerpMap(many)).toHaveLength(MAX_DERP_MAP_ISSUES);
  });
});

describe("DERP map templates", () => {
  const locales = ["en", "zh-Hans", "zh-Hant"] as const;
  const fieldNames = [
    "regionid",
    "regioncode",
    "regionname",
    "name",
    "hostname",
    "derpport",
    "stunport",
    "stunonly",
    "ipv4",
    "ipv6",
  ];

  test.each(locales)("%s templates are DERP maps the validator accepts", (locale) => {
    for (const id of DERP_MAP_TEMPLATE_IDS) {
      const content = buildDerpMapTemplate(id, locale);
      expect(validateDerpMap(content), `${locale}:${id}`).toEqual([]);
    }
  });

  test.each(locales)("%s templates explain every field in comments", (locale) => {
    for (const id of DERP_MAP_TEMPLATE_IDS) {
      const content = buildDerpMapTemplate(id, locale);
      for (const field of fieldNames) {
        expect(content, `${locale}:${id}:${field}`).toContain(field);
      }

      const comments = content
        .split("\n")
        .filter((line) => line.trimStart().startsWith("#"))
        .join("\n");
      for (const field of fieldNames) {
        expect(comments, `${locale}:${id}:${field}`).toContain(field);
      }
    }
  });

  test("the two-region template is the one that uses stunonly", () => {
    const live = (content: string) =>
      content
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("#"))
        .join("\n");

    expect(live(buildDerpMapTemplate("two-regions", "en"))).toContain("stunonly: true");
    expect(live(buildDerpMapTemplate("one-region", "en"))).not.toContain("stunonly");
  });

  test("the skeleton keeps a commented reference and a live minimal map", () => {
    const content = buildDerpMapTemplate("skeleton", "en");
    expect(content).toContain("# regions:");
    expect(content).toContain("\nregions:\n");
  });

  test("traditional chinese avoids simplified-only field terms", () => {
    const content = buildDerpMapTemplate("two-regions", "zh-Hant");
    expect(content).toContain("區域");
    expect(content).not.toContain("区域");
  });
});

describe("computeDerpMapChecks", () => {
  const base = {
    path: "/etc/headscale/derp/a.yaml",
    exists: true,
    isFile: true,
    readable: true,
    writable: true,
    tooLarge: false,
    unavailable: false,
    issues: [],
  };

  test("passes every check for a readable, writable, valid map", () => {
    const checks = computeDerpMapChecks(base);
    expect(checks).toHaveLength(7);
    expect(checks.every((check) => check.status === "pass")).toBe(true);
  });

  test("splits parse, schema and uniqueness problems apart", () => {
    const syntax = computeDerpMapChecks({
      ...base,
      issues: [{ code: "yamlSyntax", line: 2, column: 1 }],
    });
    expect(syntax.find((check) => check.id === "parses")?.status).toBe("fail");
    expect(syntax.find((check) => check.id === "schema")?.status).toBe("pass");

    const schema = computeDerpMapChecks({
      ...base,
      issues: [{ code: "derpNodeMissingHostname", line: 4, column: 9 }],
    });
    expect(schema.find((check) => check.id === "schema")?.status).toBe("fail");
    expect(schema.find((check) => check.id === "parses")?.status).toBe("pass");

    const unique = computeDerpMapChecks({
      ...base,
      issues: [{ code: "derpRegionDuplicateCode", vars: { code: "ams" } }],
    });
    expect(unique.find((check) => check.id === "unique")?.status).toBe("fail");
    expect(unique.find((check) => check.id === "schema")?.status).toBe("pass");
  });

  test("downgrades every problem to the shared cannot-check wording when invisible", () => {
    const checks = computeDerpMapChecks({ ...base, exists: false, unavailable: true });
    const problems = checks.filter((check) => check.status !== "pass");
    expect(problems.length).toBeGreaterThan(0);
    for (const problem of problems) {
      expect(problem.status).toBe("warning");
      expect(problem.bodyKey).toBe("settings.system.configChecks.pathUnavailable");
      expect(problem.vars).toEqual({ path: base.path });
    }
  });

  test("warns about a path the file has not been written to yet", () => {
    const checks = computeDerpMapChecks({ ...base, exists: false, writable: true });
    expect(checks.find((check) => check.id === "exists")?.status).toBe("warning");
    expect(checks.find((check) => check.id === "writable")?.status).toBe("pass");
  });
});
