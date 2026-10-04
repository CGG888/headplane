import { describe, expect, test } from "vitest";

import { allowedActionOrigins } from "~/server/allowed-origins";

describe("allowed action origins", () => {
  test("keeps the origins react-router already allows", () => {
    expect(allowedActionOrigins(["existing.example.com"])).toEqual(["existing.example.com"]);
  });

  test("turns base_url into a host", () => {
    expect(allowedActionOrigins([], "https://headplane.example.com:8443/admin")).toEqual([
      "headplane.example.com:8443",
    ]);
  });

  test("accepts bare hosts and drops empties", () => {
    expect(
      allowedActionOrigins(undefined, "internal.example.com:4100", undefined, null, ""),
    ).toEqual(["internal.example.com:4100"]);
  });

  test("does not duplicate hosts", () => {
    expect(
      allowedActionOrigins(
        ["headplane.example.com:8443"],
        "https://headplane.example.com:8443/admin",
        "headplane.example.com:8443",
      ),
    ).toEqual(["headplane.example.com:8443"]);
  });
});
