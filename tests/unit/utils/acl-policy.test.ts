import { describe, expect, test } from "vitest";

import {
  aclRuleIssues,
  asUserReference,
  EMPTY_POLICY,
  groupsForUser,
  hasPortSpec,
  isValidGroupName,
  isValidHostName,
  isValidTagName,
  parsePolicy,
  policyDestinations,
  policySshDestinations,
  policySshSources,
  policySources,
  serializePolicy,
  setUserGroups,
  sshRuleIssues,
  unsupportedPolicySections,
  withDefaultPort,
  type AclRule,
  type SshRule,
} from "~/utils/acl-policy";

const POLICY = `{
  // Teams that can be referenced from rules
  "groups": {
    "group:eng": ["alice@", "bob@"],
    "group:ops": ["ops@"]
  },
  "tagOwners": {
    "tag:server": ["group:ops"]
  },
  "hosts": {
    "office": "100.64.0.0/24"
  },
  "acls": [
    { "action": "accept", "src": ["group:eng"], "dst": ["tag:server:22"] }
  ],
  "ssh": [
    { "action": "check", "src": ["group:ops"], "dst": ["tag:server"], "users": ["root"], "checkPeriod": "12h" }
  ],
  "autoApprovers": {
    "routes": { "10.0.0.0/8": ["group:ops"] },
    "exitNode": ["group:ops"]
  },
  "grants": [
    { "src": ["group:eng"], "dst": ["tag:server"], "ip": ["tcp:443"] }
  ],
  "nodeAttrs": [
    { "target": ["tag:server"], "attr": ["drive:share"] }
  ],
  // A top-level key Headplane does not model at all
  "postures": {
    "posture:latest": ["node:latest"]
  }
}`;

function parseOrThrow(raw: string) {
  const result = parsePolicy(raw);
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result;
}

