import { Download } from "lucide-react";

import { useI18n } from "~/i18n/provider";
import type { SnapshotMeta } from "~/server/snapshots/types";

import RestoreSnapshot from "./dialogs/restore-snapshot";
import { formatBytes, REASON_KEYS } from "./labels";

interface SnapshotRowProps {
  snapshot: SnapshotMeta;
}

export default function SnapshotRow({ snapshot }: SnapshotRowProps) {
  const { t, locale } = useI18n();
  const takenAt = new Date(snapshot.at).toLocaleString(locale);
  const reason = REASON_KEYS[snapshot.reason] ? t(REASON_KEYS[snapshot.reason]) : snapshot.reason;

  return (
    <div className="flex w-full flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="font-medium">{takenAt}</span>
        <span className="text-sm opacity-80">{reason}</span>
        <div className="flex flex-wrap items-center gap-3 text-xs">
          {snapshot.files.map((file) => (
            <a
              className="inline-flex items-center gap-1 text-indigo-600 hover:underline dark:text-indigo-400"
              download={file.name}
              href={`/settings/snapshots/download?${new URLSearchParams({
                id: snapshot.id,
                file: file.name,
              }).toString()}`}
              key={file.name}
            >
              <Download className="h-3.5 w-3.5" />
              {file.name}
              <span className="opacity-70">({formatBytes(file.size)})</span>
            </a>
          ))}
        </div>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-2">
        <span className="text-xs opacity-60">
          {t("settings.snapshots.totalSize", { size: formatBytes(snapshot.totalSize) })}
        </span>
        <RestoreSnapshot snapshot={snapshot} />
      </div>
    </div>
  );
}
