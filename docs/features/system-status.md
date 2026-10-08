---
title: 系统状态
description: Headscale 版本、更新提示、诊断、指标，以及重载/重启按钮。
outline: [2, 3]
---

# 系统状态

**设置 → 系统**回答那些本来要 SSH 到 Headscale 主机上才能查的问题：它健康吗、是哪个版本、
有没有配错、能不能从这里重启。

[功能总览](/features/overview) 页给出了它的速览版本：诊断与配置检查的通过/警告/失败
计数，与版本、内嵌 DERP 区域和 tailnet 数量并列。要看逐项检查、指标面板和重载/重启控件，
请打开这个页面。

## 版本与更新

卡片显示正在运行的 Headscale 版本，以及在能判断时是否有更新的版本。更新提示从 GitHub 查询，
带短超时并缓存数小时；在离线或受限网络上查询只会没有结果，也不显示任何标记，因此页面从不
依赖互联网访问。

查询先走原地址（`https://github.com/<owner>/<repo>/releases/latest` 的 302），只有连不上时才
按顺序走内置镜像前缀（把原地址接在镜像后面，例如 `https://ghproxy.net/https://github.com/...`），
成功过的那条路线下次会先试。要换成自己的镜像，设 `HEADPLANE_RELEASE_MIRROR=https://你的镜像/`
（多个用逗号分隔，`off` 关闭镜像回退）；如果你有真正的 HTTP 代理，给面板进程加上
`NODE_USE_ENV_PROXY=1` 与 `HTTPS_PROXY=http://代理地址:端口` 即可，Node 24 会让查询走代理。

HeadplaneCN 也会对**自己**做同样的比较，对象是 GitHub 上的最新 HeadplaneCN 版本，超时与缓存
相同。只有当本构建上报的版本（构建时写入）严格更旧时，页面顶部才会出现提示并链接到该发布
版本。查询失败、没有打标签的开发构建，以及已经上报该版本或更新版本的构建都保持沉默，因此
自定义构建不会一直被上游版本骚扰。

## 诊断

每一行是一项检查，带通过 / 警告 / 失败状态、说明，以及在有帮助时指向修复页面的链接：

| 检查               | 为什么重要                                                                                         |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| Headscale 可达     | `GET /health` —— 这项失败时，页面其余内容都没有意义。                                              |
| API 密钥有效       | HeadplaneCN 的 `headscale.api_key` 必须仍然可用；密钥过期会让每个页面都失效。                      |
| 版本足够新         | HeadplaneCN Agent 与浏览器 SSH 需要 Headscale 0.28+；更新的版本修复了真实缺陷，0.29.2 是推荐基线。 |
| 策略模式           | `policy.mode: file` 时访问控制编辑器无法通过 API 保存；`database` 可以。                           |
| 已配置 OIDC        | 浏览器 SSH 要求用户通过 OIDC 登录，因此需要一个可用的 OIDC 段。                                    |
| 可信代理           | 在反向代理后面，只有当代理所在网段列在 `trusted_proxies` 中时，Headscale 才能看到真实客户端地址。  |
| Headscale 配置可读 | 只有 `headscale.config_path` 已挂载时，DNS 页和 Headscale 设置页才能读取（或写入）。               |
| 集成已启用         | 没有集成时 HeadplaneCN 无法替你重载或重启 Headscale。                                              |

## 配置检查

页面还会读取 Headscale 的配置文件本身，报出那些平时只表现为「服务器起不来」或「某个设置
悄悄不生效」的问题：

::: tip 容器看不到的路径
HeadplaneCN 只能检查它真正能访问到的路径。当它拿到 Headscale 的 `config.yaml`、却没有拿到
该文件指向的目录时，配置里那些**宿主机绝对路径在容器里并不存在**（例如 `db.sqlite`、
`derp.paths` 里的地图文件），尽管它们在宿主机上完全健康。这类检查会报成**无法验证**
（并给出路径和挂载提示），而不是判为失败。把该目录以只读方式挂进容器，它们就会变成真正的检查。
双镜像形态下数据目录以**同一绝对路径**挂载，所以不会缺这些路径。
:::

| 检查               | 为什么重要                                                                                                                                                                                   |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 已移除的键         | `oidc.expiry`、`oidc.strip_email_domain` 和 `oidc.map_legacy_users` 在 0.29 已删除，存在时 Headscale **拒绝启动**。                                                                          |
| 可信代理范围       | `0.0.0.0/0` 与 `::/0` 是配置错误。                                                                                                                                                           |
| TLS 与 ACME        | 配置了证书或 Let's Encrypt 主机名但文件不存在就无法提供服务；`server_url` 用 `http` 同时又配了 TLS 通常是笔误。                                                                              |
| 数据库             | SQLite 目录缺失或只读会让 Headscale 什么都写不进去。                                                                                                                                         |
| 策略文件           | `policy.mode: file` 时，`policy.path` 为空意味着**允许一切**。                                                                                                                               |
| DNS 记录           | `dns.extra_records` 与 `dns.extra_records_path` 同时设置时，内联记录会被静默忽略。                                                                                                           |
| OIDC 一致性        | 有 issuer 却没有 client ID、PKCE 方法未知，或者同时存在密钥与密钥文件。                                                                                                                      |
| Noise 密钥         | 配置了 `noise.private_key_path` 但文件不存在（Headscale 会在首次启动时生成它）。                                                                                                             |
| 本地 DERP 地图文件 | `derp.paths` 的每一条都会单独成行 —— 文件是否存在、是否可读、是否可写、是否在大小上限内、YAML 能否解析、是不是有效的 DERP 地图、区域 ID 与区域代码是否唯一。容器看不到的路径报**无法验证**。 |