describe("parsePolicy", () => {
  test("parses an empty policy into an empty model", () => {
    const result = parseOrThrow("");
    expect(result.policy).toEqual(EMPTY_POLICY);
    expect(result.hasComments).toBe(false);
  });

  test("does not report comments for a policy that only has trailing commas", () => {
    const result = parseOrThrow(`{
      "groups": { "group:eng": ["alice@"], },
    }`);

    expect(result.hasComments).toBe(false);
  });

  test("parses HuJSON with comments and trailing commas", () => {
    const result = parseOrThrow(`{
      "groups": { "group:eng": ["alice@"], }, // a comment
    }`);

    expect(result.policy.groups).toEqual({ "group:eng": ["alice@"] });
    expect(result.hasComments).toBe(true);
  });

  test("parses every known section", () => {
    const { policy } = parseOrThrow(POLICY);

    expect(policy.groups).toEqual({
      "group:eng": ["alice@", "bob@"],
      "group:ops": ["ops@"],
    });
    expect(policy.tagOwners).toEqual({ "tag:server": ["group:ops"] });
    expect(policy.hosts).toEqual({ office: "100.64.0.0/24" });
    expect(policy.acls).toEqual([
      { action: "accept", src: ["group:eng"], dst: ["tag:server:22"], extra: {} },
    ]);
    expect(policy.ssh).toEqual([
      {
        action: "check",
        src: ["group:ops"],
        dst: ["tag:server"],
        users: ["root"],
        checkPeriod: "12h",
        extra: {},
      },
    ]);
    expect(policy.grants).toEqual([
      { src: ["group:eng"], dst: ["tag:server"], ip: ["tcp:443"], via: [], extra: {} },
    ]);
    expect(policy.autoApprovers).toEqual({
      routes: { "10.0.0.0/8": ["group:ops"] },
      exitNode: ["group:ops"],
      extra: {},
    });
    expect(policy.nodeAttrs).toEqual([
      { target: ["tag:server"], attr: ["drive:share"], extra: {} },
    ]);
  });

  test("round-trips grants, autoApprovers and nodeAttrs", () => {
    const { policy } = parseOrThrow(POLICY);
    const serialized = serializePolicy(policy);
    const reparsed = parseOrThrow(serialized);

    expect(reparsed.policy.grants).toEqual(policy.grants);
    expect(reparsed.policy.autoApprovers).toEqual(policy.autoApprovers);
    expect(reparsed.policy.nodeAttrs).toEqual(policy.nodeAttrs);
    // Unknown keys inside a modelled section survive too.
    expect(serialized).toContain('"ip": ["tcp:443"]');
  });

  test("keeps unknown keys inside grants and nodeAttrs", () => {
    const { policy } = parseOrThrow(`{
      "grants": [{ "src": ["alice@"], "dst": ["tag:web"], "srcPosture": ["posture:latest"] }],
      "nodeAttrs": [{ "target": ["tag:web"], "attr": ["drive:share"], "comment": "keep me" }]
    }`);

    expect(policy.grants[0].extra).toEqual({ srcPosture: ["posture:latest"] });
    expect(policy.nodeAttrs[0].extra).toEqual({ comment: "keep me" });
  });

  test("parses app, via and randomizeClientPort", () => {
    const { policy } = parseOrThrow(`{
      "randomizeClientPort": true,
      "grants": [
        {
          "src": ["group:eng"],
          "dst": ["tag:connector"],
          "ip": [],
          "via": ["tag:router"],
          "app": { "name": "mydb", "connectors": ["tag:connector"], "domains": ["db.example.com"] }
        }
      ]
    }`);

    expect(policy.randomizeClientPort).toBe(true);
    expect(policy.grants[0].via).toEqual(["tag:router"]);
    expect(policy.grants[0].app).toEqual({
      name: "mydb",
      connectors: ["tag:connector"],
      extra: { domains: ["db.example.com"] },
    });
    // The modelled fields must not also be duplicated into `extra`.
    expect(policy.grants[0].extra).toEqual({});
  });

  test("tolerates app and via with the wrong shape", () => {
    const { policy } = parseOrThrow(`{
      "randomizeClientPort": "yes",
      "grants": [{ "src": ["alice@"], "dst": ["tag:web"], "app": "nope", "via": "tag:web" }]
    }`);

    // `via` is a string list, so a bare string still parses as one entry.
    expect(policy.grants[0].via).toEqual(["tag:web"]);
    expect(policy.grants[0].app).toBeUndefined();
    // A non-boolean value is not the key Headplane models, so it is kept.
    expect(policy.randomizeClientPort).toBeUndefined();
    expect(policy.extra.randomizeClientPort).toBe("yes");
  });

  test("defaults a missing app name to an empty string", () => {
    const { policy } = parseOrThrow(`{
      "grants": [{ "src": ["alice@"], "dst": ["tag:web"], "app": { "connectors": ["tag:web"] } }]
    }`);

    expect(policy.grants[0].app).toEqual({ name: "", connectors: ["tag:web"], extra: {} });
  });

  test("keeps rule actions and unknown rule keys as they were written", () => {
    const { policy } = parseOrThrow(`{
      "acls": [
        { "action": "deny", "src": ["group:eng"], "dst": ["tag:server:22"], "srcPosture": ["posture:latest"] }
      ],
      "ssh": [
        { "action": "reject", "src": ["group:ops"], "dst": ["tag:server"], "users": ["root"], "acceptEnv": ["TERM"] }
      ]
    }`);

    expect(policy.acls[0].action).toBe("deny");
    expect(policy.acls[0].extra).toEqual({ srcPosture: ["posture:latest"] });
    expect(policy.ssh[0].action).toBe("reject");
    expect(policy.ssh[0].extra).toEqual({ acceptEnv: ["TERM"] });

    // An action the editor does not know must survive a round trip: rewriting
    // it as "accept" would widen the policy behind the operator's back.
    const serialized = serializePolicy(policy);
    expect(serialized).toContain('"action": "deny"');
    expect(serialized).toContain('"srcPosture": ["posture:latest"]');
    expect(serialized).toContain('"acceptEnv": ["TERM"]');
  });

  test("keeps unknown top-level keys in extra", () => {
    const { policy } = parseOrThrow(POLICY);
    expect(policy.extra).toEqual({
      postures: { "posture:latest": ["node:latest"] },
    });
  });

  test("reports invalid JSON instead of throwing", () => {
    const result = parsePolicy("{ not json");
    expect(result.ok).toBe(false);
  });

  test("rejects a policy that is not an object", () => {
    const result = parsePolicy("[]");
    expect(result).toEqual({ ok: false, error: "The policy must be a JSON object" });
  });

  test("tolerates sections with the wrong shape", () => {
    const { policy } = parseOrThrow(`{ "groups": "nope", "acls": { "a": 1 }, "hosts": [] }`);
    expect(policy.groups).toEqual({});
    expect(policy.acls).toEqual([]);
    expect(policy.hosts).toEqual({});
  });
});

