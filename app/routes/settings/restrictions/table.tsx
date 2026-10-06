import { GlobeLock, Group, User2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Form } from "react-router";

import Button from "~/components/button";
import TableList from "~/components/table-list";
import type { TranslationKey } from "~/i18n";
import { useI18n } from "~/i18n/provider";

export type RestrictionType = "domain" | "group" | "user";

/** The tabs of the restrictions page, in the order they are shown. */
export const RESTRICTION_TYPES: readonly RestrictionType[] = ["domain", "group", "user"];

export const RESTRICTION_ICONS: Record<RestrictionType, LucideIcon> = {
  domain: GlobeLock,
  group: Group,
  user: User2,
};

export const RESTRICTION_TITLE_KEYS: Record<RestrictionType, TranslationKey> = {
  domain: "settings.restrictions.permittedDomains",
  group: "settings.restrictions.permittedGroups",
  user: "settings.restrictions.permittedUsers",
};

export const RESTRICTION_BODY_KEYS: Record<RestrictionType, TranslationKey> = {
  domain: "settings.restrictions.domainsBody",
  group: "settings.restrictions.groupsBody",
  user: "settings.restrictions.usersBody",
};

export const RESTRICTION_EMPTY_KEYS: Record<RestrictionType, TranslationKey> = {
  domain: "settings.restrictions.emptyDomains",
  group: "settings.restrictions.emptyGroups",
  user: "settings.restrictions.emptyUsers",
};

export const RESTRICTION_ADD_TITLE_KEYS: Record<RestrictionType, TranslationKey> = {
  domain: "settings.addDomain.title",
  group: "settings.addGroup.title",
  user: "settings.addUser.title",
};

export const RESTRICTION_ADD_BODY_KEYS: Record<RestrictionType, TranslationKey> = {
  domain: "settings.addDomain.body",
  group: "settings.addGroup.body",
  user: "settings.addUser.body",
};

interface RestrictionListProps {
  type: RestrictionType;
  values: string[];
  isDisabled?: boolean;
}

/**
 * One restriction list with the button that removes each entry. It lives in the
 * tab that owns it; the tab supplies the heading, the add form and the count.
 */
export default function RestrictionList({ type, values, isDisabled }: RestrictionListProps) {
  const { t } = useI18n();
  const Icon = RESTRICTION_ICONS[type];

  return (
    // px-1 -mx-1 gives focus rings on buttons room to render without being
    // clipped by overflow-y-auto (which implicitly forces overflow-x).
    <div className="-mx-1 max-h-96 min-h-0 overflow-y-auto px-1">
      {/* One short value per row: the list keeps a readable measure so the
          remove button never sits a screen away from the entry it removes. */}
      <TableList className="max-w-4xl border-0">
        {values.length > 0 ? (
          values.map((value) => (
            <TableList.Item className="gap-3" key={`${type}-${value}`}>
              {/* A single long entry truncates instead of pushing the row wider. */}
              <p className="min-w-0 flex-1 truncate" title={value}>
                {type === "domain" ? (
                  <>
                    <span className="text-mist-600 dark:text-mist-300">{"<user>"}</span>
                    <span className="font-bold">@</span>
                    <span>{value}</span>
                  </>
                ) : (
                  value
                )}
              </p>
              <Form className="shrink-0" method="POST">
                <input name="action_id" type="hidden" value={`remove_${type}`} />
                <input name={type} type="hidden" value={value} />
                <Button
                  className="rounded-md px-2 py-1 text-red-600 hover:bg-red-500/10 dark:text-red-400 dark:hover:bg-red-500/10"
                  disabled={isDisabled}
                  type="submit"
                  variant="ghost"
                >
                  {t("settings.restrictions.remove")}
                </Button>
              </Form>
            </TableList.Item>
          ))
        ) : (
          <TableList.Item className="flex flex-col items-center gap-2.5 py-4 opacity-70">
            <Icon />
            <p className="text-center font-semibold">{t(RESTRICTION_EMPTY_KEYS[type])}</p>
          </TableList.Item>
        )}
      </TableList>
    </div>
  );
}
