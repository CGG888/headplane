import { Cog, Ellipsis, SquareTerminal } from "lucide-react";
import { useState } from "react";
import { useSubmit } from "react-router";

import Button from "~/components/button";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "~/components/menu";
import { useI18n } from "~/i18n/provider";
import type { User } from "~/types";
import cn from "~/utils/cn";
import { isNoExpiry, type PopulatedNode } from "~/utils/node-info";

import Delete from "../dialogs/delete";
import Expire from "../dialogs/expire";
import Move from "../dialogs/move";
import Rename from "../dialogs/rename";
import Routes from "../dialogs/routes";
import Tags from "../dialogs/tags";

interface MenuProps {
  node: PopulatedNode;
  users: User[];
  magic?: string;
  isFullButton?: boolean;
  isDisabled?: boolean;
  existingTags?: string[];
  policyTags?: string[];
  supportsNodeOwnerChange: boolean;
  supportsDisablingKeyExpiry: boolean;
}

type Modal = "rename" | "expire" | "remove" | "routes" | "move" | "tags" | null;

export default function MachineMenu({
  node,
  magic,
  users,
  isFullButton,
  isDisabled,
  existingTags,
  policyTags,
  supportsNodeOwnerChange,
  supportsDisablingKeyExpiry,
}: MenuProps) {
  const submit = useSubmit();
  const { t } = useI18n();
  const [modal, setModal] = useState<Modal>(null);
  const supportsTailscaleSSH = node.hostInfo?.sshHostKeys && node.hostInfo?.sshHostKeys.length > 0;

  return (
    <div
      className={cn(
        "flex items-center justify-end gap-1.5",
        // In the list the cell is narrow, so the quick actions anchor to it
        // instead of padding themselves out of the column.
        isFullButton ? "px-4" : "relative px-0",
      )}
    >
      {modal === "remove" && (
        <Delete
          isOpen={modal === "remove"}
          machine={node}
          setIsOpen={(isOpen) => {
            if (!isOpen) setModal(null);
          }}
        />
      )}
      {modal === "move" && (
        <Move
          isOpen={modal === "move"}
          machine={node}
          setIsOpen={(isOpen) => {
            if (!isOpen) setModal(null);
          }}
          users={users}
        />
      )}
      {modal === "rename" && (
        <Rename
          isOpen={modal === "rename"}
          machine={node}
          magic={magic}
          setIsOpen={(isOpen) => {
            if (!isOpen) setModal(null);
          }}
        />
      )}
      {modal === "routes" && (
        <Routes
          isOpen={modal === "routes"}
          node={node}
          setIsOpen={(isOpen) => {
            if (!isOpen) setModal(null);
          }}
        />
      )}
      {modal === "tags" && (
        <Tags
          existingTags={existingTags}
          policyTags={policyTags}
          isOpen={modal === "tags"}
          machine={node}
          setIsOpen={(isOpen) => {
            if (!isOpen) setModal(null);
          }}
        />
      )}
      <Expire
        isOpen={modal === "expire"}
        machine={node}
        setIsOpen={(isOpen) => {
          if (!isOpen) setModal(null);
        }}
      />

      {supportsTailscaleSSH ? (
        isFullButton ? (
          <Button
            className="flex items-center gap-x-2"
            onClick={() => {
              // We need to use JS to open the SSH URL
              // in a new WINDOW since href can only
              // do a new TAB.
              window.open(
                `${__PREFIX__}/ssh/${node.givenName}`,
                "_blank",
                "noopener,noreferrer,width=800,height=600",
              );
            }}
            variant="heavy"
          >
            <SquareTerminal className="h-5" />
            <p>{t("machines.menu.ssh")}</p>
          </Button>
        ) : (
          // The list row is too narrow to hold this button in flow: floating it
          // over the row keeps every row the same height and keeps the icon
          // column from overflowing into its neighbour.
          <Button
            className={cn(
              "absolute top-1/2 right-11 -translate-y-1/2",
              "rounded-md px-2 py-1 text-xs whitespace-nowrap",
              "shadow-surface dark:shadow-none",
              "pointer-events-none opacity-0 transition-opacity duration-100",
              "group-hover:pointer-events-auto group-hover:opacity-100",
              "group-focus-within:pointer-events-auto group-focus-within:opacity-100",
              "focus-visible:pointer-events-auto focus-visible:opacity-100",
            )}
            variant="light"
            onClick={() => {
              window.open(
                `${__PREFIX__}/ssh/${node.givenName}`,
                "_blank",
                "noopener,noreferrer,width=800,height=600",
              );
            }}
          >
            {t("machines.menu.ssh")}
          </Button>
        )
      ) : undefined}
      <Menu disabled={isDisabled}>
        <MenuTrigger
          className={
            isFullButton
              ? "gap-x-2 rounded-md border border-mist-200 bg-white px-3.5 py-2 text-sm font-medium hover:bg-mist-50 dark:border-mist-700 dark:bg-mist-800/50 dark:hover:bg-mist-700/50"
              : "w-10 rounded-full bg-transparent p-1 text-mist-500 transition-colors hover:bg-mist-100 hover:text-mist-700 dark:text-mist-400 dark:hover:bg-mist-800 dark:hover:text-mist-200"
          }
        >
          {isFullButton ? (
            <>
              <Cog className="h-5" />
              <p>{t("machines.menu.settings")}</p>
            </>
          ) : (
            <Ellipsis className="h-5" />
          )}
        </MenuTrigger>
        <MenuContent>
          <MenuItem onClick={() => setModal("rename")}>{t("machines.menu.editName")}</MenuItem>
          {supportsDisablingKeyExpiry && (
            <MenuItem
              onClick={() =>
                submit(
                  {
                    action_id: "toggle_expiry",
                    node_id: node.id,
                    disableExpiry: !isNoExpiry(node.expiry),
                  },
                  { method: "post" },
                )
              }
            >
              {isNoExpiry(node.expiry)
                ? t("machines.menu.enableKeyExpiry")
                : t("machines.menu.disableKeyExpiry")}
            </MenuItem>
          )}
          <MenuItem onClick={() => setModal("routes")}>{t("machines.menu.editRoutes")}</MenuItem>
          <MenuItem onClick={() => setModal("tags")}>{t("machines.menu.editTags")}</MenuItem>
          {supportsNodeOwnerChange && (
            <MenuItem onClick={() => setModal("move")}>{t("machines.menu.changeOwner")}</MenuItem>
          )}
          <MenuSeparator />
          {/* The chooser also offers "never" and "default", so it stays
              reachable for machines that currently have no expiry (and for
              expired ones, where it is how you give the key a new date). */}
          <MenuItem variant="danger" onClick={() => setModal("expire")}>
            {t("machines.menu.expire")}
          </MenuItem>
          <MenuItem variant="danger" onClick={() => setModal("remove")}>
            {t("machines.menu.remove")}
          </MenuItem>
        </MenuContent>
      </Menu>
    </div>
  );
}
