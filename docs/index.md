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

<div class="feature-grid feature-grid-home">
<div class="feature-card">
<div class="feature-card-icon" aria-hidden="true">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false"><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><ellipse cx="12" cy="12" rx="3.6" ry="9" /></svg>
</div>

### 官方区域节点筛选

只镜像你选中的官方中继，编号固定为 901/902。

[Headscale 设置 →](/features/headscale-settings)

</div>
<div class="feature-card">
<div class="feature-card-icon" aria-hidden="true">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false"><path d="M4 9h13" /><path d="M13.5 5.5 17 9l-3.5 3.5" /><path d="M20 15H7" /><path d="M10.5 11.5 7 15l3.5 3.5" /></svg>
</div>

### 中继地址自动同步与外部 IPv6 回显

中继地址定时或手动更新，可选外部 IPv6 回显。

[Headscale 设置 →](/features/headscale-settings)

</div>
<div class="feature-card">
<div class="feature-card-icon" aria-hidden="true">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false"><path d="M12.5 20.5h8" /><path d="M15.8 4.1a2.12 2.12 0 0 1 3 3L7.5 18.4l-3.9 1 1-3.9z" /></svg>
</div>

### DERP 地图文件在浏览器里编辑

浏览器内编辑 `derp.paths`，保存前校验，可一键回滚。

[Headscale 设置 →](/features/headscale-settings)

</div>
<div class="feature-card">
<div class="feature-card-icon" aria-hidden="true">
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false"><path d="M10.3 21a2 2 0 0 0 3.4 0" /><path d="M3.3 15.3A1 1 0 0 0 4 17h16a1 1 0 0 0 .7-1.7C19.4 14 18 12.5 18 8A6 6 0 0 0 6 8c0 4.5-1.4 6-2.7 7.3" /></svg>
</div>

### 告警通知

节点掉线、Headscale 失联、密钥将过期都会通知你。

[告警通知 →](/features/notifications)

</div>
</div>

本项目 [`CGG888/headplaneCN`](https://github.com/CGG888/headplaneCN) 为方便中文用户使用而调整，上游功能、署名与许可证全部保留。
