import { useEffect, useState } from "react";

import Dialog, { DialogPanel } from "~/components/dialog";
import Input from "~/components/input";
import Text from "~/components/text";
import Title from "~/components/title";
import TokenList from "~/components/token-list";
import { useI18n } from "~/i18n/provider";

interface AutoApproverDialogProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  // Present when editing, absent when creating a new entry.
  route?: string;
  approvers?: string[];
  existingRoutes: string[];
  suggestions: string[];
  onSave: (route: string, approvers: string[]) => void;
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const IPV6_GROUP = /^[0-9a-fA-F]{1,4}$/;

function isIpv4(value: string): boolean {
  return IPV4.test(value) && value.split(".").every((part) => Number(part) <= 255);
}

// Enough of an IPv6 check to reject a typo, mirroring the one in acl-policy.
function isIpv6(value: string): boolean {
  const halves = value.split("::");
  if (halves.length > 2) {
    return false;
  }

  const groups = halves.flatMap((half) => (half.length === 0 ? [] : half.split(":")));
  if (groups.length === 0) {
    return halves.length === 2;
  }

  const last = groups[groups.length - 1];
  const embedded = isIpv4(last);
  const head = embedded ? groups.slice(0, -1) : groups;
  if (!head.every((group) => IPV6_GROUP.test(group))) {
    return false;
  }

  const width = embedded ? head.length + 2 : groups.length;
  return halves.length === 2 ? width <= 7 : width === 8;
}

// Headscale keys autoApprovers.routes by a CIDR prefix, so a bare address or an
// alias is not accepted.
export function isValidCidr(value: string): boolean {
  const [address, prefix, ...rest] = value.trim().split("/");
  if (rest.length > 0 || prefix === undefined || !/^\d{1,3}$/.test(prefix)) {
    return false;
  }

  const bits = Number(prefix);
  return address.includes(":") ? bits <= 128 && isIpv6(address) : bits <= 32 && isIpv4(address);
}

export default function AutoApproverDialog({
  isOpen,
  setIsOpen,
  route,
  approvers,
  existingRoutes,
  suggestions,
  onSave,
}: AutoApproverDialogProps) {
  const { t } = useI18n();
  const [draftRoute, setDraftRoute] = useState(route ?? "");
  const [draftApprovers, setDraftApprovers] = useState<string[]>(approvers ?? []);

  useEffect(() => {
    if (isOpen) {
      setDraftRoute(route ?? "");
      setDraftApprovers(approvers ? [...approvers] : []);
    }
  }, [isOpen, route, approvers]);

  const trimmedRoute = draftRoute.trim();
  const isDuplicate = trimmedRoute !== route && existingRoutes.includes(trimmedRoute);
  const routeIsInvalid = !isValidCidr(trimmedRoute);
  const isInvalid = routeIsInvalid || isDuplicate || draftApprovers.length === 0;

  return (
    <Dialog isOpen={isOpen} onOpenChange={setIsOpen}>
      <DialogPanel
        isDisabled={isInvalid}
        onSubmit={(event) => {
          event.preventDefault();
          onSave(trimmedRoute, draftApprovers);
          setIsOpen(false);
        }}
      >
        <Title>
          {route ? t("acls.autoApprover.editTitle", { route }) : t("acls.autoApprover.newTitle")}
        </Title>
        <Text>{t("acls.autoApprover.body")}</Text>
        <Input
          errorMessage={
            isDuplicate ? t("acls.autoApprover.duplicate") : t("acls.autoApprover.routeInvalid")
          }
          invalid={isInvalid && trimmedRoute.length > 0}
          label={t("acls.autoApprover.routeLabel")}
          onChange={setDraftRoute}
          placeholder={t("acls.autoApprover.routePlaceholder")}
          value={draftRoute}
        />
        <TokenList
          description={t("acls.autoApprover.approversDescription")}
          emptyText={t("acls.autoApprover.approversEmpty")}
          label={t("acls.autoApprover.approversLabel")}
          onChange={setDraftApprovers}
          placeholder={t("acls.autoApprover.approversPlaceholder")}
          suggestions={suggestions}
          values={draftApprovers}
        />
      </DialogPanel>
    </Dialog>
  );
}
