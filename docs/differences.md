---
title: 与上游 Headplane 的差异
description: headplaneCN 相对上游 Headplane 新增或改动的内容，一张卡片一项。
outline: [2, 3]
---

# 与上游 Headplane 的差异

本仓库是 [`CGG888/headplaneCN`](https://github.com/CGG888/headplaneCN)，是
[Headplane](https://github.com/tale/headplane) 的一个分支，主要面向自建 NAS
环境（尤其是 fnOS 飞牛）做了补充。本页把本分支相对上游新增或改动的内容逐项列出。

## 本分支新增或改动的内容

<div class="feature-grid">
<div class="feature-card">

### fnOS 与原生 Headscale 集成

覆盖「Headscale 以原生进程跑在 fnOS 上、HeadplaneCN 跑在容器里」这种部署：
`pid: host` 让 `integration.proc` 找到 `headscale serve` 并给它发信号，而
Headscale **实际生效**的 `config.yaml` 需要以**读写**方式挂载，DNS 与设置页面
才会出现。最容易踩的一条是 `derp.paths`：它由**宿主机上的 Headscale** 读取，
每个条目必须是**宿主机路径**，并且该目录要以**完全相同的绝对路径**挂进容器；
只存在于容器里的路径在界面上看着正常，却会让 Headscale 起不来
（`getting DERPMap: open …: no such file or directory`）。处理办法是删掉该条目、
或回滚写入前的快照，然后重启。

[fnOS 部署指南 →](/install/fnos)

</div>
<div class="feature-card">

### 浏览器内编辑 DERP 地图文件

`derp.paths` 里的每个路径都能查看、编辑、保存和回滚，还可以用**从示例创建**载入
三份带注释的模板。保存时会在服务端按 DERP 地图结构校验（区域 id 与 code 唯一、
每个节点的区域、主机名、端口），写入前先对文件做快照，回滚同样会先快照被覆盖的
内容。

[Headscale 设置 →](/features/headscale-settings)

</div>
<div class="feature-card">

### 中继地址自动同步

可以按 6/12/24 小时定时，也可以点**立即运行**：检测 `derp.server.ipv4`/`ipv6`，
**只写入真正变化的那一个键**，写之前先做配置快照并记录审计。自动重载**默认开启**，
客户端能立刻拿到新地址——代价是重载会短暂中断已连接的客户端。IPv4 取自
`server_url` 域名的 A 记录，IPv6 取自宿主机自己的全局单播地址。

[Headscale 设置 →](/features/headscale-settings)

</div>
<div class="feature-card">

### 外部 IPv6 回显

可选项：问一个公网端点「互联网看到的我是什么地址」，用来看路由器转发或转换之后的
真实地址。当路由器做 NAT66 或地址转换、本机网卡上根本没有那个地址时，它才是权威
答案。**默认关闭**（会访问第三方），且只走 IPv6。

[Headscale 设置 →](/features/headscale-settings)

</div>
<div class="feature-card">

### 官方区域节点筛选

把 Tailscale 的官方公共 DERP 区域镜像成你自己的本地地图文件，只保留勾选的区域，
并**重新编号到 900 段**：**901 固定香港、902 固定新加坡**，其余按你自己的机器实
测延迟排序（没测过的排最后）。编号会保持稳定，客户端不会因为一次延迟变化就换中继，
只有**重新编号**才会打乱重排。

[Headscale 设置 →](/features/headscale-settings)

</div>
<div class="feature-card">

### 告警通知

填一个 webhook 地址，节点离线、Headscale 失联（以及恢复）、密钥即将过期、配置检查
由通过变为失败，以及**真正写入**的 DERP 地址/区域任务失败时，都会推送 JSON。

[告警通知 →](/features/notifications)

</div>
<div class="feature-card">

### 配置快照与操作审计

HeadplaneCN 在写入配置前留下快照，改错了可以一键恢复；每次写入都会记账，能看清谁在
什么时候改了什么。

[配置快照 →](/features/snapshots) · [操作审计 →](/features/audit)

</div>
<div class="feature-card">

### 机器列表与详情改进

按区域显示的延迟不再是一律「未知」，而是解析出真实区域名；中继的 IPv4/IPv6 带一键
复制，并标出正在使用的那一个及其**来源**；列表几乎每一列都能筛选和排序，勾选后可以
进行批量操作。

[机器管理 →](/features/machines) · [批量操作 →](/features/bulk-operations)

</div>
<div class="feature-card">

### 三种界面语言与实时更新

界面内置英文、简体中文和繁体中文，无需任何配置。顶部菜单里的**实时更新**开关
**默认关闭**，页面不会再每隔几秒在后台自己刷新。

[多语言 →](/features/languages)

</div>
</div>

## 上游署名

本项目基于上游 [Headplane](https://github.com/tale/headplane)（作者
[tale](https://github.com/tale)），上游署名、许可证和原有功能都完整保留。
上面没有列出的部分，都是上游的工作。
