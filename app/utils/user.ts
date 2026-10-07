import type { User } from "~/types/User";

export function getUserDisplayName(user: User, tagOwnedLabel = "Tag-owned"): string {
  if (user.name === "tagged-devices") {
    return tagOwnedLabel;
  }

  return user.name || user.displayName || user.email || user.id;
}

// Mirrors Headscale's `util.ValidateUsername` (hscontrol/util/dns.go): a name has
// to start with a letter and may only contain letters, numbers, `-`, `.`, `_` and
// at most one `@` (`\p{L}`/`\p{Nd}` match Go's `unicode.IsLetter`/`IsDigit`).
// The trailing `@` is ours: Headscale strips it when resolving a
// username in an ACL policy, so a user whose name ends in `@` is created fine but
// can never be matched by a rule.
export const USERNAME_PATTERN = String.raw`\p{L}[\p{L}\p{Nd}._\-]*(@[\p{L}\p{Nd}._\-]+)?`;

/**
 * Headscale caps the user fields it accepts at 255 characters, and every other
 * user-controlled string in this app uses the same ceiling (see the
 * `restrictions` allow-list validation), so the client and the server agree on
 * one number.
 */
export const USER_STRING_MAX_LENGTH = 255;

export const USERNAME_RULE =
  "Usernames must be between 2 and 255 characters, start with a letter, and contain only " +
  "letters, numbers, dots, dashes and underscores, with at most one @ that cannot " +
  "be the last character.";

export const DISPLAY_NAME_RULE =
  "Display names must be at most 255 characters and cannot contain control characters.";

export const EMAIL_RULE = "Emails must be at most 255 characters and look like name@example.com.";

const usernameRegex = new RegExp(`^${USERNAME_PATTERN}$`, "u");

// Returns an error message when the username is not usable in Headscale.
export function validateUsername(name: string): string | undefined {
  if (name.length < 2 || name.length > USER_STRING_MAX_LENGTH || !usernameRegex.test(name)) {
    return USERNAME_RULE;
  }
}

function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }

  return false;
}

// Display names may contain spaces, so only the length and control characters
// are rejected here.
export function validateDisplayName(value: string): string | undefined {
  if (value.length > USER_STRING_MAX_LENGTH || hasControlCharacters(value)) {
    return DISPLAY_NAME_RULE;
  }
}

/**
 * Deliberately shallow: the dialog's `<input type="email">` is the only format
 * check the browser makes and Headscale has the final say, so anything stricter
 * would turn a working flow into a server error. This rejects the shapes that
 * can never be an address (no `@`, more than one `@`, an empty side) along with
 * over-long and control-character values.
 */
export function validateEmail(value: string): string | undefined {
  if (value.length > USER_STRING_MAX_LENGTH || hasControlCharacters(value)) {
    return EMAIL_RULE;
  }

  const parts = value.split("@");
  if (parts.length !== 2 || parts[0] === "" || parts[1] === "") {
    return EMAIL_RULE;
  }
}
