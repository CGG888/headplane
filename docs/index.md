---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

hero:
  name: "Headplane"
  tagline: "Headscale 的全功能管理界面"
  image:
    src: "/logo.svg"
    alt: "Headplane"
  actions:
    - text: "快速上手"
      link: "/install"
    - text: "功能说明"
      link: "/features/overview"
      theme: "alt"
    - text: "English"
      link: "/en/"
      theme: "alt"
    - text: "赞助"
      link: "/sponsor"
      theme: "alt"

features:
  - title: "浏览器内远程 SSH"
    details: "直接在浏览器里通过 SSH 连接并管理机器"
    icon: "🌐"
  - title: "单点登录"
    details: "通过 OpenID Connect 接入你自己的身份认证，支持 Google Workspace、Azure/Entra、Okta 等"
    icon: "👥"
  - title: "详细的 Tailnet 总览"
    details: "查看 Tailnet 内每台设备的主机与网络信息"
    icon: "🔎"
  - title: "Headscale 设置管理"
    details: "管理藏在 Headscale 配置里的设置：DNS、网络、认证控制等"
    icon: "📝"
---

## 本仓库相对上游的差异

这里是 [`CGG888/headplaneCN`](https://github.com/CGG888/headplaneCN)，是
[Headplane](https://github.com/tale/headplane) 的一个分支，针对自建 NAS 环境
（尤其是 fnOS 飞牛）做了补充。下面列出的就是本仓库相对上游新增或改动的内容
——这份清单本身就是两个版本的差别。

- **fnOS（飞牛）与原生 Headscale 的集成。** 文档和 compose 示例覆盖「Headscale
  在 fnOS 上以原生进程运行、Headplane 跑在容器里」这种部署：用 `pid: host` 让
  `integration.proc` 找到并给 `headscale serve` 发信号，并把 Headscale **实际生效**
  的 `config.yaml` 以**读写**方式挂载，DNS 与设置页面才会出现。最容易踩的一条：
  `derp.paths` 是**宿主机上的 Headscale** 读的，每个条目必须是**宿主机路径**，
  并且该目录要以**完全相同的绝对路径**挂进容器。只存在于容器里的路径在界面上看着正常，
  却会让 Headscale 起不来（`getting DERPMap: open …: no such file or directory`）；
  处理办法是删掉该条目、或回滚写入前的快照，然后重启。见
  [fnOS 部署指南](/install/fnos) 与
  [在线编辑本地 DERP 地图文件](/features/headscale-settings#在线编辑本地-derp-地图文件)。
- **在浏览器里直接编辑 DERP 地图文件。** `derp.paths` 里的每个路径都有查看、编辑、
  保存和回滚，还能用**从示例创建**载入三份带注释的模板。保存时会在服务端按 DERP 地图
  结构校验（区域 id 与 code 唯一、每个节点的区域、主机名、端口），写入前先对文件做快照，
  回滚同样会先快照被覆盖的内容。见
  [在线编辑本地 DERP 地图文件](/features/headscale-settings#在线编辑本地-derp-地图文件)。
- **中继地址自动同步。** 可以按 6/12/24 小时定时，也可以点**立即运行**：检测
  `derp.server.ipv4`/`ipv6`，**只写入真正变化的那一个键**，写之前先做配置快照并记录审计。
  自动重载**默认开启**，客户端能立刻拿到新地址——代价是重载会短暂中断已连接的客户端。
  IPv4 取自 `server_url` 域名的 A 记录，IPv6 取自宿主机自己的全局单播地址。见
  [地址自动同步](/features/headscale-settings#地址自动同步)。
- **外部 IPv6 回显，用来看路由器转发/转换后的真实地址。** 可选项：问一个公网端点
  「互联网看到的我是什么地址」。当路由器做 NAT66 或地址转换、本机网卡上根本没有那个地址时，
  它才是权威答案。**默认关闭**（会访问第三方），且只走 IPv6。见
  [中继真的能通过 IPv6（或 IPv4）访问吗？](/features/headscale-settings#中继真的能通过-ipv6-或-ipv4-访问吗)。
- **官方区域节点筛选。** 把 Tailscale 的官方公共 DERP 区域镜像成你自己的本地地图文件，
  只保留勾选的区域，并**重新编号到 900 段**：**901 固定香港、902 固定新加坡**，其余按你
  自己的机器实测延迟排序（没测过的排最后）。编号会保持稳定，客户端不会因为一次延迟变化
  就换中继，只有**重新编号**才会打乱重排。见
  [官方区域节点筛选](/features/headscale-settings#官方区域节点筛选)。
- **告警通知。** 填一个 webhook 地址，节点离线、Headscale 失联（以及恢复）、密钥即将过期、
  配置检查由通过变为失败、以及**真正写入**的 DERP 地址/区域任务失败时，都会推送 JSON。见
  [告警通知](/features/notifications)。
- **配置变更的快照与审计日志。** Headplane 在写入配置前留下快照，改错了可以一键恢复；
  每次写入都会记账，能看清谁在什么时候改了什么。见
  [配置快照](/features/snapshots) 与 [操作审计](/features/audit)。
- **机器列表与详情页的改进。** 按区域显示的延迟不再是一律「未知」，而是解析出真实区域名；
  中继的 IPv4/IPv6 带一键复制；列表几乎每一列都能筛选和排序；勾选后可以进行批量操作。见
  [机器管理](/features/machines) 与 [批量机器操作](/features/bulk-operations)。
- **三种界面语言，以及默认关闭的实时更新。** 界面内置英文、简体中文和繁体中文，无需任何配置。
  顶部菜单里的**实时更新**开关**默认关闭**，页面不会再每隔几秒在后台自己刷新。见
  [多语言](/features/languages)。
- **赞助完全自愿。** 如果这个分支帮你省了时间，[赞助页](/sponsor) 提供微信和支付宝
  收款码；它不会改变软件的任何行为。

本项目基于上游 [Headplane](https://github.com/tale/headplane)（作者
[tale](https://github.com/tale)），上游署名、许可证和原有功能都完整保留。
上面没有列出的部分，都是上游的工作。
