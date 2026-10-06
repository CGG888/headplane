---
title: 多语言
description: 界面语言、支持的语言目录，以及如何添加或更新翻译。
---

# 多语言

Headplane 的界面自带英语、简体中文和繁体中文三种语言，无需任何配置。

## 切换语言

打开页头右上角的账户菜单，从列表中选择语言。登录页上同一个列表在右上角的地球按钮里。

所选语言保存在 `locale` cookie 中并在服务端生效，因此下一次请求时整个页面（包括错误页）
都会以该语言渲染。如果还没有选择过语言，Headplane 会使用浏览器的 `Accept-Language`，
并回退到英语。

日期与数字同样遵循所选语言：时间戳会带着当前语言走 `Intl`，因此 `toLocaleString()` 的输出
与语言一致，而不是浏览器默认值。

## 支持的语言

| 语言代码  | 语言                           |
| --------- | ------------------------------ |
| `en`      | English                        |
| `zh-Hans` | 简体中文 (Simplified Chinese)  |
| `zh-Hant` | 繁體中文 (Traditional Chinese) |

任何要求繁体字形或繁体地区的中文标签（`zh-Hant`、`zh-TW`、`zh-HK`、`zh-MO`）都会映射到
`zh-Hant`；其他所有中文标签都映射到 `zh-Hans`。

## 术语表

产品名与协议术语在任何语言下都保持英文，这样说明文字才能与 Headscale 和 Tailscale 的文档
对得上。其余内容都会翻译。

| 术语             | 说明                                                     |
| ---------------- | -------------------------------------------------------- |
| Headplane        | 产品名                                                   |
| Headscale        | 产品名                                                   |
| Tailscale        | 产品名                                                   |
| Tailnet          | Headscale 概念                                           |
| ACL              | Access Control List；策略文件仍叫 `ACL`                  |
| Magic DNS        | Headscale 功能名                                         |
| Split DNS        | DNS 功能名                                               |
| Pre-auth key     | 密钥类型名（中文写作 预授权密钥 / 預先授權金鑰）         |
| SSH / OIDC / DNS | 协议名                                                   |
| `tag:`, `group:` | 策略语法前缀，绝不翻译                                   |
| WebSSH           | 浏览器 SSH 功能名                                        |

界面上出现的 Headscale 内置取值（`accept`、`check` 这样的节点操作，`A`/`AAAA` 记录类型，
API 状态码）按原样显示，因为它们是取值，不是叙述文字。

## 有意不翻译的部分

- **Headscale API 错误。** Headscale 服务器返回的消息原样透传；Headplane 无法翻译不属于
  自己的文本。
- **服务端日志。** `log.*` 的输出保持英文，方便 grep。
- **内部校验错误。** 例如 `Missing \`action_id\` in the form data.` 这类消息描述的是 API
  被误用，属于开发者面向的内容。
- **第三方界面。** CodeMirror 编辑器外观和 WebSSH 终端（restty）渲染自己的界面文本。

## 添加或更新翻译

翻译文件位于 `app/i18n/locales`：

- `app/i18n/locales/en.ts` 是唯一事实来源，它定义键空间与回退文案。
- `app/i18n/locales/zh-Hans.ts` 与 `app/i18n/locales/zh-Hant.ts` 会以 `satisfies Catalog`
  对照英文目录检查，因此缺失或拼错的键会让 `pnpm run typecheck` 失败。

要新增语言，请添加目录文件，在 `app/i18n/index.ts` 的 `catalogs` 映射里注册它，把该语言加入
`app/utils/locale.ts` 的 `LOCALES`，并在每个目录的 `language` 段里加上它的本地名称。

有些字符串内嵌标记，例如行内代码或链接。它们使用占位符（`{command}`、`{link}`），这样每种
语言都能调整语序；标记由组件通过 `tr()` 传入。

复数形式的字符串是带 `one` 和 `other` 的对象，按 `count` 变量选择。中文没有复数区分，因此
两个分支通常写同样的文本，而英文不同。

服务端代码从不输出面向用户的叙述文字。加载器和 action 返回翻译键（见
`app/utils/localized-error.ts` 以及 `app/routes/ssh/errors.tsx` 的 `sshError` 负载）或稳定的
错误码，由界面负责翻译。

## 自动化检查

`pnpm run test:unit` 会在 `tests/unit/i18n/catalog.test.ts` 中覆盖这些目录：

- 每个语言定义的键空间与英文完全一致，
- 没有空翻译，
- 占位符集合与英文一致，插值因此永远不会出错，
- 繁体中文里不含仅简体独有的字符，
- 每个中文目录以中文为主（防止出现「加了语言却从未翻译」的情况）。

语言协商（`zh-TW` → `zh-Hant`、`zh-CN` → `zh-Hans`、质量值、不支持的语言标签）由
`tests/unit/i18n/locale.test.ts` 覆盖。

## 相关文件

- `app/utils/locale.ts` —— 语言列表、cookie 以及 `Accept-Language` 协商。
- `app/i18n/index.ts` —— 目录查找、插值与复数选择。
- `app/i18n/catalog.ts` —— 键空间类型（`Catalog`、`TranslationKey`）。
- `app/i18n/provider.tsx` —— `I18nProvider`、`useI18n()` 与 `useT()`。
- `app/routes/util/locale.ts` —— 保存语言选择的 `/api/locale` 端点。
- `app/components/language-switcher.tsx` —— 页头与登录页上的语言菜单。
- `app/utils/localized-error.ts` —— 携带翻译键的错误。
