# Languages

Headplane ships with an interface translated into English, Simplified Chinese,
and Traditional Chinese. No configuration is required.

## Switching languages

Open the account menu in the top right of the header and pick a language from
the list. On the login page the same list is available from the globe button in
the top right corner.

The selected language is stored in a `locale` cookie and applied on the server,
so the whole page (including error pages) is rendered in that language on the
next request. If no language has been selected yet, Headplane uses the browser's
`Accept-Language` header and falls back to English.

Dates and numbers follow the selected locale as well: timestamps go through
`Intl` with the active locale, so `toLocaleString()` output matches the language
rather than the browser default.

## Supported locales

| Locale    | Language                       |
| --------- | ------------------------------ |
| `en`      | English                        |
| `zh-Hans` | 简体中文 (Simplified Chinese)  |
| `zh-Hant` | 繁體中文 (Traditional Chinese) |

`zh-Hant` is used for any Chinese tag that asks for the traditional script or a
traditional-script region (`zh-Hant`, `zh-TW`, `zh-HK`, `zh-MO`); every other
Chinese tag maps to `zh-Hans`.

## Glossary

Product and protocol terms stay in English in every locale, so that instructions
match the Headscale and Tailscale documentation. Everything else is translated.

| Term             | Notes                                                   |
| ---------------- | ------------------------------------------------------- |
| Headplane        | Product name                                            |
| Headscale        | Product name                                            |
| Tailscale        | Product name                                            |
| Tailnet          | Headscale concept                                       |
| ACL              | Access Control List; the policy file is still `ACL`     |
| Magic DNS        | Headscale feature name                                  |
| Split DNS        | DNS feature name                                        |
| Pre-auth key     | Key type name (translated as 预授权密钥 / 預先授權金鑰) |
| SSH / OIDC / DNS | Protocol names                                          |
| `tag:`, `group:` | Policy syntax prefixes, never translated                |
| WebSSH           | Browser SSH feature name                                |

Built-in Headscale values that appear in the UI (node actions such as `accept`
and `check`, record types `A`/`AAAA`, API status codes) are shown verbatim
because they are values, not prose.

## What is intentionally not translated

- **Headscale API errors.** Messages returned by the Headscale server are passed
  through verbatim; Headplane cannot translate text it does not own.
- **Server logs.** `log.*` output stays English so that logs are greppable.
- **Internal validation errors.** Messages such as `Missing \`action_id\` in the
  form data.` describe misuse of the API and are developer-facing.
- **Third-party UI.** The CodeMirror editor chrome and the WebSSH terminal
  (restty) render their own interface text.

## Adding or updating a translation

Translations live in `app/i18n/locales`:

- `app/i18n/locales/en.ts` is the source of truth. It defines the key space and
  the fallback text.
- `app/i18n/locales/zh-Hans.ts` and `app/i18n/locales/zh-Hant.ts` are checked
  against the English catalog with `satisfies Catalog`, so a missing or
  misspelled key fails `pnpm run typecheck`.

To add a new locale, add the catalog file, register it in the `catalogs` map in
`app/i18n/index.ts`, add the locale to `LOCALES` in `app/utils/locale.ts`, and
add its native name to the `language` section of every catalog.

Some strings embed markup, such as inline code or links. These use placeholders
(`{command}`, `{link}`) so each language can reorder the sentence; the markup is
passed from the component with `tr()`.

Plural strings are objects with `one` and `other`, selected with the `count`
variable. Chinese has no plural distinction, so both branches usually hold the
same text while English differs.

Server code never emits user-facing prose. Loaders and actions return either a
translation key (see `app/utils/localized-error.ts` and the `sshError` payload in
`app/routes/ssh/errors.tsx`) or a stable error code, and the UI translates it.

## Automated checks

`pnpm run test:unit` covers the catalogs in `tests/unit/i18n/catalog.test.ts`:

- every locale defines exactly the English key space,
- no translation is empty,
- placeholder sets match English, so interpolation can never break,
- Traditional Chinese contains no simplified-only characters,
- each Chinese catalog is predominantly Chinese (guards against a locale that
  was added but never translated).

The locale negotiation (`zh-TW` → `zh-Hant`, `zh-CN` → `zh-Hans`, quality
values, unsupported tags) is covered by `tests/unit/i18n/locale.test.ts`.

## Related files

- `app/utils/locale.ts` — locale list, cookie, and `Accept-Language` negotiation.
- `app/i18n/index.ts` — catalog lookup, interpolation, and plural selection.
- `app/i18n/catalog.ts` — key-space types (`Catalog`, `TranslationKey`).
- `app/i18n/provider.tsx` — `I18nProvider`, `useI18n()`, and `useT()`.
- `app/routes/util/locale.ts` — the `/api/locale` endpoint that persists the choice.
- `app/components/language-switcher.tsx` — the menu shown in the header and on the login page.
- `app/utils/localized-error.ts` — errors that carry a translation key.
