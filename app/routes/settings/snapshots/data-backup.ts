import { data } from "react-router";

import { appConfigContext, authContext } from "~/server/context";
import {
  createDataBackup,
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

  try {
    const backup = await createDataBackup({
      dbPath: headplaneDatabasePath(config.server.data_path),
    });

    return new Response(backup.stream(), {
      headers: {
        "Content-Type": "application/vnd.sqlite3",
        "Content-Disposition": `attachment; filename="${backup.fileName}"`,
        "Content-Length": String(backup.size),
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    if (isDataBackupError(error)) {
      throw data({ localized: { key: DATA_BACKUP_ERROR_KEYS[error.code] } }, { status: 500 });
    }

    throw data({ localized: { key: "errors.generic.requestFailed" } }, { status: 500 });
  }
}
