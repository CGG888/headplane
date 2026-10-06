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

## 本分支特色

本项目 [`CGG888/headplaneCN`](https://github.com/CGG888/headplaneCN) 面向自建 NAS
环境（尤其是 fnOS 飞牛），基于上游
[Headplane](https://github.com/tale/headplane)（作者
[tale](https://github.com/tale)）构建，上游署名、许可证和原有功能都完整保留；新增或改动
的内容见[与上游的差异](/differences)。

<div class="feature-grid">
<div class="feature-card">

### fnOS 与原生 Headscale 一体化

用 `pid: host` 和以读写方式挂载的 `config.yaml`，让容器里的 HeadplaneCN 管好飞牛上
原生运行的 Headscale。

[fnOS 部署指南 →](/install/fnos)

</div>
<div class="feature-card">

### 官方区域节点筛选

只镜像你选中的官方中继并统一编号：901 香港、902 新加坡固定不变。

[Headscale 设置 →](/features/headscale-settings)

</div>
<div class="feature-card">

### 中继地址自动同步与外部 IPv6 回显

中继地址按计划或手动探测写回并留快照，外部 IPv6 回显可选。

[Headscale 设置 →](/features/headscale-settings)

</div>
<div class="feature-card">

### DERP 地图文件在浏览器里编辑

`derp.paths` 文件可在浏览器里编辑，保存前校验并留快照，可一键回滚。

[Headscale 设置 →](/features/headscale-settings)

</div>
</div>
