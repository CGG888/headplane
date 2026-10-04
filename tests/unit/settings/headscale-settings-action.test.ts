import { describe, expect, test, vi } from "vitest";

import {
  authContext,
  headscaleConfigContext,
  headscaleContext,
  integrationContext,
} from "~/server/context";

function mockFormData(entries: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    formData.set(key, value);
  }
  return formData;
}

function mockRequest(formData: FormData): Request {
  return {
    formData: () => Promise.resolve(formData),
  } as unknown as Request;
}

interface SubmitOptions {
  allowed?: boolean;
  writable?: boolean;
}

interface ActionResult {
  data: unknown;
  init?: { status?: number } | null;
}

const onConfigChange = vi.fn().mockResolvedValue(undefined);

// React Router delivers context values through context.get(contextKey), so the
// mock answers whichever key the action asks for.
function createMockContext(options: SubmitOptions, patch: ReturnType<typeof vi.fn>) {
  return {
    get: (context: unknown) => {
      if (context === authContext) {
        return {
          require: () => Promise.resolve({ id: 1 }),
          can: () => options.allowed ?? true,
        };
      }

      if (context === headscaleConfigContext) {
        return {
          writable: () => options.writable ?? true,
          patch,
          getTailnetSettings: () => ({ policyMode: "file", policyPath: "", trustedProxies: [] }),
        };
      }

      if (context === headscaleContext) {
        return { config: {} };
      }

      if (context === integrationContext) {
        return { onConfigChange };
      }

      return undefined;
    },
  };
}

async function submit(entries: Record<string, string>, options: SubmitOptions = {}) {
  const { headscaleSettingsAction } = await import("~/routes/settings/headscale/actions");

  const patch = vi.fn().mockResolvedValue(undefined);
  onConfigChange.mockClear();

  let result: ActionResult;
  try {
    result = (await headscaleSettingsAction({
      request: mockRequest(mockFormData(entries)),
      context: createMockContext(options, patch),
      params: {},
    } as never)) as ActionResult;
  } catch (thrown) {
    // Rejections can come back as thrown data() payloads, which carry the same
    // shape as a returned one.
    result = thrown as ActionResult;
  }

  return { result, patch };
}

function statusOf(result: ActionResult): number {
  return result.init?.status ?? 200;
}

function errorCodeOf(result: ActionResult): string | undefined {
  if (result.data && (result.data as { success: boolean }).success) {
    return undefined;
  }

  return (result.data as { errorCode: string } | undefined)?.errorCode;
}

