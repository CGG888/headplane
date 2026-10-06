import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { dump } from "js-yaml";
import { afterEach, beforeEach, describe, expect, test } from "vitest";

import { loginOidcAction } from "~/routes/settings/login/actions";
import { createAuditStore, createMemoryAuditStorage } from "~/server/audit/store";
import { appConfigContext, auditContext, authContext } from "~/server/context";
import { loginOidcPath } from "~/server/headplane-store/login-oidc";
import { Capabilities } from "~/server/web/roles";

import { clearFakeFiles, createFakeFile } from "../setup/overlay-fs";

const CONFIG_PATH = "/config/login-oidc-action.yaml";
const SECRET = "top-secret-value";

interface ActionResult {
  data: unknown;
  init?: { status?: number } | null;
}

interface MockPermissions {
  write?: boolean;
}

function mockFormData(entries: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    formData.set(key, value);
  }

  return formData;
}

function mockRequest(formData: FormData): Request {
  return { formData: () => Promise.resolve(formData) } as unknown as Request;
}

function createMockContext(dataPath: string, permissions: MockPermissions = {}) {
  const write = permissions.write ?? true;
  const audit = createAuditStore(createMemoryAuditStorage());

  return {
    audit,
    context: {
      get: (context: unknown) => {
        if (context === authContext) {
          return {
            require: () =>
              Promise.resolve({ id: 1, profile: { name: "Tester", email: "t@example.com" } }),
            can: (_principal: unknown, capability: number) =>
              capability === Capabilities.configure_iam ? write : false,
          };
        }

        if (context === appConfigContext) {
          return {
            server: { data_path: dataPath, base_url: "https://headplane.example.com" },
            oidc: {},
          };
        }

        if (context === auditContext) {
          return audit;
        }

        return undefined;
      },
    },
  };
}

async function submit(
  dataPath: string,
  entries: Record<string, string>,
  permissions?: MockPermissions,
) {
  const mock = createMockContext(dataPath, permissions);
  let result: ActionResult;

  try {
    result = (await loginOidcAction({
      request: mockRequest(mockFormData(entries)),
      context: mock.context,
      params: {},
    } as never)) as ActionResult;
  } catch (thrown) {
    result = thrown as ActionResult;
  }

  return { result, entries: await mock.audit.list() };
}

function dataOf<T>(result: ActionResult): T {
  return result.data as T;
}

describe("console login settings action", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "headplane-login-oidc-action-"));
    clearFakeFiles();
    delete process.env.HEADPLANE_OIDC__ISSUER;
    delete process.env.HEADPLANE_OIDC__CLIENT_SECRET;
    process.env.HEADPLANE_CONFIG_PATH = CONFIG_PATH;
    createFakeFile(
      CONFIG_PATH,
      dump({
        headscale: { url: "http://headscale:8080" },
        server: { cookie_secret: "thirtytwo-character-cookiesecret" },
        oidc: {
          enabled: true,
          issuer: "https://file.example.com",
          client_id: "file-client",
          client_secret: "file-secret",
          scope: "openid profile email",
        },
      }),
    );
  });

  afterEach(async () => {
    clearFakeFiles();
    delete process.env.HEADPLANE_CONFIG_PATH;
    delete process.env.HEADPLANE_OIDC__ISSUER;
    delete process.env.HEADPLANE_OIDC__CLIENT_SECRET;
    await rm(dir, { recursive: true, force: true });
  });

  test("a viewer without the IAM capability is refused", async () => {
    const { result, entries } = await submit(
      dir,
      { action_id: "save", issuer: "https://saved.example.com" },
      { write: false },
    );

    expect(result.init?.status).toBe(403);
    expect(dataOf<{ success: boolean; errorCode: string }>(result)).toEqual({
      success: false,
      errorCode: "forbidden",
    });
    expect(entries.entries).toEqual([]);
  });

  test("an unknown action id is rejected", async () => {
    const { result } = await submit(dir, { action_id: "nonsense" });

    expect(dataOf<{ success: boolean; errorCode: string }>(result).errorCode).toBe("invalidAction");
  });

  test("a save is audited by field name, never by value", async () => {
    const { result, entries } = await submit(dir, {
      action_id: "save",
      issuer: "https://saved.example.com",
      scope: "openid",
      client_secret: SECRET,
      clear_client_secret: "false",
    });

    expect(dataOf<{ success: boolean; kind: string; changed: string[] }>(result)).toMatchObject({
      success: true,
      kind: "save",
      changed: ["issuer", "client_secret", "scope"],
    });

    expect(entries.entries).toHaveLength(1);
    expect(entries.entries[0].action).toBe("login_oidc.update");
    expect(entries.entries[0].target).toBe("console_login");
    expect(entries.entries[0].detail).toContain("issuer");
    expect(entries.entries[0].detail).toContain("client_secret");
    expect(JSON.stringify(entries.entries)).not.toContain(SECRET);
  });

  test("an empty secret field keeps the stored secret", async () => {
    await submit(dir, { action_id: "save", client_secret: SECRET, clear_client_secret: "false" });

    const { result } = await submit(dir, {
      action_id: "save",
      scope: "openid",
      client_secret: "",
      clear_client_secret: "false",
    });

    expect(dataOf<{ success: boolean; changed: string[] }>(result)).toMatchObject({
      success: true,
      changed: ["scope"],
    });

    const stored = await import("node:fs/promises").then((fs) =>
      fs.readFile(loginOidcPath(dir), "utf8"),
    );
    expect(stored).toContain(SECRET);
  });

  test("the confirmation the lockout rail asks for is reported, not written", async () => {
    const { result } = await submit(dir, { action_id: "save", enabled: "false" });

    expect(
      dataOf<{ success: boolean; errorCode: string; reasons: string[] }>(result),
    ).toMatchObject({
      success: false,
      errorCode: "confirmationRequired",
      reasons: ["oidcDisabled"],
    });
  });

  test("the self-test evaluates the saved configuration and carries no secret", async () => {
    // A hand-written document, as a restart would read it: the saved issuer is
    // not the file's, so the report proves the merged value was used.
    await writeFile(
      loginOidcPath(dir),
      JSON.stringify({ version: 1, settings: { issuer: "not-a-url", client_secret: SECRET } }),
      "utf8",
    );

    const { result } = await submit(dir, { action_id: "self_test" });
    const data = dataOf<{
      success: boolean;
      kind: string;
      report: { checks: { id: string; status: string; detail?: string }[] };
    }>(result);

    expect(data.success).toBe(true);
    expect(data.kind).toBe("self_test");

    const discovery = data.report.checks.find((check) => check.id === "discovery");
    expect(discovery?.status).toBe("fail");
    expect(discovery?.detail).toBe("not-a-url");
    expect(JSON.stringify(data)).not.toContain(SECRET);
  });
});
