import { data } from "react-router";

import { authContext, snapshotContext } from "~/server/context";
import { isSnapshotError } from "~/server/snapshots/types";
import { Capabilities } from "~/server/web/roles";

import type { Route } from "./+types/download";

/** Strips anything the browser would choke on in a Content-Disposition header. */
function attachmentName(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9._-]/g, "_");
  return cleaned.length > 0 ? cleaned : "snapshot";
}

/**
 * Resource route that streams one file out of a snapshot. It lives outside the
 * application layout so a download never renders (or revalidates) the UI.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const auth = context.get(authContext);
  const snapshots = context.get(snapshotContext);

  const principal = await auth.require(request);
  if (!auth.can(principal, Capabilities.configure_iam)) {
    throw data({ localized: { key: "errors.permission.viewIam" } }, { status: 403 });
  }

  const params = new URL(request.url).searchParams;
  const id = params.get("id") ?? "";
  const file = params.get("file") ?? "";

  try {
    const { file: entry, content } = await snapshots.read(id, file);
    return new Response(new Uint8Array(content), {
      headers: {
        "Content-Type": "text/yaml; charset=utf-8",
        "Content-Disposition": `attachment; filename="${attachmentName(entry.name)}"`,
        "Content-Length": String(content.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (isSnapshotError(error) && error.code === "notFound") {
      throw data({ localized: { key: "errors.generic.requestFailed" } }, { status: 404 });
    }

    throw data({ localized: { key: "errors.generic.requestFailed" } }, { status: 400 });
  }
}