describe("serializePolicy", () => {
  test("round-trips a policy without losing data", () => {
    const { policy } = parseOrThrow(POLICY);
    const { policy: again } = parseOrThrow(serializePolicy(policy));
    expect(again).toEqual(policy);
  });

  test("keeps rules on a single line and preserves key order", () => {
    const { policy } = parseOrThrow(POLICY);
    const output = serializePolicy(policy);

    expect(output).toContain(
      `    { "action": "accept", "src": ["group:eng"], "dst": ["tag:server:22"] }`,
    );
    expect(output.indexOf(`"groups"`)).toBeLessThan(output.indexOf(`"tagOwners"`));
    expect(output.endsWith("\n")).toBe(true);
  });

  test("omits empty sections", () => {
    const { policy } = parseOrThrow(`{ "groups": { "group:eng": ["alice@"] } }`);
    const output = serializePolicy(policy);

    expect(output).toContain(`"groups"`);
    expect(output).not.toContain(`"acls"`);
    expect(output).not.toContain(`"hosts"`);
  });

  test("writes unknown keys back out", () => {
    const { policy } = parseOrThrow(POLICY);
    expect(serializePolicy(policy)).toContain(`"autoApprovers"`);
  });

  test("keeps the original top-level section order", () => {
    const { policy } = parseOrThrow(`{
      "ssh": [{ "action": "accept", "src": ["group:ops"], "dst": ["tag:server"], "users": ["root"] }],
      "hosts": { "office": "100.64.0.0/24" },
      "groups": { "group:eng": ["alice@"] }
    }`);
    const output = serializePolicy(policy);

    expect(output.indexOf(`"ssh"`)).toBeLessThan(output.indexOf(`"hosts"`));
    expect(output.indexOf(`"hosts"`)).toBeLessThan(output.indexOf(`"groups"`));
  });

  test("appends a section that did not exist before", () => {
    const { policy } = parseOrThrow(`{ "hosts": { "office": "100.64.0.0/24" } }`);
    const output = serializePolicy({
      ...policy,
      groups: { "group:eng": ["alice@"] },
    });

    expect(output.indexOf(`"hosts"`)).toBeLessThan(output.indexOf(`"groups"`));
  });

  test("round-trips app, via and randomizeClientPort", () => {
    const { policy } = parseOrThrow(`{
      "randomizeClientPort": true,
      "grants": [
        {
          "src": ["group:eng"],
          "dst": ["tag:connector"],
          "ip": [],
          "via": ["tag:router"],
          "app": { "name": "mydb", "connectors": ["tag:connector"], "domains": ["db.example.com"] }
        }
      ]
    }`);

    const serialized = serializePolicy(policy);
    const reparsed = parseOrThrow(serialized);

    expect(reparsed.policy.randomizeClientPort).toBe(true);
    expect(reparsed.policy.grants).toEqual(policy.grants);
    expect(serialized).toContain('"via": ["tag:router"]');
    expect(serialized).toContain('"name": "mydb"');
    // Unknown sub-keys inside app come back too.
    expect(serialized).toContain('"domains": ["db.example.com"]');
    expect(reparsed.policy.grants[0].app?.extra).toEqual({ domains: ["db.example.com"] });
  });

  test("omits via when empty and app when undefined", () => {
    const { policy } = parseOrThrow(`{
      "grants": [{ "src": ["alice@"], "dst": ["tag:web"], "ip": ["tcp:443"], "via": [] }]
    }`);

    const output = serializePolicy(policy);
    expect(output).not.toContain('"via"');
    expect(output).not.toContain('"app"');
  });

  test("only writes randomizeClientPort when it is set", () => {
    const { policy } = parseOrThrow(`{
      "grants": [{ "src": ["alice@"], "dst": ["tag:web"], "ip": ["tcp:443"] }]
    }`);

    const output = serializePolicy(policy);
    expect(output).not.toContain("randomizeClientPort");

    // A serialize -> parse cycle must not invent the key either.
    expect(parseOrThrow(output).policy.randomizeClientPort).toBeUndefined();

    // An explicit false is a real setting, so it is written back.
    const disabled = serializePolicy({ ...policy, randomizeClientPort: false });
    expect(disabled).toContain('"randomizeClientPort": false');
    expect(parseOrThrow(disabled).policy.randomizeClientPort).toBe(false);
  });
});

