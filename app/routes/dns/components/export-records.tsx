import Button from "~/components/button";
import { useI18n } from "~/i18n/provider";

import { exportFileName, serializeRecords, type DNSRecordInput } from "../records-io";

interface Props {
  records: DNSRecordInput[];
}

/**
 * Downloads the current extra records as JSON. Everything happens in the
 * browser because the loader already has the records; nothing is written.
 */
export default function ExportRecords({ records }: Props) {
  const { t } = useI18n();

  function handleExport() {
    const blob = new Blob([serializeRecords(records)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = exportFileName(new Date());
    document.body.appendChild(link);
    link.click();
    link.remove();

    // Revoking immediately can cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return (
    <Button onClick={handleExport} type="button">
      {t("dns.importExport.exportButton")}
    </Button>
  );
}
