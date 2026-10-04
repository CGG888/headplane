import { describe, expect, test } from "vitest";

import { describeAgentError, MAX_AGENT_ERROR_LENGTH } from "~/server/hp-agent-error";

describe("describeAgentError", () => {
  test("keeps a plain message", () => {
    expect(describeAgentError("registration rejected")).toBe("registration rejected");
    expect(describeAgentError("  padded  ")).toBe("padded");
  });

  test("reads an Error", () => {
    expect(describeAgentError(new Error("spawn failed"))).toBe("spawn failed");
  });

  test("pulls the message out of an agent error object", () => {
    // The shape that produced `[object Object]` on the settings page.
    expect(describeAgentError({ message: "cannot reach headscale" })).toBe(
      "cannot reach headscale",
    );
    expect(describeAgentError({ error: "no pre-auth key" })).toBe("no pre-auth key");
    expect(describeAgentError({ reason: "netns unavailable" })).toBe("netns unavailable");
  });

  test("looks inside a nested error", () => {
    expect(describeAgentError({ error: { message: "connection refused" } })).toBe(
      "connection refused",
    );
  });

  test("falls back to JSON for shapes it does not know", () => {
    expect(describeAgentError({ code: 13, status: "unavailable" })).toBe(
      '{"code":13,"status":"unavailable"}',
    );
    expect(describeAgentError({})).toBe("{}");
  });

  test("handles primitives and nothing", () => {
    expect(describeAgentError(undefined)).toBe("");
    expect(describeAgentError(null)).toBe("");
    expect(describeAgentError(42)).toBe("42");
  });

  test("survives a circular object", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    expect(describeAgentError(circular)).toBe("[object Object]");
  });

  test("truncates very long messages", () => {
    const long = "x".repeat(MAX_AGENT_ERROR_LENGTH + 500);
    const described = describeAgentError(long);

    expect(described.length).toBe(MAX_AGENT_ERROR_LENGTH);
    expect(described.endsWith("…")).toBe(true);
  });
});