describe("unsupportedPolicySections", () => {
  test("reports the sections Headscale does not support", () => {
    const { policy } = parseOrThrow(POLICY);
    expect(unsupportedPolicySections(policy)).toEqual(["postures"]);
  });

  test("reports several sections in catalog order", () => {
    const { policy } = parseOrThrow(`{
      "ipSets": { "set:one": ["100.64.0.0/24"] },
      "postures": { "posture:latest": ["node:latest"] }
    }`);

    expect(unsupportedPolicySections(policy)).toEqual(["postures", "ipSets"]);
  });

  test("reports nothing for a policy Headplane models completely", () => {
    expect(unsupportedPolicySections(EMPTY_POLICY)).toEqual([]);
    expect(
      unsupportedPolicySections(parseOrThrow(`{ "groups": { "group:eng": ["alice@"] } }`).policy),
    ).toEqual([]);
  });
});

describe("group membership", () => {
  test("finds the groups a user belongs to", () => {
    const { policy } = parseOrThrow(POLICY);
    expect(groupsForUser(policy, "alice")).toEqual(["group:eng"]);
    expect(groupsForUser(policy, "ops")).toEqual(["group:ops"]);
    expect(groupsForUser(policy, "nobody")).toEqual([]);
  });

  test("adds a user to a group without reordering the existing members", () => {
    const { policy } = parseOrThrow(POLICY);
    const next = setUserGroups(policy, "ops", ["group:eng", "group:ops"]);

    expect(next.groups["group:eng"]).toEqual(["alice@", "bob@", "ops@"]);
    expect(next.groups["group:ops"]).toEqual(["ops@"]);
  });

  test("removes a user from groups that are no longer selected", () => {
    const { policy } = parseOrThrow(POLICY);
    const next = setUserGroups(policy, "alice", []);

    expect(next.groups["group:eng"]).toEqual(["bob@"]);
  });

  test("creates a group that does not exist yet", () => {
    const { policy } = parseOrThrow(POLICY);
    const next = setUserGroups(policy, "alice", ["group:eng", "group:new"]);

    expect(next.groups["group:new"]).toEqual(["alice@"]);
  });

  test("is a no-op when membership does not change", () => {
    const { policy } = parseOrThrow(POLICY);
    const next = setUserGroups(policy, "alice", ["group:eng"]);

    expect(next.groups).toEqual(policy.groups);
  });
});

describe("catalog helpers", () => {
  test("suggests groups, tags, hosts and users as sources", () => {
    const { policy } = parseOrThrow(POLICY);
    const sources = policySources(policy, ["alice", "ops"]);

    expect(sources).toEqual(
      expect.arrayContaining(["group:eng", "tag:server", "office", "alice@", "ops@"]),
    );
  });

  test("suggests autogroups only where they are valid", () => {
    const { policy } = parseOrThrow(POLICY);

    expect(policySources(policy, [])).toContain("autogroup:member");
    expect(policyDestinations(policy, [])).toContain("autogroup:internet");
    expect(policyDestinations(policy, [])).not.toContain("autogroup:member");
  });

  test("normalizes user references", () => {
    expect(asUserReference("alice")).toBe("alice@");
    expect(asUserReference("alice@")).toBe("alice@");
  });
});

