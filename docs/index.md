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
