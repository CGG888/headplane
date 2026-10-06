---
title: 配置快照
description: Headscale 配置的自动备份，一键恢复。
outline: [2, 3]
---

# 配置快照

HeadplaneCN 会替你写 Headscale 的 `config.yaml` —— DNS、OIDC、策略模式、DERP、日志。
**设置 → 配置快照**在每次写入之前留一份该文件的副本，所以一次后悔的改动只差一次点击就能
撤销。

## 快照里有什么

| 文件                            | 何时包含                     |
| ------------------------------- | ---------------------------- |
| Headscale 的 `config.yaml`      | 每个快照都包含               |
| 策略文件（`policy.path`）       | 当 `policy.mode` 为 `file` 时 |

每个快照是 `server.data_path/snapshots/` 下的一个目录，目录名由时间戳和产生它的原因
（`settings`、`dns`、`manual` 等）组成，并附带一份页面读取的小索引。

::: tip 把数据目录挂出来
快照放在 `server.data_path`（默认 `/var/lib/headplane/`）下。那里没有卷挂载时，容器一重建
它们就没了 —— 而那正是你最需要它们的时候。
:::

## 创建与恢复

- 在做有风险的操作之前，手动**创建快照**。
- **下载**快照里的任意文件，另存到别处。
- **恢复**会把记录下来的文件写回配置中的路径，通过已配置的集成请 Headscale 重载或重启，
  并记一条审计。除了 Headscale 配置实际指向的路径，它拒绝写到任何其他地方。

恢复会替换当前文件，因此页面会要求确认，并要求 `configure_iam` 能力。恢复后的配置通常
还需要一次重启才能生效。

::: danger 不是数据库备份
快照覆盖的是 Headscale 的**配置**，不是它的数据库。请单独备份 `db.sqlite`（或你的
Postgres 数据库）—— 停掉 Headscale 再复制文件，或者用 SQLite 的 `.backup`，保证副本一致。
:::
