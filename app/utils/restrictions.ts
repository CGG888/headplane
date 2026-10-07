/**
 * Shapes shared by the `/settings/restrictions` dialogs and their action.
 *
 * The browser used to accept values the action rejected (a domain with an
 * underscore, an over-long group) and to refuse values it accepted (an
 * upper-case domain, because the old check compared `URL.hostname` with the
 * raw input and the parser lower-cases it), so the two sides now agree on one
 * rule per field.
 */

export const RESTRICTION_DOMAIN_MAX_LENGTH = 253;
export const RESTRICTION_STRING_MAX_LENGTH = 255;

/**
 * At least two dot-separated labels of letters, digits and dashes — the same
 * rule Headscale applies to `oidc.allowed_domains` entries. The `i` flag keeps
 * `EXAMPLE.com` usable; the dialogs' HTML `pattern` spells the classes out
 * again because that attribute is matched case-sensitively.
 */
export const DOMAIN_PATTERN = String.raw`[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+`;

/**
 * The HTML `pattern` for groups and users: the only shape rule is "no
 * whitespace", and `\S+` is all the pattern attribute can express.
 */
export const RESTRICTION_NAME_PATTERN = String.raw`\S+`;

const domainRegex = new RegExp(`^${DOMAIN_PATTERN}$`, "i");

export function isValidRestrictionDomain(value: string): boolean {
  return value.length <= RESTRICTION_DOMAIN_MAX_LENGTH && domainRegex.test(value);
}

/**
 * Groups and users are matched verbatim against OIDC claim values, so a value
 * carrying whitespace or a control character can never match; only the length
 * and that rule are enforced, the rest is up to the identity provider.
 */
export function isValidRestrictionName(value: string): boolean {
  if (value.length === 0 || value.length > RESTRICTION_STRING_MAX_LENGTH) {
    return false;
  }

  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (/\s/.test(character) || code < 0x20 || code === 0x7f) {
      return false;
    }
  }

  return true;
}
