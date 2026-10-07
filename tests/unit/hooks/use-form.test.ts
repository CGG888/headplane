import { type } from "arktype";
import { describe, expect, test } from "vitest";

import { buildInitialValues } from "~/hooks/use-form";

// The form seeds its values once, when it mounts; the seeding rules live in
// this pure helper so they can be pinned down without rendering the hook.

const schema = type({
  name: "string",
  port: "number",
  "enabled?": "boolean",
});

describe("form default values", () => {
  test("every field the schema declares is seeded, blank when it has no default", () => {
    const values = buildInitialValues(schema, { name: "gateway" });

    expect(values).toEqual({ name: "gateway", port: "", enabled: "" });
  });

  test("a default keeps its own type instead of being stringified", () => {
    const values = buildInitialValues(schema, { port: 8080, enabled: false });

    expect(values.port).toBe(8080);
    expect(values.enabled).toBe(false);
  });

  test("a default for a field the schema does not have is dropped", () => {
    // A wider object than the schema (a caller can always hold one): only the
    // schema's own keys may reach the seeded values.
    const defaults = { name: "gateway", typo: "ignored" };
    const values = buildInitialValues(schema, defaults);

    expect(values).toEqual({ name: "gateway", port: "", enabled: "" });
    expect("typo" in values).toBe(false);
  });

  test("a null default is kept as null, not turned into a blank string", () => {
    const values = buildInitialValues(schema, { name: null as unknown as string });

    expect(values.name).toBeNull();
  });

  test("no defaults leaves every field blank", () => {
    expect(buildInitialValues(schema)).toEqual({ name: "", port: "", enabled: "" });
  });
});
