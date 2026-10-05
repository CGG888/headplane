import cn from "~/utils/cn";

/**
 * The number of ACL tags a row spells out before the rest collapse into a
 * single `+N` chip. Two keeps the identity column one line tall for the common
 * case while the hover title still carries the whole set.
 */
const MAX_VISIBLE_TAGS = 2;

/** `tag:web` is written as `tag:web` in a policy but reads as `web` in a chip. */
function tagLabel(tag: string) {
  return tag.startsWith("tag:") ? tag.slice(4) : tag;
}

/**
 * One ACL tag. It is deliberately the same muted chip as the rest of the app so
 * a tag never competes with a status chip for attention; the full `tag:` value
 * stays available on hover.
 */
function AclTagChip({ tag, className }: { tag: string; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 min-w-0 items-center gap-x-1 rounded-md px-1.5 text-xs",
        "bg-mist-100 text-mist-700",
        "dark:bg-mist-800 dark:text-mist-200",
        className,
      )}
      title={tag}
    >
      <span
        aria-hidden="true"
        className="shrink-0 font-mono text-[0.625rem] text-mist-400 dark:text-mist-500"
      >
        tag:
      </span>
      <span className="min-w-0 truncate">{tagLabel(tag)}</span>
    </span>
  );
}

/**
 * The ACL tags assigned to a machine, rendered as uniform chips that truncate
 * into a `+N` overflow chip. Hovering the overflow chip lists every tag, so a
 * machine with many tags never widens the row.
 */
export function AclTags({ tags, className }: { tags: string[]; className?: string }) {
  if (tags.length === 0) {
    return undefined;
  }

  const visible = tags.slice(0, MAX_VISIBLE_TAGS);
  const hidden = tags.length - visible.length;
  const allTags = tags.join("\n");

  return (
    <span className={cn("flex min-w-0 flex-wrap items-center gap-1", className)} title={allTags}>
      {visible.map((tag) => (
        <AclTagChip className="max-w-[9rem] min-w-[3.5rem] shrink" key={tag} tag={tag} />
      ))}
      {hidden > 0 ? (
        <span
          className={cn(
            "inline-flex h-5 shrink-0 items-center rounded-md px-1.5 text-xs font-medium tabular-nums",
            "bg-mist-100 text-mist-500",
            "dark:bg-mist-800 dark:text-mist-400",
          )}
          title={allTags}
        >
          {`+${hidden}`}
        </span>
      ) : undefined}
    </span>
  );
}