describe("destination ports", () => {
  test("appends :* when no port is given", () => {
    expect(withDefaultPort("tag:web")).toBe("tag:web:*");
    expect(withDefaultPort("group:eng")).toBe("group:eng:*");
    expect(withDefaultPort("autogroup:internet")).toBe("autogroup:internet:*");
    expect(withDefaultPort("alice@")).toBe("alice@:*");
    expect(withDefaultPort("office")).toBe("office:*");
    expect(withDefaultPort("*")).toBe("*:*");
    expect(withDefaultPort("100.64.0.0/24")).toBe("100.64.0.0/24:*");
  });

  test("leaves an existing port spec alone", () => {
    expect(withDefaultPort("tag:web:*")).toBe("tag:web:*");
    expect(withDefaultPort("tag:web:80")).toBe("tag:web:80");
    expect(withDefaultPort("tag:web:80,443")).toBe("tag:web:80,443");
    expect(withDefaultPort("tag:web:8000-8080")).toBe("tag:web:8000-8080");
    expect(withDefaultPort("tag:web:22,8000-8080")).toBe("tag:web:22,8000-8080");
    expect(withDefaultPort("*:*")).toBe("*:*");
  });

  test("treats a bare IPv6 address as unported", () => {
    expect(withDefaultPort("fd7a:115c:a1e0::1")).toBe("fd7a:115c:a1e0::1:*");
    expect(withDefaultPort("fd7a::1")).toBe("fd7a::1:*");
    expect(withDefaultPort("fd7a::/48")).toBe("fd7a::/48:*");
  });

  test("keeps the port of a bracketless IPv6 destination", () => {
    // Headscale splits on the last colon, so this is `fd7a::1` on port 22 and
    // appending `:*` would change which port the rule opens.
    expect(withDefaultPort("fd7a::1:22")).toBe("fd7a::1:22");
    expect(withDefaultPort("fd7a:115c:a1e0::1:80,443")).toBe("fd7a:115c:a1e0::1:80,443");
    expect(hasPortSpec("fd7a::1:22")).toBe(true);
  });

  test("leaves a bracketed IPv6 destination alone", () => {
    expect(withDefaultPort("[fd7a:115c:a1e0::1]:22")).toBe("[fd7a:115c:a1e0::1]:22");
  });

  test("trims and ignores empty input", () => {
    expect(withDefaultPort("  tag:web  ")).toBe("tag:web:*");
    expect(withDefaultPort("   ")).toBe("");
  });

  test("reports whether a port spec is present", () => {
    expect(hasPortSpec("tag:web:80")).toBe(true);
    expect(hasPortSpec("group:eng:*")).toBe(true);
    expect(hasPortSpec("100.64.0.1:22")).toBe(true);
    expect(hasPortSpec("tag:web")).toBe(false);
    expect(hasPortSpec("fd7a::1")).toBe(false);
    expect(hasPortSpec("alice@")).toBe(false);
  });
});

describe("validation", () => {
  test("accepts well-formed names", () => {
    expect(isValidGroupName("group:eng-team")).toBe(true);
    expect(isValidTagName("tag:web-01")).toBe(true);
    expect(isValidHostName("office-2")).toBe(true);
  });

  test("rejects malformed names", () => {
    expect(isValidGroupName("eng")).toBe(false);
    expect(isValidGroupName("group:")).toBe(false);
    expect(isValidGroupName("group:Eng")).toBe(false);
    expect(isValidTagName("group:eng")).toBe(false);
    expect(isValidHostName("tag:web")).toBe(false);
  });
});

function sshRule(overrides: Partial<SshRule>): SshRule {
  return {
    action: "accept",
    src: ["group:ops"],
    dst: ["tag:server"],
    users: ["root"],
    extra: {},
    ...overrides,
  };
}

function aclRule(overrides: Partial<AclRule>): AclRule {
  return { action: "accept", src: ["group:eng"], dst: ["tag:server:22"], extra: {}, ...overrides };
}