describe("Headscale advanced settings action", () => {
  test("saves the node lifecycle fields with their dotted paths", async () => {
    const { result, patch } = await submit({
      action_id: "save_node_settings",
      node_expiry: "720h",
      ephemeral_inactivity_timeout: "30m",
    });

    expect(statusOf(result)).toBe(200);
    expect((result.data as { success: boolean }).success).toBe(true);
    expect(patch).toHaveBeenCalledWith([
      { path: "node.expiry", value: "720h" },
      { path: "node.ephemeral.inactivity_timeout", value: "30m" },
    ]);
    expect(onConfigChange).toHaveBeenCalledOnce();
  });

  test("accepts 0 as node.expiry meaning nodes never expire", async () => {
    const { result, patch } = await submit({
      action_id: "save_node_settings",
      node_expiry: "0",
      ephemeral_inactivity_timeout: "120s",
    });

    expect(statusOf(result)).toBe(200);
    expect(patch).toHaveBeenCalledWith([
      { path: "node.expiry", value: "0" },
      { path: "node.ephemeral.inactivity_timeout", value: "120s" },
    ]);
  });

  test("rejects an expiry Headscale cannot parse", async () => {
    const { result, patch } = await submit({
      action_id: "save_node_settings",
      node_expiry: "never",
      ephemeral_inactivity_timeout: "30m",
    });

    expect(statusOf(result)).toBe(400);
    expect(errorCodeOf(result)).toBe("invalidNodeExpiry");
    expect(patch).not.toHaveBeenCalled();
  });

  test("rejects an inactivity timeout Go cannot parse", async () => {
    // `d` is valid for node.expiry but not for Go's time.ParseDuration.
    const { result, patch } = await submit({
      action_id: "save_node_settings",
      node_expiry: "0",
      ephemeral_inactivity_timeout: "2d",
    });

    expect(statusOf(result)).toBe(400);
    expect(errorCodeOf(result)).toBe("invalidEphemeralInactivity");
    expect(patch).not.toHaveBeenCalled();
  });

  test("rejects an inactivity timeout below the 65s floor", async () => {
    const { result, patch } = await submit({
      action_id: "save_node_settings",
      node_expiry: "0",
      ephemeral_inactivity_timeout: "60s",
    });

    expect(statusOf(result)).toBe(400);
    expect(errorCodeOf(result)).toBe("invalidEphemeralInactivity");
    expect(patch).not.toHaveBeenCalled();
  });

  test("saves the whitelisted log settings", async () => {
    const { result, patch } = await submit({
      action_id: "save_log_settings",
      log_level: "warn",
      log_format: "json",
    });

    expect(statusOf(result)).toBe(200);
    expect(patch).toHaveBeenCalledWith([
      { path: "log.level", value: "warn" },
      { path: "log.format", value: "json" },
    ]);
    expect(onConfigChange).toHaveBeenCalledOnce();
  });

  test("rejects a log level outside the whitelist", async () => {
    const { result, patch } = await submit({
      action_id: "save_log_settings",
      log_level: "trace",
      log_format: "text",
    });

    expect(statusOf(result)).toBe(400);
    expect(errorCodeOf(result)).toBe("invalidLogLevel");
    expect(patch).not.toHaveBeenCalled();
  });

  test("rejects a log format outside the whitelist", async () => {
    const { result, patch } = await submit({
      action_id: "save_log_settings",
      log_level: "info",
      log_format: "yaml",
    });

    expect(statusOf(result)).toBe(400);
    expect(errorCodeOf(result)).toBe("invalidLogFormat");
    expect(patch).not.toHaveBeenCalled();
  });

  test("saves explicit booleans and inverts the update check", async () => {
    const { result, patch } = await submit({
      action_id: "save_feature_settings",
      taildrop_enabled: "false",
      auto_update_enabled: "true",
      logtail_enabled: "true",
      check_updates: "false",
    });

    expect(statusOf(result)).toBe(200);
    expect(patch).toHaveBeenCalledWith([
      { path: "taildrop.enabled", value: false },
      { path: "auto_update.enabled", value: true },
      { path: "logtail.enabled", value: true },
      // The switch reads as the opt-in, Headscale stores the opt-out.
      { path: "disable_check_updates", value: true },
    ]);
    expect(onConfigChange).toHaveBeenCalledOnce();
  });

  test("rejects a switch that does not submit true or false", async () => {
    const { result, patch } = await submit({
      action_id: "save_feature_settings",
      taildrop_enabled: "on",
      auto_update_enabled: "false",
      logtail_enabled: "false",
      check_updates: "true",
    });

    expect(statusOf(result)).toBe(400);
    expect(errorCodeOf(result)).toBe("invalidBooleanValue");
    expect(patch).not.toHaveBeenCalled();
  });

  test("refuses to save without the IAM capability or a writable config", async () => {
    const denied = await submit(
      { action_id: "save_log_settings", log_level: "info", log_format: "text" },
      { allowed: false },
    );
    expect(statusOf(denied.result)).toBe(403);
    expect(denied.patch).not.toHaveBeenCalled();

    const readOnly = await submit(
      { action_id: "save_log_settings", log_level: "info", log_format: "text" },
      { writable: false },
    );
    expect(statusOf(readOnly.result)).toBe(403);
    expect(readOnly.patch).not.toHaveBeenCalled();
  });
});
