import { describe, expect, test } from "vitest";

import { loader } from "~/routes/util/info";
import { appConfigContext, headscaleContext } from "~/server/context";

// The loader reads only two context entries, so it can be driven directly
// instead of through the config file and the database that `~/server/context`
// wires up in production. The statuses below are the ones `data()` throws
// (`init.status`), not a Response.

const SECRET = "info-secret-value";

function load(infoSecret: unknown, authorization?: string) {
  const request = new Request("http://headplane.test/api/info", {
    headers: authorization === undefined ? {} : { Authorization: authorization },
  });

  const context = {
    get: (key: unknown) => {
      if (key === appConfigContext) {
        return { server: { info_secret: infoSecret } };
      }

      if (key === headscaleContext) {
        return { health: () => Promise.resolve(true), version: { raw: "0.26.0" } };
      }

      return undefined;
    },
  };

  return loader({ request, context, params: {} } as Parameters<typeof loader>[0]);
}

describe("GET /api/info authorization", () => {
  test("refuses a wrong token of the same length", async () => {
    await expect(load(SECRET, `Bearer ${"x".repeat(SECRET.length)}`)).rejects.toMatchObject({
      init: { status: 403 },
    });
  });

  test("refuses a wrong token of a different length without throwing", async () => {
    await expect(load(SECRET, "Bearer short")).rejects.toMatchObject({ init: { status: 403 } });
  });

  test("requires the Bearer scheme", async () => {
    await expect(load(SECRET)).rejects.toMatchObject({ init: { status: 401 } });
    await expect(load(SECRET, SECRET)).rejects.toMatchObject({ init: { status: 401 } });
  });

  test("refuses everything when no secret is configured", async () => {
    await expect(load(null, `Bearer ${SECRET}`)).rejects.toMatchObject({ init: { status: 403 } });
  });

  test("accepts the configured secret", async () => {
    const response = (await load(SECRET, `Bearer ${SECRET}`)) as Response;

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      status: string;
      headplane_version: string;
      headscale_canonical_version: string;
    };
    expect(body.status).toBe("healthy");
    expect(body.headplane_version).toBe(__VERSION__);
    expect(body.headscale_canonical_version).toBe("0.26.0");
  });
});
