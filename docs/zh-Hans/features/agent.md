---
title: Headplane Agent
description: 配置 Headplane Agent 以获得更完整的功能。
---

# Headplane Agent

Headplane Agent 是一个可选组件，它会定期从 Tailnet 同步节点信息（版本、操作系统详情等）。
与早期版本不同，Agent 不再需要你手工创建或管理预授权密钥 —— Headplane 在每次 Agent 启动时
生成一把新密钥，并在重启之间复用 Agent 已有的 Tailnet 状态。

## Agent 带来了什么

Headscale API 只知道控制服务器自己看得到的东西。机器自己测量到的一切都通过 Agent 到来：

| 显示位置 | 数据 |
| --- | --- |
| 机器列表与详情 | 客户端版本、操作系统与主机详情 |
| 机器详情 | **DERP 中继**：home 与 preferred 区域、该区域是否是你自己的**内嵌 DERP 服务器**，以及到各区域的实测延迟 |
| Headscale 设置 → DERP | 每台机器的中继表 |

没有 Agent 时，这些页面会说明需要 Agent，而不是显示空表 —— 控制服务器本身不携带这些数据。

## 机器上的中继卡片

机器详情页有一张 **DERP 中继**卡片，分两半。

**客户端可达的中继**是只读的，显示 Headscale 下发给客户端的内容：由 `server_url` 推导出的
端点，然后是 `derp.server` 声明的 **IPv4** 与 **IPv6** 地址 —— 与
[Headscale 设置](/features/headscale-settings)卡片管理的是同一批值 —— 每个都带复制
按钮、与主机名实际解析结果的比对结论，以及本次查询使用的解析器。它不配置任何东西，只链回
设置卡片去看刷新计划、地址族和探测面板。

**该机器使用的中继**需要 Agent，列出 home 与 preferred 区域以及实测延迟（最快的在前）。
区域名走与设置页相同的解析链：手工区域名映射、`derp.paths` 里的地图文件、`derp.urls` 拉取
的地图，最后是 Headscale 的内嵌区域；都不认识的区域直接显示 ID。Agent 按 Tailscale 自己的
键上报延迟 —— `<regionID>-v4` 与 `<regionID>-v6` —— 因此同时用两个地址族测量过的区域只会
出现**一次**，显示最快的那个样本；不自带区域的键（旧的 `host:port`、或区域代码）会先去
配置的地图里匹配，匹配不到就按原样显示。

## 前置条件

启用 Agent 之前请确认：

1. **需要 Headscale 0.28 或更新版本。** Agent 使用只有标签的预授权密钥，而该特性从
   Headscale 0.28 起才可用。

2. **必须在 Headplane 配置文件里设置 `headscale.api_key`。** Agent 用这把密钥自动生成连接
   Tailnet 所需的预授权密钥，并在 Headscale 配置为需要人工批准时自动批准自己的注册。

## 配置

要启用 Headplane Agent，需要修改 Headplane 配置文件里的以下字段。关于 Headplane 配置的
更多信息，请参考[示例配置](https://github.com/tale/headplane/blob/main/config.example.yaml)。

| 字段                                | 说明                                                                              |
| ----------------------------------- | --------------------------------------------------------------------------------- |
| **`integration.agent.enabled`**     | 设为 `true` 以启用 Agent。                                                        |
| `integration.agent.host_name`       | _可选_。Agent 的 Headscale 用户名（默认：`headplane-agent`）。                     |
| `integration.agent.cache_ttl`       | _可选_。同步间隔，单位毫秒（默认：`180000` / 3 分钟）。                            |
| `integration.agent.work_dir`        | _可选_。Agent 的 tailnet 状态工作目录。                                            |
| `integration.agent.executable_path` | _可选_。Agent 二进制文件路径（默认：`/usr/libexec/headplane/agent`）。             |
| `integration.agent.tailscale_netns` | _可选_。使用 Tailscale 的套接字级路由环路处理（默认：`true`）。                    |

## 原生模式配置

在本地构建 Headplane 之后，`./build` 目录里会有一个名为 `hp_agent` 的二进制文件。请把它
移到 `/usr/libexec/headplane/agent`，并确保它有可执行权限。

::: tip
如果因为某些原因无法把二进制文件放到目标位置，可以在 Headplane 配置文件里设置
**`integration.agent.executable_path`**，指向 Agent 二进制文件的实际位置。
:::

Agent 默认还会使用 `/var/lib/headplane/agent` 作为数据目录。你可以在 Headplane 配置文件里
设置 **`integration.agent.work_dir`** 来更改位置。请确保该目录存在，并且运行 Headplane 的
用户对它可写。

Headplane 会把 Agent 的 `tailscaled.state` 保留在这个目录里。这样 Agent 在 Headplane 重启
后仍能保留自己的 Tailnet 身份，而不是每次都注册成新主机。如果 Agent 的状态丢失或不可用，
Headplane 会退回使用预授权密钥，注册一个新的 Agent 节点。

## Tailscale 套接字路由处理

默认情况下，Agent 使用 Tailscale 的套接字处理，避免由 Tailscale 发起的流量被路由回
Tailscale 管理的路由。Tailscale 会尝试给它的出站套接字打上绕过标记，好让自身的路由与策略
机制识别这些流量。

在丢弃全部能力（capabilities）的容器里，`SO_MARK` 会返回 `EPERM`。这不会破坏容器的路由；
它会让 Tailscale 退回到 `SO_BINDTODEVICE(DefaultRouteInterface())`。在多网络容器中，这个
回退可能把 Agent 与 Headscale 的连接钉在默认接口上，尽管容器的 Linux 路由表里有一条正确
的、经另一个接口到 Headscale 的路由。在这种拓扑下，选择通往 Headscale 的接口靠的并不是
`SO_MARK` 成功，普通的按目标路由已经做出了正确的选择。

在确认容器网络命名空间里的普通操作系统路由可以正确到达 Headscale 之后，Agent 可以改为
依赖这套路由：

```yaml
integration:
  agent:
    enabled: true
    tailscale_netns: false
```

把它设为 `false` 只会在专用的 `hp_agent` 进程里关闭 Tailscale 的 mark-or-bind 套接字处理。
`hp_agent` 与主 Headplane 进程仍然共享容器的 Linux 网络命名空间。主进程的网络行为、容器
能力、Docker 网络、接口、路由表和默认网关都不变。除非已经确认该回退会选中错误的接口，否则
请保持开启；裸机部署和经由 Tailscale 路由的部署可能依赖它的环路避免行为。

## 交互式批准

正常情况下 Agent 用自动生成的预授权密钥无交互地连接，不需要人工介入。如果你的 Headscale
服务器配置为需要交互式批准，Headplane 会检测 Agent 打印的认证 URL，并用配置的
`headscale.api_key` 自动批准请求。设置页仍会显示批准链接作为兜底，以防自动批准失败。

## 使用

<figure>
    <img class="dark-only" src="../../assets/preview-dark.png" />
    <img class="light-only" src="../../assets/preview-light.png" />
    <figcaption>Headplane 看板</figcaption>
</figure>

启用并配置 Headplane Agent 之后，重启 Headplane 实例。你应该会在界面里看到更多内容，例如
每个节点的主机信息，以及在节点启用 Tailscale SSH 时直接从浏览器打开 SSH 会话的能力。

<figure>
    <img class="dark-only" src="../../assets/machine-dark.png" />
    <img class="light-only" src="../../assets/machine-light.png" />
    <figcaption>机器页面</figcaption>
</figure>
