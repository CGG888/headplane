---
# https://vitepress.dev/reference/default-theme-home-page
layout: home

hero:
  name: "HeadplaneCN"
  tagline: "Headscale 的全功能管理界面"
  image:
    src: "/logo.svg"
    alt: "HeadplaneCN"
  actions:
    - text: "快速上手"
      link: "/install"
    - text: "功能说明"
      link: "/features/overview"
      theme: "alt"
    - text: "查看与上游的差异 →"
      link: "/differences"
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

## 关于本分支

这里是 [`CGG888/headplaneCN`](https://github.com/CGG888/headplaneCN)，针对自建 NAS
环境（尤其是 fnOS 飞牛）做了补充。本项目基于上游
[Headplane](https://github.com/tale/headplane)（作者
[tale](https://github.com/tale)），上游署名、许可证和原有功能都完整保留。

本分支相对上游新增或改动的内容，都放在单独一页里：

[查看与上游的差异 →](/differences)

## 特色功能

本分支最值得单独一看的四项能力，完整清单见[与上游的差异](/differences)。

<div class="feature-grid">
<div class="feature-card">

### fnOS 与原生 Headscale 一体化

让容器里的 HeadplaneCN 管好一台原生跑在飞牛上的 Headscale：`pid: host` 使
`integration.proc` 能发现并给 `headscale serve` 发信号，真正生效的 `config.yaml` 以
**读写**方式挂载；最容易出错的是 `derp.paths` —— 每个条目都得是**宿主机路径**，且该目录要以
**完全相同的绝对路径**挂进容器。

[fnOS 部署指南 →](/install/fnos)

</div>
<div class="feature-card">

### 官方区域节点筛选

只把你想用的官方中继镜像进一份本地地图文件，并统一改号到 **900 段**：**901 永远是香港、
902 永远是新加坡**，其余从 **903** 起按你的机器实测延迟排列。编号一旦定下就保持稳定，客户端
不会因为一次延迟采样波动就换中继。

[Headscale 设置 →](/features/headscale-settings)

</div>
<div class="feature-card">

### 中继地址自动同步与外部 IPv6 回显

客户端必须访问到的地址由 HeadplaneCN 自己探测并写回：按 6/12/24 小时计划或手动触发，写入前先
留配置快照、写后记一条审计。可选的外部 IPv6 回显会回答路由器转发或 NAT66 转换之后，互联网
实际看到的是哪个地址（默认关闭，仅走 IPv6）。

[Headscale 设置 →](/features/headscale-settings)

</div>
<div class="feature-card">

### DERP 地图文件在浏览器里编辑

每个 `derp.paths` 文件都能在浏览器里查看、编辑，或者从带注释的模板直接创建；保存时先按 DERP
地图结构校验，再给文件留一份快照，改坏了可以一键回滚。

[Headscale 设置 →](/features/headscale-settings)

</div>
</div>
