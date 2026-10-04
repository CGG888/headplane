import { GlobeLock, Group, User2 } from "lucide-react";
import React from "react";
import { Form } from "react-router";

import Button from "~/components/button";
import { SettingsSection } from "~/components/drawer";
import TableList from "~/components/table-list";
import type { TranslationKey } from "~/i18n";
import { useI18n } from "~/i18n/provider";
import cn from "~/utils/cn";

type RestrictionType = "domain" | "group" | "user";

interface RestrictionProps {
  children: React.ReactNode;
  type: RestrictionType;
  values: string[];
  isDisabled?: boolean;
}

const TITLE_KEYS: Record<RestrictionType, TranslationKey> = {
  domain: "settings.restrictions.permittedDomains",
  group: "settings.restrictions.permittedGroups",
  user: "settings.restrictions.permittedUsers",
};

const DESCRIPTION_KEYS: Record<RestrictionType, TranslationKey> = {
  domain: "settings.restrictions.domainsBody",
  group: "settings.restrictions.groupsBody",
  user: "settings.restrictions.usersBody",
};

const EMPTY_KEYS: Record<RestrictionType, TranslationKey> = {
  domain: "settings.restrictions.emptyDomains",
  group: "settings.restrictions.emptyGroups",
  user: "settings.restrictions.emptyUsers",
};

/**
 * One restriction list as a row in the settings list. The row opens a drawer
 * that owns the list, its remove buttons and the form that adds a value, so a
 * long list scrolls inside the drawer instead of stretching the page.
 */
export default function RestrictionSection({
  children,
  type,
  values,
  isDisabled,
}: RestrictionProps) {
  const { t } = useI18n();

  return (
    <SettingsSection
      description={t(DESCRIPTION_KEYS[type])}
      size="wide"
      summary={
        values.length > 0
          ? t("settings.restrictions.summaryCount", { count: values.length })
          : t(EMPTY_KEYS[type])
      }
      title={t(TITLE_KEYS[type])}
    >
      <div className="flex flex-col gap-6">
        {/* px-1 -mx-1 gives focus rings on buttons room to render without being
            clipped by overflow-y-auto (which implicitly forces overflow-x). */}
        <div className="-mx-1 max-h-96 min-h-0 overflow-y-auto px-1">
          <TableList>
            {values.length > 0 ? (
              values.map((value) => (
                <TableList.Item key={`${type}-${value}`}>
                  {type === "domain" ? (
                    <p>
                      <span className="text-mist-600 dark:text-mist-300">{"<user>"}</span>
                      <span className="font-bold">@</span>
                      <span>{value}</span>
                    </p>
                  ) : (
                    <p>{value}</p>
                  )}
                  <Form method="POST">
                    <input name="action_id" type="hidden" value={`remove_${type}`} />
                    <input name={type} type="hidden" value={value} />
                    <Button
                      className={cn("px-2 py-1 rounded-md", "text-red-500 dark:text-red-400")}
                      disabled={isDisabled}
                      type="submit"
                    >
                      {t("settings.restrictions.remove")}
                    </Button>
                  </Form>
                </TableList.Item>
              ))
            ) : (
              <TableList.Item className="flex flex-col items-center gap-2.5 py-4 opacity-70">
                {iconForType(type)}
                <p className="text-center font-semibold">{t(EMPTY_KEYS[type])}</p>
              </TableList.Item>
            )}
          </TableList>
        </div>
        {children}
      </div>
    </SettingsSection>
  );
}

function iconForType(type: RestrictionType) {
  if (type === "domain") {
    return <GlobeLock />;
  }

  if (type === "group") {
    return <Group />;
  }

  return <User2 />;
}