function codes(issues: ReturnType<typeof sshRuleIssues>): string[] {
  return issues.map((issue) => issue.code);
}

describe("SSH catalogs", () => {
  test("only suggests sources the SSH parser can read", () => {
    const { policy } = parseOrThrow(POLICY);
    const sources = policySshSources(policy, ["alice"]);

    expect(sources).toEqual(
      expect.arrayContaining([
        "group:eng",
        "tag:server",
        "alice@",
        "autogroup:member",
        "autogroup:tagged",
      ]),
    );
    // Hosts, addresses and `*` fail while Headscale parses an SSH source.
    expect(sources).not.toContain("office");
    expect(sources).not.toContain("*");
    expect(sources).not.toContain("autogroup:admin");
    expect(sources).not.toContain("autogroup:internet");
  });

  test("only suggests destinations SSH rules can use", () => {
    const { policy } = parseOrThrow(POLICY);
    const destinations = policySshDestinations(policy, ["alice"]);

    expect(destinations).toEqual(
      expect.arrayContaining([
        "tag:server",
        "alice@",
        "autogroup:self",
        "autogroup:member",
        "autogroup:tagged",
      ]),
    );
    expect(destinations).not.toContain("group:eng");
    expect(destinations).not.toContain("office");
    expect(destinations).not.toContain("*");
    expect(destinations).not.toContain("autogroup:internet");
  });
});

