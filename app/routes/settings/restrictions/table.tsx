import { GlobeLock, Group, User2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Form } from "react-router";

import Button from "~/components/button";
import TableList from "~/components/table-list";
import type { TranslationKey } from "~/i18n";
import { useI18n } from "~/i18n/provider";
import cn from "~/utils/cn";

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
            <Icon />
            <p className="text-center font-semibold">{t(RESTRICTION_EMPTY_KEYS[type])}</p>
          </TableList.Item>
        )}
      </TableList>
    </div>
  );
}
