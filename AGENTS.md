# 核心概念

Headplane 是一个用于管理 Headscale 的 Web 应用，Headscale 则是 Tailscale 控制端的
自托管实现。整个项目的开发遵循几条原则：

- **开箱即用**：我们希望 Headplane 尽可能容易安装和使用，同时仍然为进阶用户提供强大
  的功能。这意味着要优先保证界面干净直观，以及安装与配置流程简单直接。

- **不做破坏性变更**：我们希望尽可能避免破坏性变更。这意味着要保持向后兼容，并在必须
  变更时提供清晰的迁移路径。

- **文档**：这是项目最重要的部分。没有文档，整个项目就会散架，也难以使用。

> 本文件由本分支维护，使用中文书写。

## 本分支（HeadplaneCN）

本仓库是 HeadplaneCN，即 `tale/headplane` 的分支（fork），面向自托管 NAS 场景调优，
最典型的是飞牛 fnOS：Headscale 以原生进程运行，而本面板跑在 Docker 里、前面挂反向
代理。上游的一切功能都照常工作：把上游行为当作基线，尽量不要改动它。

本分支新增的功能都自成体系，每项都有对应的路由与服务端模块，`README.md`（中文）是
它们面向用户的说明：

- **DERP 地图在线编辑** —— `app/routes/settings/headscale/derp-map-*.ts`（校验
  schema、检查项、限制、模板），配合 `app/server/headscale/derp-map-*.ts` 与
  `derp-region-*.ts` 读取并校验 `derp.paths` 中列出的文件。只有在可写挂载下才允许
  保存，且保存前会先做快照。
- **DERP 区域镜像** —— `app/server/derp-mirror/` 把 Tailscale 官方公共区域镜像成本地
  地图文件，重新编号到 900 段：从 901 起按实测延迟排序（没有固定区域，默认一个都不勾
  选），已分配的编号保持稳定。
- **中继地址同步** —— `app/server/derp-sync/` 探测公网地址，只写入真正发生变化的那几
  个 `derp.server.ipv4` / `ipv6` 键，写前快照、写后记入审计，失败时发出告警。它的
  「检查」路径必须保持只预演、不写入。
- **告警、快照与审计** —— `app/server/alerts/`、`app/server/snapshots/` 与
  `app/server/audit/`，界面由 `app/routes/settings/` 下的同名目录承载。

## 项目管理

这个项目不太容易管理，处理问题时请用 `gh` CLI 获取上下文。需要关注的常见 issue 标签
包括 "Needs Triage"、"Needs Info"、"Bug"、"Enhancement"，以及若干按项目受影响部分
划分的标签。

## Headplane Agent

Headplane Agent 是一个轻量组件，与 Headplane 跑在同一台服务器上，直接连接到
Tailnet，用来拉取 Headscale API 拿不到的节点信息，例如版本号等。

## WebSSH

这是一个临时的 WASM 模块，在浏览器中运行，使用 Tailscale 的 Go 包直接连接到
Tailnet。它允许任何人在 Tailnet 中开一台临时机器，直接 SSH 到目标节点。

## 界面语言（i18n）

共提供三种语言（英文、简体中文、繁體中文），英文既是词条键的事实源，也是每条文案结构
的事实源。

- `app/i18n/locales/en.ts` 是词条表。`app/i18n/catalog.ts` 由 `typeof en` 推导出
  `Catalog`，并把 `TranslationKey` 推导成点号分隔的路径联合类型；因此新增文案要先写进
  `en.ts`，中文词条只需匹配它的结构，而不必逐字对应。
- 一种语言只在两个列表里声明：`app/i18n/index.ts` 里的 `catalogs` 记录，以及
  `app/utils/locale.ts` 里的 `LOCALES`（连同 `matchLanguageTag`）。两者必须同步。
- 组件通过 `app/i18n/provider.tsx` 的 `useT()` / `useI18n()` 取文案。`t(key, vars)`
  返回普通字符串，占位符写作 `{name}`；`tr(key, vars)` 会插入 JSX，让各语言的语序可以
  不同。缺少的键回落到英文，未知的键原样返回键名。
- `Plural { one, other }` 只给确实需要的语言使用。
- 语言在服务端由 `getLocale()` 决定：优先读长效、lax 的 `locale` cookie（与
  `color_scheme` 的做法一致），其次读 `Accept-Language`，最后用英文。
  `app/routes/util/locale.ts` 是切换入口，它除了表单体也会读查询串，因为反向代理丢掉
  POST body 曾经让切换器失效。
