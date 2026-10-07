import { describe, expect, test, vi } from "vitest";

vi.mock("~/utils/log", () => ({
  default: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { DEFAULT_ALERT_SETTINGS } from "~/server/alerts/settings";
import type { AlertSettings } from "~/server/alerts/types";
import { alertsContext, authContext } from "~/server/context";
import { capsForRole, type Role } from "~/server/web/roles";

const STORED: AlertSettings = {
  ...DEFAULT_ALERT_SETTINGS,
  enabled: true,
  webhookUrl: "https://hooks.example.com/alert",
  secret: "s3cret-token",
};

/** The real route loader, with the auth service replaced by the role table. */
async function callLoader(role: Role = "admin") {
  const { loader } = await import("~/routes/settings/notifications/overview");
  const capabilities = capsForRole(role);

  const context = {
    get: (key: unknown) => {
      if (key === authContext) {
        return {
          require: () => Promise.resolve({ kind: "oidc", role }),
          can: (_principal: unknown, capability: number) =>
            (capability & capabilities) === capability,
        };
      }

      if (key === alertsContext) {
        return {
          ready: () => Promise.resolve(),
          settings: () => STORED,
          history: () => [],
        };
      }

      return undefined;
    },
  };

  return (await loader({
    request: new Request("http://localhost/settings/notifications"),
    context,
    params: {},
  } as never)) as { settings: AlertSettings; history: unknown[] };
}

describe("notification settings loader", () => {
  test("the webhook secret is never sent to the browser", async () => {
    const result = await callLoader();

    expect(STORED.secret).toBe("s3cret-token");
    // The form still gets everything else, so the secret can stay untouched.
    expect(result.settings).toEqual({ ...STORED, secret: "" });
    expect(JSON.stringify(result)).not.toContain(STORED.secret);
  });
});
