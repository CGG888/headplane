import Dialog, { DialogPanel } from "~/components/dialog";
import Link from "~/components/link";
import Notice from "~/components/notice";
import RadioGroup from "~/components/radio-group";
import Text from "~/components/text";
import Title from "~/components/title";
import type { TranslationKey } from "~/i18n";
import { useI18n } from "~/i18n/provider";
import { ASSIGNABLE_ROLES } from "~/server/web/roles";
import type { Role } from "~/server/web/roles";

interface ReassignProps {
  headplaneUserId: string;
  displayName: string;
  role: Role;
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}

const ROLE_KEYS: Record<string, { name: TranslationKey; desc: TranslationKey }> = {
  admin: { name: "users.roles.admin", desc: "users.roleDesc.admin" },
  network_admin: { name: "users.roles.networkAdmin", desc: "users.roleDesc.networkAdmin" },
  it_admin: { name: "users.roles.itAdmin", desc: "users.roleDesc.itAdmin" },
  auditor: { name: "users.roles.auditor", desc: "users.roleDesc.auditor" },
  viewer: { name: "users.roles.viewer", desc: "users.roleDesc.viewer" },
  member: { name: "users.roles.member", desc: "users.roleDesc.member" },
};

export default function ReassignUser({
  headplaneUserId,
  displayName,
  role,
  isOpen,
  setIsOpen,
}: ReassignProps) {
  const { t } = useI18n();

  return (
    <Dialog isOpen={isOpen} onOpenChange={setIsOpen}>
      <DialogPanel variant={role === "owner" ? "unactionable" : "normal"}>
        <Title>{t("users.changeRole.title", { name: displayName })}</Title>
        <Text className="mb-6">
          {t("users.changeRole.body")}{" "}
          <Link external styled to="https://tailscale.com/kb/1138/user-roles">
            {t("common.learnMore")}
          </Link>
        </Text>
        {role === "owner" ? (
          <Notice>{t("users.changeRole.ownerNotice")}</Notice>
        ) : (
          <>
            <input name="action_id" type="hidden" value="reassign_user" />
            <input name="headplane_user_id" type="hidden" value={headplaneUserId} />
            <RadioGroup
              className="gap-4"
              defaultValue={role}
              label={t("users.changeRole.label")}
              name="new_role"
            >
              {ASSIGNABLE_ROLES.map((r) => {
                const { name, desc } = mapRoleToName(r, t);
                return (
                  <RadioGroup.Radio key={r} label={name} value={r}>
                    <div className="block">
                      <p className="font-bold">{name}</p>
                      <p className="opacity-70">{desc}</p>
                    </div>
                  </RadioGroup.Radio>
                );
              })}
            </RadioGroup>
          </>
        )}
      </DialogPanel>
    </Dialog>
  );
}

function mapRoleToName(role: string, t: ReturnType<typeof useI18n>["t"]) {
  const keys = ROLE_KEYS[role];
  if (!keys) {
    return { name: role, desc: t("users.roleDesc.unknown") };
  }

  return { name: t(keys.name), desc: t(keys.desc) };
}