- Headscale API 报错、服务端日志与内部校验信息保持英文，不要翻译。
- 每条面向用户的文案都要补齐三种语言。缺翻译时运行期会退化成英文，类型检查也照样
  通过，所以中文词条需要自己核对。`docs/features/languages.md` 及其 `docs/en/` 镜像
  描述了用户实际看到的行为。

## 构建与工具

Headplane 是 React Router 7（framework mode）项目，用 Vite 构建。请使用
`package.json` 的 `engines` 字段指定的 PNPM 与 Node 版本：Node `>=24.2 <25`、
pnpm `>=10.4 <11`，`packageManager` 固定为 `pnpm@10.4.0`。`preinstall` 钩子会执行
`npx only-allow pnpm`，因此用 npm 或 yarn 安装会被拒绝。

类型检查用 `pnpm run typecheck`；lint 与格式化分别用 `lint`、`format` 脚本，可以给它们
传参数。开发环境跑起来之后，也可以用
`docker exec headscale headscale <command>` 执行 Headscale CLI 命令。

## 仓库结构

- `app/` 是 React Router 7 应用：`routes/`（文件路由，附带生成的 `+types`）、
  `components/`、`layout/`、`hooks/`、`i18n/`、`utils/`，以及 `server/`——与路由相邻
  的服务端模块（`headscale/` 是 API 客户端与 DERP 地图文件的处理，另有
  `derp-mirror/`、`derp-sync/`、`alerts/`、`audit/`、`snapshots/`、`history/`、
  `db/`、`config/`、`oidc/`、`web/`）。
- `internal/` 是 Go 包：`config/`、`tsnet/`、`util/`。
- `cmd/` 是 Go 入口：`hp_agent/`（agent）、`hp_ssh/`（WebSSH 的 WASM 模块，构建标签
  见 `build-tags.txt`）、`hp_healthcheck/`、`fake_sh/`。
- `drizzle/` 存放面板自身 SQLite 数据库的 SQL 迁移；`app/server/db/schema.ts` 是事实
  源，`drizzle.config.ts` 是配置。
- `docs/` 是 VitePress 文档站。中文是根目录下的默认语言，英文镜像在 `docs/en/`；功能
  文档按主题放在 `docs/features/`。两种语言要同步维护。
- `patches/` 存放针对内置 tsconnect 类型的补丁，已经应用。
- `scripts/` 存放 `release.ts`、`dual-image-install.sh`、`sync-tsconnect.sh`。

## 环境与常用命令

命令以 `package.json` 为事实源，需要记住的有：

- `pnpm run dev:app` 只启动面板，并指向 `config.example.yaml`。它的
  `HEADPLANE_CONFIG_PATH=... command` 写法是 POSIX shell 语法，所以在 Windows 上请放到
  WSL 或 Git Bash 里跑，或者自己设置该环境变量。
- `pnpm run dev:docker` 用 Docker Compose 拉起整套开发环境；`pnpm run dev` 会并行执行
  所有 `dev:*` 脚本。
- `pnpm run typecheck` 实际执行的是 `react-router typegen && tsc`。其中 codegen 这一步
  才会写出 `+types` 路由类型，所以别急着相信编辑器的报错。带类型的 lint 来自 oxlint 的
  `oxlint-tsgolint` 插件，而不是另一个独立的类型检查器。
- `pnpm run test:unit` 与 `pnpm run test:integration` 是 Vitest 项目，配置在
  `vitest.config.ts`；`pnpm run lint` 与 `pnpm run format` 分别是 oxlint 和 oxfmt。
- `pnpm run docs:dev`、`docs:build`、`docs:preview` 用于 VitePress。

## 文档

项目在 `docs/` 目录下有一份用 VitePress 构建的文档站。文档用 Markdown 编写，容易修改
和扩展。如果改动了主要功能，请记得同步更新文档，以反映功能或用法上的变化。

## 发布

每个面向用户的改动都要在 `CHANGELOG.md` 的 `# Next` 小节里加一行，放在 `## Changes`
或 `## Fixes` 下。日常用户正是通过文档站读这一节，所以要写成面向他们的说明文字，而不
是提交摘要。直接写在 `# Next` 之下、小标题之上的文字会成为发布前言，用来写兼容性说明
和升级提醒。

要发版就运行 `pnpm release cut <version>`：它会把 `# Next` 改名为版本号、更新
`package.json`、提交并打标签。推送标签后会构建镜像，并用 changelog 中的这一节发布
GitHub Release。
