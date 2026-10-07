import { timingSafeEqual } from "node:crypto";
import { versions } from "node:process";

import { data } from "react-router";

import { appConfigContext, headscaleContext } from "~/server/context";

import type { Route } from "./+types/info";

export async function loader({ request, context }: Route.LoaderArgs) {
  const config = context.get(appConfigContext);
  const headscale = context.get(headscaleContext);

  if (config.server.info_secret == null) {
    throw data(
      {
        status: "Forbidden",
      },
      403,
    );
  }

  const bearer = request.headers.get("Authorization") ?? "";
  if (!bearer.startsWith("Bearer ")) {
    throw data(
      {
        status: "Unauthorized",
      },
      401,
    );
  }

  const token = bearer.slice("Bearer ".length).trim();

  // Compare in constant time, the same way the session tokens are checked in
  // `app/server/web/auth.ts`. `timingSafeEqual` throws when the lengths differ,
  // so the length is compared first (the length itself is not a secret).
  const expected = Buffer.from(config.server.info_secret, "utf8");
  const provided = Buffer.from(token, "utf8");
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    throw data(
      {
        status: "Forbidden",
      },
      403,
    );
  }

  const healthy = await headscale.health();

  const body = {
    status: healthy ? "healthy" : "unhealthy",
    headplane_version: __VERSION__,
    headscale_canonical_version: healthy ? headscale.version.raw : "unknown",
    internal_versions: {
      node: versions.node,
      v8: versions.v8,
      uv: versions.uv,
      zlib: versions.zlib,
      openssl: versions.openssl,
      libc: versions.libc,
    },
  };

  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
    },
  });
}
