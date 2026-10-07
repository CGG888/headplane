import { describe, expect, test } from "vitest";

import { parseRoute, parseStatus } from "~/routes/machines/hooks/use-machine-filter-params";

// The values come from the query string, so they have to be checked against the
// known filters instead of being asserted into the filter type: an unknown value
// used to reach the machine list and be looked up on `String.prototype`
// (`?status=constructor`) or throw while formatting.

describe("machine filter params", () => {
  test("keeps the statuses the list knows about", () => {
    expect(parseStatus("online")).toBe("online");
    expect(parseStatus("offline")).toBe("offline");
    expect(parseStatus("expired")).toBe("expired");
  });

  test("treats anything else as no filter", () => {
    for (const raw of [null, "", "Online", "online ", "superuser", "constructor", "toString"]) {
      expect(parseStatus(raw)).toBeNull();
    }
  });

  test("keeps the routes the list knows about", () => {
    expect(parseRoute("exit-node")).toBe("exit-node");
    expect(parseRoute("subnet")).toBe("subnet");
  });

  test("treats anything else as no route filter", () => {
    for (const raw of [null, "", "exit_node", "subnet ", "constructor", "valueOf"]) {
      expect(parseRoute(raw)).toBeNull();
    }
  });
});
