import { createReadStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync, backup } from "node:sqlite";
import { Readable } from "node:stream";

import log from "~/utils/log";

/**
 * Headplane's own data, as opposed to the Headscale configuration the
 * snapshots in this directory copy. The copy is always made by SQLite itself:
 * streaming the live file would hand out whatever a concurrent write happened
 * to leave behind.
 */

/** SQLite file Headplane keeps in `server.data_path`. */
export const HEADPLANE_DB_FILE = "hp_persist.db";

/** Absolute path of Headplane's own database. */
export function headplaneDatabasePath(dataPath: string): string {
  return resolve(dataPath, HEADPLANE_DB_FILE);
}

/** `headplane-data-YYYYMMDD-HHMMSS.sqlite`, stamped in UTC like snapshot ids. */
export function dataBackupFileName(at: Date): string {
  const iso = at.toISOString();
  const date = `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}`;
  const time = `${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}`;

  return `headplane-data-${date}-${time}.sqlite`;
}

/** Error codes the download route turns into a localized message. */
export type DataBackupErrorCode = "copyFailed" | "unavailable";

/**
 * How long a copy may sit on disk when its download is never consumed at all.
 * A caller that forgets the body would otherwise leave the database copy — and
 * the OIDC ID tokens in it — behind for as long as the process lives.
 */
const DATA_BACKUP_ABANDONED_MS = 15 * 60 * 1000;

export class DataBackupError extends Error {
  readonly code: DataBackupErrorCode;

  constructor(code: DataBackupErrorCode, message?: string) {
    super(message ?? code);
    this.name = "DataBackupError";
    this.code = code;
  }
}

export function isDataBackupError(error: unknown): error is DataBackupError {
  return error instanceof DataBackupError;
}

/** A finished copy, living in a temporary file until it is streamed out. */
export interface DataBackup {
  /** Absolute path of the temporary copy. */
  path: string;
  fileName: string;
  size: number;
  /** Streams the copy and deletes the temporary file once the stream closes. */
  stream(): ReadableStream<Uint8Array>;
  /** Deletes the temporary file. Safe to call more than once. */
  dispose(): Promise<void>;
}

export interface DataBackupOptions {
  /** Absolute path of the live database to copy. */
  dbPath: string;
  /** Directory the temporary copy goes into; the system temp directory by default. */
  directory?: string;
  clock?: () => Date;
  /** How long an unconsumed download keeps its copy; the default is generous. */
  abandonedMs?: number;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Copies Headplane's database into a temporary file with SQLite's own backup
 * API, so the copy is consistent while Headplane keeps serving requests. The
 * caller owns the result and either streams it (which disposes of it) or
 * disposes of it directly; no temporary file survives either path, including
 * when the copy itself fails.
 */
export async function createDataBackup(options: DataBackupOptions): Promise<DataBackup> {
  const source = resolve(options.dbPath);
  const at = (options.clock ?? (() => new Date()))();
  const fileName = dataBackupFileName(at);

  // Opening a missing path with SQLite creates an empty database, so the source
  // is checked before anything is opened or copied.
  try {
    const info = await stat(source);
    if (!info.isFile()) {
      throw new DataBackupError("copyFailed", `${source} is not a regular file`);
    }
  } catch (error) {
    if (error instanceof DataBackupError) {
      throw error;
    }

    throw new DataBackupError("copyFailed", `Cannot read ${source}: ${messageOf(error)}`);
  }

  let directory: string;
  try {
    directory = await mkdtemp(join(options.directory ?? tmpdir(), "headplane-data-"));
  } catch (error) {
    throw new DataBackupError(
      "unavailable",
      `Cannot create a temporary directory for the copy: ${messageOf(error)}`,
    );
  }

  const path = join(directory, fileName);
  try {
    const database = new DatabaseSync(source);
    try {
      await backup(database, path);
    } finally {
      database.close();
    }

    const info = await stat(path);
    if (info.size === 0) {
      throw new Error("the copy is empty");
    }

    let disposed = false;
    const dispose = async () => {
      if (disposed) {
        return;
      }

      disposed = true;
      try {
        await rm(directory, { recursive: true, force: true });
      } catch (error) {
        log.warn(
          "config",
          "Cannot remove the temporary data backup in %s: %s",
          directory,
          messageOf(error),
        );
      }
    };

    return {
      path,
      fileName,
      size: info.size,
      stream: () => {
        const file = createReadStream(path);
        // A download that is abandoned half way still has to take its copy with
        // it, so cleanup hangs off the stream closing either way. Cancelling the
        // web stream destroys the file stream (and so closes it), while a read
        // failure destroys it without a normal end, hence both handlers.
        let finished = false;
        const finish = () => {
          if (finished) {
            return;
          }

          finished = true;
          clearTimeout(abandoned);
          file.destroy();
          void dispose();
        };

        // A stream nobody ever reads is never closed by the runtime, so its copy
        // would sit on disk until the process exits. This fallback only fires
        // while not a single byte has been read, so a download that is merely
        // slow keeps its file, and it is cleared the moment the stream finishes.
        const abandoned = setTimeout(() => {
          if (!finished && file.bytesRead === 0) {
            finish();
          }
        }, options.abandonedMs ?? DATA_BACKUP_ABANDONED_MS);
        abandoned.unref?.();

        file.once("close", finish);
        file.once("error", finish);

        return Readable.toWeb(file) as ReadableStream<Uint8Array>;
      },
      dispose,
    };
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    throw new DataBackupError("copyFailed", `Cannot copy ${source}: ${messageOf(error)}`);
  }
}
