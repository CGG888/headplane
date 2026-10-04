import { AlertTriangle, Plus, TagsIcon, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useFetcher } from "react-router";

import Button from "~/components/button";
import Dialog, { DialogPanel } from "~/components/dialog";
import Input from "~/components/input";
import Link from "~/components/link";
import TableList from "~/components/table-list";
import Text from "~/components/text";
import Title from "~/components/title";
import { useI18n } from "~/i18n/provider";
import cn from "~/utils/cn";
import toast from "~/utils/toast";

import {
  bulkErrorMessage,
  bulkSummary,
  type BulkErrorResult,
  type BulkResult,
} from "../components/bulk-result";

interface BulkTagsProps {
  nodeIds: string[];
  existingTags?: string[];
  // Tags declared under `tagOwners`. Others are assignable but match no rule.
  policyTags?: string[];
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  onComplete: () => void;
}

export default function BulkTags({
  nodeIds,
  existingTags,
  policyTags,
  isOpen,
  setIsOpen,
  onComplete,
}: BulkTagsProps) {
  const { t, tr } = useI18n();
  const fetcher = useFetcher<BulkResult | BulkErrorResult>();
  const submittingRef = useRef(false);
  const [tags, setTags] = useState<string[]>([]);
  const [tag, setTag] = useState("tag:");

  const tagOptions = useMemo(
    () => (existingTags ?? []).filter((existingTag) => !tags.includes(existingTag)),
    [existingTags, tags],
  );
  const tagIsInvalid = useMemo(
    () => tag.length === 0 || !tag.startsWith("tag:") || tags.includes(tag),
    [tag, tags],
  );
  const undeclaredTags = useMemo(
    () => (policyTags === undefined ? [] : tags.filter((entry) => !policyTags.includes(entry))),
    [policyTags, tags],
  );

  const error = fetcher.data && !fetcher.data.success ? bulkErrorMessage(t, fetcher.data) : null;

  useEffect(() => {
    const result = fetcher.data;
    if (fetcher.state !== "idle" || !result) {
      return;
    }

    submittingRef.current = false;
    if (result.success) {
      toast(bulkSummary(t, result));
      onComplete();
      setIsOpen(false);
    }
  }, [fetcher.data, fetcher.state, onComplete, setIsOpen, t]);

  useEffect(() => {
    if (isOpen) {
      setTags([]);
      setTag("tag:");
    }
  }, [isOpen]);

  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open && submittingRef.current) {
          return;
        }
        setIsOpen(open);
      }}
    >
      <DialogPanel
        isDisabled={fetcher.state !== "idle"}
        onSubmit={(event) => {
          event.preventDefault();
          submittingRef.current = true;

          const form = new FormData();
          form.set("action_id", "bulk_set_tags");
          form.set("tags", tags.filter((entry) => entry !== "").join(","));
          for (const id of nodeIds) {
            form.append("node_ids", id);
          }

          fetcher.submit(form, { method: "POST" });
        }}
      >
        <Title>{t("machines.bulk.tags.title", { count: nodeIds.length })}</Title>
        <Text>
          {tr("machines.bulk.tags.description", {
            link: (
              <Link external styled to="https://tailscale.com/kb/1068/acl-tags">
                {t("machines.tags.tailscaleDocs")}
              </Link>
            ),
          })}
        </Text>
        {error ? (
          <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </p>
        ) : null}
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          {t("machines.bulk.tags.replaceNotice")}
        </p>
        <TableList className="mt-4">
          {tags.length === 0 ? (
            <TableList.Item className="flex flex-col items-center gap-2.5 py-4 opacity-70">
              <TagsIcon />
              <p className="font-semibold">{t("machines.bulk.tags.empty")}</p>
            </TableList.Item>
          ) : (
            tags.map((item) => (
              <TableList.Item className="font-mono" id={item} key={item}>
                <span className="flex items-center gap-1.5">
                  {item}
                  {undeclaredTags.includes(item) ? (
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                  ) : null}
                </span>
                <Button
                  className="rounded-md p-0.5"
                  onClick={() => {
                    setTags(tags.filter((entry) => entry !== item));
                  }}
                  type="button"
                >
                  <X className="p-1" />
                </Button>
              </TableList.Item>
            ))
          )}
        </TableList>

        <div className="mt-2 flex items-center gap-2">
          <Input
            aria-label={t("machines.tags.addLabel")}
            className="w-full"
            invalid={tag.length > 0 && tagIsInvalid}
            label={t("machines.tags.tagLabel")}
            labelHidden
            onChange={setTag}
            placeholder={t("machines.tags.placeholder")}
            value={tag}
          />
          <Button
            className={cn("rounded-md p-1", tagIsInvalid && "cursor-not-allowed opacity-50")}
            disabled={tagIsInvalid}
            onClick={() => {
              setTags([...tags, tag]);
              setTag("tag:");
            }}
            type="button"
          >
            <Plus className="p-1" size={30} />
          </Button>
        </div>
        {tagOptions.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {tagOptions.map((option) => (
              <Button
                className="px-2 py-1 font-mono text-xs"
                key={option}
                onClick={() => setTags([...tags, option])}
                type="button"
                variant="ghost"
              >
                {option}
              </Button>
            ))}
          </div>
        ) : null}
        {undeclaredTags.length > 0 ? (
          <p className="mt-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
            {tr("machines.tags.undeclared", {
              count: undeclaredTags.length,
              tags: undeclaredTags.join(", "),
              tagOwners: <code className="font-mono">tagOwners</code>,
              accessControl: (
                <Link styled to="/acls">
                  {t("pages.Access Control")}
                </Link>
              ),
            })}
          </p>
        ) : null}
        <p className="mt-2 text-sm opacity-50">{t("machines.tags.undeclaredHint")}</p>
      </DialogPanel>
    </Dialog>
  );
}