describe("SSH rule checks", () => {
  const { policy } = parseOrThrow(POLICY);

  test("accepts rules Headscale accepts", () => {
    expect(sshRuleIssues(sshRule({}), policy)).toEqual([]);
    expect(sshRuleIssues(sshRule({ src: ["alice@"], dst: ["autogroup:self"] }), policy)).toEqual(
      [],
    );
    expect(
      sshRuleIssues(sshRule({ src: ["autogroup:tagged"], dst: ["autogroup:tagged"] }), policy),
    ).toEqual([]);
  });

  test("rejects sources the SSH parser cannot read", () => {
    expect(codes(sshRuleIssues(sshRule({ src: ["*"] }), policy))).toEqual(["sshSourceAlias"]);
    expect(codes(sshRuleIssues(sshRule({ src: ["office"] }), policy))).toEqual(["sshSourceAlias"]);
    expect(codes(sshRuleIssues(sshRule({ src: ["100.64.0.1/32"] }), policy))).toEqual([
      "sshSourceAlias",
    ]);
  });

  test("rejects autogroups that are not SSH sources", () => {
    expect(codes(sshRuleIssues(sshRule({ src: ["autogroup:admin"] }), policy))).toEqual([
      "sshAutogroupSource",
    ]);
    expect(codes(sshRuleIssues(sshRule({ src: ["autogroup:internet"] }), policy))).toEqual([
      "sshAutogroupSource",
    ]);
  });

  test("rejects destinations SSH rules cannot use", () => {
    expect(codes(sshRuleIssues(sshRule({ dst: ["*"] }), policy))).toEqual(["sshDestinationAlias"]);
    expect(codes(sshRuleIssues(sshRule({ dst: ["group:eng"] }), policy))).toEqual([
      "sshDestinationAlias",
    ]);
    expect(codes(sshRuleIssues(sshRule({ dst: ["office"] }), policy))).toEqual([
      "sshDestinationHost",
    ]);
    expect(codes(sshRuleIssues(sshRule({ dst: ["autogroup:internet"] }), policy))).toEqual([
      "sshAutogroupDestination",
    ]);
  });

  test("reports groups and tags that are not defined", () => {
    expect(codes(sshRuleIssues(sshRule({ src: ["group:missing"] }), policy))).toEqual([
      "sshGroupMissing",
    ]);
    expect(codes(sshRuleIssues(sshRule({ src: ["tag:missing"] }), policy))).toEqual([
      "sshTagMissing",
    ]);
    expect(codes(sshRuleIssues(sshRule({ dst: ["tag:missing"] }), policy))).toEqual([
      "sshTagMissing",
    ]);
  });

  test("keeps a tag source away from user-owned destinations", () => {
    expect(codes(sshRuleIssues(sshRule({ src: ["tag:server"], dst: ["alice@"] }), policy))).toEqual(
      ["sshTagSourceToUser"],
    );
    expect(
      codes(sshRuleIssues(sshRule({ src: ["autogroup:tagged"], dst: ["alice@"] }), policy)),
    ).toEqual(["sshTagSourceToUser"]);
    expect(
      codes(sshRuleIssues(sshRule({ src: ["tag:server"], dst: ["autogroup:self"] }), policy)),
    ).toEqual(["sshTagSourceToAutogroupSelf"]);
    expect(
      codes(sshRuleIssues(sshRule({ src: ["tag:server"], dst: ["autogroup:member"] }), policy)),
    ).toEqual(["sshTagSourceToAutogroupMember"]);
  });

  test("requires a user destination to be its own single source", () => {
    expect(
      codes(sshRuleIssues(sshRule({ src: ["autogroup:member"], dst: ["alice@"] }), policy)),
    ).toEqual(["sshUserDestinationRequiresSameUser"]);
    expect(
      codes(sshRuleIssues(sshRule({ src: ["alice@", "bob@"], dst: ["alice@"] }), policy)),
    ).toEqual(["sshUserDestinationRequiresSameUser"]);
  });

  test("rejects an empty or wildcard SSH user", () => {
    expect(codes(sshRuleIssues(sshRule({ users: ["*"] }), policy))).toEqual(["sshUserInvalid"]);
    expect(codes(sshRuleIssues(sshRule({ users: ["root", "*"] }), policy))).toEqual([
      "sshUserInvalid",
    ]);
  });

  test("validates the check period", () => {
    expect(codes(sshRuleIssues(sshRule({ checkPeriod: "12h" }), policy))).toEqual([
      "sshCheckPeriodOnAccept",
    ]);
    expect(codes(sshRuleIssues(sshRule({ action: "check", checkPeriod: "12h" }), policy))).toEqual(
      [],
    );
    expect(
      codes(sshRuleIssues(sshRule({ action: "check", checkPeriod: "1h30m" }), policy)),
    ).toEqual([]);
    expect(codes(sshRuleIssues(sshRule({ action: "check", checkPeriod: "168h" }), policy))).toEqual(
      [],
    );
    expect(codes(sshRuleIssues(sshRule({ action: "check", checkPeriod: "169h" }), policy))).toEqual(
      ["sshCheckPeriodInvalid"],
    );
    expect(codes(sshRuleIssues(sshRule({ action: "check", checkPeriod: "12" }), policy))).toEqual([
      "sshCheckPeriodInvalid",
    ]);
    expect(codes(sshRuleIssues(sshRule({ action: "check", checkPeriod: "-1h" }), policy))).toEqual([
      "sshCheckPeriodInvalid",
    ]);
  });
});

describe("ACL rule checks", () => {
  test("only lets users, groups, * and autogroup:member reach autogroup:self", () => {
    expect(
      codes(aclRuleIssues(aclRule({ src: ["autogroup:tagged"], dst: ["autogroup:self:*"] }))),
    ).toEqual(["aclAutogroupSelfSource"]);
    expect(codes(aclRuleIssues(aclRule({ src: ["office"], dst: ["autogroup:self"] })))).toEqual([
      "aclAutogroupSelfSource",
    ]);
    expect(
      codes(aclRuleIssues(aclRule({ src: ["autogroup:member"], dst: ["autogroup:self:*"] }))),
    ).toEqual([]);
    expect(codes(aclRuleIssues(aclRule({ src: ["*"], dst: ["autogroup:self:*"] })))).toEqual([]);
    expect(
      codes(aclRuleIssues(aclRule({ src: ["group:eng"], dst: ["autogroup:self:*"] }))),
    ).toEqual([]);
  });

  test("leaves rules without an autogroup:self destination alone", () => {
    expect(codes(aclRuleIssues(aclRule({ src: ["tag:server"] })))).toEqual([]);
  });
});
