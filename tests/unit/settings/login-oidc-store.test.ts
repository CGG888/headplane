import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test } from "vitest";

import {
  emptyLoginOidcDocument,
  LOGIN_OIDC_DOCUMENT_VERSION,
  LOGIN_OIDC_FILE,
  LOGIN_OIDC_FILE_MODE,
  loginOidcPath,
  parseLoginOidcDocument,
  readLoginOidcDocument,
  serializeLoginOidcDocument,
  writeLoginOidcSettings,
} from "~/server/headplane-store/login-oidc";

describe("console login override store", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "headplane-login-oidc-store-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("the document lives beside the other Headplane state", () => {
    expect(LOGIN_OIDC_FILE).toBe("login-oidc.json");
    expect(loginOidcPath(dir)).toBe(join(dir, LOGIN_OIDC_FILE));
  });

  test("a saved document is written, replaced and read back", async () => {
    expect(await writeLoginOidcSettings(dir, { issuer: "https://idp.example.com" })).toBe(true);
    expect(await writeLoginOidcSettings(dir, { issuer: "https://other.example.com" })).toBe(true);

    const document = await readLoginOidcDocument(dir);
    expect(document.version).toBe(LOGIN_OIDC_DOCUMENT_VERSION);
    expect(document.settings).toEqual({ issuer: "https://other.example.com" });
    expect(typeof document.updated_at).toBe("string");
  });

  test("the write is atomic: no temporary file is left behind", async () => {
    await writeLoginOidcSettings(dir, { scope: "openid" });

    const leftovers = (await readdir(dir)).filter((name) => name.endsWith(".tmp"));
    expect(leftovers).toEqual([]);
    expect(await readdir(dir)).toEqual([LOGIN_OIDC_FILE]);
  });

  test("the document is created with mode 0600", async () => {
    await writeLoginOidcSettings(dir, { client_secret: "a-client-secret" });

    const info = await stat(loginOidcPath(dir));
    expect(info.isFile()).toBe(true);

    // Windows has no POSIX permission bits: Node maps `mode` onto the
    // read-only flag only, so the exact bits are only observable on POSIX.
    if (process.platform === "win32") {
      return;
    }

    expect(info.mode & 0o777).toBe(LOGIN_OIDC_FILE_MODE);
  });

  test("a corrupt document reads as nothing saved", async () => {
    await writeFile(loginOidcPath(dir), "{ not json", "utf8");

    expect(await readLoginOidcDocument(dir)).toEqual(emptyLoginOidcDocument());
    expect(parseLoginOidcDocument("[1,2,3]").settings).toEqual({});
  });

  test("a missing document reads as nothing saved", async () => {
    expect(await readLoginOidcDocument(join(dir, "nested", "missing"))).toEqual(
      emptyLoginOidcDocument(),
    );
  });

  test("a hand-written document keeps only the editable fields", () => {
    const parsed = parseLoginOidcDocument(
      JSON.stringify({
        settings: {
          issuer: "https://idp.example.com",
          client_id: "client",
          irrelevant: true,
          enabled: "yes",
          scope: "openid",
        },
      }),
    );

    expect(parsed.settings).toEqual({
      issuer: "https://idp.example.com",
      client_id: "client",
      scope: "openid",
    });
  });

  test("serialization is stable, human-editable JSON", () => {
    const text = serializeLoginOidcDocument({ version: 1, settings: { enabled: false } });

    expect(text.endsWith("\n")).toBe(true);
    expect(JSON.parse(text)).toEqual({ version: 1, settings: { enabled: false } });
  });

  test("a document that cannot be written reports false instead of throwing", async () => {
    const blocker = join(dir, "blocked");
    await writeFile(blocker, "not a directory", "utf8");

    expect(await writeLoginOidcSettings(blocker, { scope: "openid" })).toBe(false);
    // The failure never leaves a temporary file next to the blocker either.
    expect(await readFile(blocker, "utf8")).toBe("not a directory");
  });
});
