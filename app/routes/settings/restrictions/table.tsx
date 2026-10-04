import { GlobeLock, Group, User2 } from "lucide-react";
import React from "react";
import { Form } from "react-router";

import Button from "~/components/button";
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

const EMPTY_KEYS: Record<RestrictionType, TranslationKey> = {
  domain: "settings.restrictions.emptyDomains",
  group: "settings.restrictions.emptyGroups",
  user: "settings.restrictions.emptyUsers",
};

export default function RestrictionTable({ children, type, values, isDisabled }: RestrictionProps) {
  const { t } = useI18n();

  return (
    <div className="w-full sm:w-2/3">
      <h2 className="mt-8 text-2xl font-medium">{t(TITLE_KEYS[type])}</h2>
      <TableList className="my-4">
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
      {children}
    </div>
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
