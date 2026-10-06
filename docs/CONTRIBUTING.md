# 为 HeadplaneCN 贡献代码

感谢你有兴趣为 HeadplaneCN 做出贡献。这个项目完全由我一个人维护，所以任何帮助都非常宝贵。由
于我是唯一的维护者，我制定了几条准则，它们能让我更轻松地审阅并合并你的贡献。

## 贡献类型

- **Bug 报告 / 功能请求**：如果你发现了 Bug，请使用预置模板之一提交
  [issue](https://github.com/CGG888/headplaneCN/issues)。Issue 只用于 Bug 报告和功能请求，
  不用于处理配置错误或使用方式带来的问题 —— 那些请发到
  [discussions](https://github.com/CGG888/headplaneCN/discussions) 区。

- **文档 / 示例**：如果你发现文档中的问题，或者想贡献 HeadplaneCN 的搭建示例，请提交 PR，
  我会审阅并可能对其做出修改。

- **代码贡献**：代码贡献通过 PR 提交，但**必须**关联到一个 issue 或功能请求（没有的话可以
  自己新建一个）。创建 issue 或 PR 时，请为它们加上合适的标签。

### 代码贡献的限制

- **不接受大规模重构**：我对代码库的大规模重构没有兴趣，因为我已经做过太多次，审阅、维护和
  合并都成了负担。这也意味着，彼此无关的多个贡献应该拆分成多个 PR。

- **不接受项目 / 工具链改动**：除非有非常充分的理由，我不会接受对项目结构、构建系统或开发
  HeadplaneCN 所用工具链的改动，包括更换包管理器、Docker 环境或 CI/CD 等。

- **尽量不引入破坏性变更**：除非有非常充分的理由，我不会接受任何破坏现有功能或改变 API 的
  改动。如果你想做破坏性变更，请先开一个 issue 和我讨论。

### 代码风格

这一点非常简单明了。TypeScript 使用 [oxlint/oxfmt](https://oxc.rs) 作为 linter 和格式化
工具，而 `cmd/` 中的代码使用 Go 默认的格式化与 lint 工具。我已经配置了 git hook，在提交前
自动完成这些修改。

> 所有这些准则都很容易遵守，必要时也可以灵活处理。如果 PR 或 issue 没有遵循这些规则，我
> 不会直接关闭，而是可以一起讨论，看看能否达成折中方案。

### 贡献所需的工具

如果你打算处理 WASM SSH agent，需要安装 `mkcert` 或同类工具，用于在 `./test/caddy/certs`
中生成证书。该目录下需要有 `localhost.pem` 和 `localhost-key.pem` 两个文件。PNPM 已经提供了
一条脚本，直接运行 `pnpm mkcert` 即可。

### 开发容器

本仓库在 `./.devcontainer` 中提供了一套 Dev Container 配置，包含：

- Node.js
- PNPM
- Go
- Nix
- `mkcert` 及相关的本地证书工具

用 VS Code（或任何兼容 Dev Container 的编辑器）打开仓库并启动容器即可。首次创建时会通过
`pnpm install` 自动安装依赖。

基础镜像是 Debian（而不是 Alpine），以便与本项目使用的常见官方 Dev Container 特性
（Node、Go 和 Docker）保持兼容。
