import { FLAG_URLS } from "~/assets/flags";
import cn from "~/utils/cn";
import { regionCountryCode } from "~/utils/region-country";

/**
 * The small flag that sits next to a relay region's name.
 *
 * It is deliberately the dumb end of the feature: the caller hands over whatever
 * it already has (the region's official code, the name the operator sees, or a
 * country it resolved itself) and this component decides whether a flag exists
 * for it. A region whose country no table knows renders nothing at all rather
 * than a placeholder — see `~/utils/region-country` for why guessing is not an
 * option here.
 *
 * The flag repeats information the text already carries, so it is decorative:
 * `alt=""` and `aria-hidden` keep screen readers on the name.
 */
export function RegionFlag({
  code,
  name,
  country,
  className,
}: {
  /** The region's official code (`hkg`, `tok`), when the surface has one. */
  code?: string | undefined;
  /** The region's name (`香港`, `Tokyo`), when the surface has one. */
  name?: string | undefined;
  /** An already-resolved ISO 3166-1 alpha-2 country code. */
  country?: string | undefined;
  className?: string | undefined;
}) {
  const resolved = country?.trim() || regionCountryCode({ code, name });
  const url = resolved === undefined ? undefined : FLAG_URLS[resolved.toLowerCase()];
  if (url === undefined) {
    return null;
  }

  return (
    <img
      alt=""
      aria-hidden="true"
      className={cn(
        "inline-block h-3 w-4 shrink-0 rounded-[2px] object-cover align-[-0.125em]",
        className,
      )}
      draggable={false}
      src={url}
    />
  );
}
