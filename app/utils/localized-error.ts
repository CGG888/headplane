import type { TranslationKey } from "~/i18n";

/**
 * Payload shape for errors that carry a translation key instead of English
 * text. A plain object (rather than an Error subclass) is used because loader
 * and action errors are serialized before the error boundary renders on the
 * client, which would drop a custom class.
 *
 * Build one with `data({ localized: { key } }, { status: 403 })` and the
 * `ErrorBanner` will render the translated message.
 */
export interface LocalizedPayload {
  localized: {
    key: TranslationKey;
    vars?: Record<string, string | number>;
  };
}

export function isLocalizedPayload(value: unknown): value is LocalizedPayload {
  if (typeof value !== "object" || value === null || !("localized" in value)) {
    return false;
  }

  const localized = (value as { localized?: unknown }).localized;
  return (
    typeof localized === "object" &&
    localized !== null &&
    "key" in localized &&
    typeof (localized as { key?: unknown }).key === "string"
  );
}
