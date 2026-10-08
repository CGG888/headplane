import { useI18n } from "~/i18n/provider";
import type { PolicyIssue } from "~/utils/acl-policy";

import { ACL_ISSUE_KEYS } from "../error-keys";

/**
 * Lists every reason Headscale would refuse the rule being edited. The dialogs
 * disable their save button while this list is not empty, so a rule Headscale
 * rejects cannot be sent to the API (which answers with an HTTP 500 when its
 * rejection carries no parse error).
 */
export default function RuleIssues({ issues }: { issues: PolicyIssue[] }) {
  const { t } = useI18n();

  if (issues.length === 0) {
    return null;
  }

  return (
    <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 dark:border-red-500/30 dark:bg-red-500/10">
      <p className="text-sm font-medium text-red-900 dark:text-red-200">{t("acls.issues.title")}</p>
      <ul className="mt-1 list-disc pl-5 text-xs text-red-900 dark:text-red-200">
        {issues.map((issue, index) => (
          <li key={`${issue.code}:${issue.value}:${index}`}>
            {t(ACL_ISSUE_KEYS[issue.code], { value: issue.value })}
          </li>
        ))}
      </ul>
    </div>
  );
}