本地地图那几行与 [设置 → Headscale → DERP](/features/headscale-settings) 里每个路径
旁的检查是同一批；在这里它们属于一份可以从头读到尾的列表，而且每一行都会写出它检查的文件。

变成失败的检查也可以直接推到 Webhook，而不必等你来看；见
[告警通知](/features/notifications)。

## 指标

**指标**标签替你读取 Headscale 的 Prometheus 端点。其中一切都是只读的 —— 不会写回
Headscale —— 而且它失败得很温和：拿不到数字时会说明原因，而不是把页面弄坏。

地址来自 Headscale 自己的 `metrics_listen_addr`。缺失或为空表示监听器未开启，标签会照实
说明；不是 `host:port` 的值会报成无法解析。当 HeadplaneCN 完全读不到配置文件时，它会说无法
判断监听器在哪里，而不是声称监听器被禁用。Headscale 常把监听器绑到 `0.0.0.0` 或 `[::]`，
这两个地址照原样是连不上的 —— 这种情况下 HeadplaneCN 会用你配置的 Headscale URL 的主机名。
随后它在服务端以短超时抓取 `http://<地址>/metrics`，因此该监听器必须对 HeadplaneCN 自己可达，
而不只是对运行 Headscale 的那台机器可达。

成功时标签页显示：

| 显示项                                        | 来源                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------ |
| 运行时长                                      | `process_start_time_seconds` 与当前时间。                                |
| Goroutines                                    | `go_goroutines`。                                                        |
| 节点、用户、DERP 与中继、策略、进程（各一组） | 名称匹配该组的指标族，按其上报的样本求和；样本数多于一条时会显示序列数。 |

其余内容仍在 **原始指标** 下可用，它按 HeadplaneCN 收到的原样显示 exposition 文本。

连接被拒、超时、非 200 响应或正文里没有可解析的样本，最终都是同一条警告提示，它会写出
HeadplaneCN 尝试的端点以及推导出的地址 —— 最常见的原因是监听器绑在回环地址上，而 HeadplaneCN
跑在另一个容器里。

::: info 面板略去了什么

直方图和摘要被丢弃 —— 它们的 `_bucket`、`_sum`、`_count` 序列不是那种能直接从状态页读出
的数字。每组最多保留 12 个指标族，避免繁忙端点把标签页变成一堵数字墙；原始视图保留前
16,000 个字符，超过时会明确说明。

:::

## 重载或重启 Headscale

按钮的行为取决于配置了哪种集成：

| 集成                           | 按钮做什么                                                                            |
| ------------------------------ | ------------------------------------------------------------------------------------- |
| `integration.proc`（原生安装） | 向 `headscale serve` 进程发送 **SIGHUP** —— 它只就地把**访问策略（ACL）**重新读一遍。 |
| `integration.docker`           | 重启 Headscale 容器。                                                                 |
| `integration.kubernetes`       | 重启 Headscale Pod。                                                                  |

没有启用任何集成时按钮是禁用的，页面也会说明；请按你服务管理器的方式重启 Headscale。

重载或重启失败时页面会说明卡在哪一步：没找到 `headscale serve` 进程、集成尚未配置、没有权限
发送信号（容器里的面板向宿主机原生进程发信号时就是 `kill EACCES` —— Docker 默认的 AppArmor
配置 `docker-default` 不允许向 `unconfined` 的进程发信号，`dmesg` 里是
`apparmor="DENIED" operation="signal" ... signal=hup peer="unconfined"`）、信号已发出但
`/health` 没有确认、信号发不出去，以及该集成不支持这个操作。0.22.21 之前，被拒绝的重载会被当成
成功。

HeadplaneCN 跑在容器里、Headscale 以原生进程运行（fnOS 的 fpk 安装）时，容器除了
`pid: host` 还必须写 `security_opt: ["apparmor=unconfined"]`，否则 AppArmor 会拒绝 SIGHUP，重载
只能以失败告终。双镜像部署不需要这一条：那边 Headscale 也是容器，面板通过 Docker socket 重启
它，全程没有跨进程信号。

::: tip 原生安装与「立即重启 Headscale」
SIGHUP 只重载访问策略：改完 DNS、OIDC 或 `trusted_proxies` 之后它不会让改动生效，只有重新读取
配置文件（也就是重启进程）才会。原生安装下 HeadplaneCN 默认不替你重启 —— 把
`integration.proc.allow_restart` 设为 `true`（默认 `false`），进程控制卡片上才会出现
**立即重启 Headscale** 按钮。点击前会先确认，并提醒你重启期间所有节点都会短暂断线；它只发送
SIGTERM，然后等一个新的 `headscale serve` 出现，因此 Headscale 必须由 systemd、s6 之类的监管
程序负责拉起，没有监管程序时不要用它。

DERP 相关设置在保存后由 HeadplaneCN 自动处理：Docker 集成会重启容器，原生集成在
`allow_restart` 打开时重启进程，否则页面提示还需要你手动重载。只有「改动限于 `derp.paths` 里地图
文件的内容，且 `derp.auto_update_enabled` 为 `true`」时才不用重载 —— Headscale 自己会在
`derp.update_frequency` 内重新读取地图文件。
:::
