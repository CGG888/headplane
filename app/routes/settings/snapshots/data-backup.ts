import { data } from "react-router";

import { appConfigContext, authContext } from "~/server/context";
import {
  createDataBackup,
  type DataBackup,
  headplaneDatabasePath,
  isDataBackupError,
} from "~/server/snapshots/data-backup.server";
import { Capabilities } from "~/server/web/roles";

import type { Route } from "./+types/data-backup";
import { DATA_BACKUP_ERROR_KEYS } from "./error-keys";

/**
 * Resource route that streams a copy of Headplane's own database. It sits
 * outside the application layout, like the configuration snapshot download, so
 * a download never renders (or revalidates) the UI around it.
 */
export async function loader({ request, context }: Route.LoaderArgs) {
  const auth = context.get(authContext);
  const config = context.get(appConfigContext);

  const principal = await auth.require(request);
  // Taking Headplane's data off the server is guarded like the writes on the
  // snapshots page: it is not a read-only privilege.
  if (!auth.can(principal, Capabilities.configure_iam)) {
    throw data({ localized: { key: "errors.permission.modifyIam" } }, { status: 403 });
  }

  let backup: DataBackup | undefined;
  let handedOff = false;
  try {
    const created = await createDataBackup({
      dbPath: headplaneDatabasePath(config.server.data_path),
    });
    backup = created;

    // The copy (which carries the OIDC ID tokens in the database) only has a
    // reason to exist while the download is alive. `dispose` is idempotent, so
    // it runs either from here when the request is aborted before the body is
    // consumed, or from the stream closing after a normal download.
    if (request.signal.aborted) {
      await created.dispose();
    } else {
      request.signal.addEventListener("abort", () => void created.dispose(), { once: true });
    }

    const body = created.stream();
    handedOff = true;
    return new Response(body, {
      headers: {
        "Content-Type": "application/vnd.sqlite3",
        "Content-Disposition": `attachment; filename="${created.fileName}"`,
        "Content-Length": String(created.size),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (isDataBackupError(error)) {
      throw data({ localized: { key: DATA_BACKUP_ERROR_KEYS[error.code] } }, { status: 500 });
    }

    throw data({ localized: { key: "errors.generic.requestFailed" } }, { status: 500 });
  } finally {
    // A response that never reached the client must not leave its copy behind:
    // once the body is handed over the stream owns the cleanup, but a throw
    // before that (or a request that was already aborted) does not.
    if (!handedOff) {
      await backup?.dispose();
    }
  }
}
