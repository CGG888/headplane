---
title: 代理认证
description: 把 Headplane 的身份认证交给可信的反向代理。
outline: [2, 3]
---

:::warning
代理认证**强大到危险**。配置不当会让任何人都能冒充用户并访问 Headplane。

如果条件允许，建议优先使用 Headplane 内置的 SSO 集成，而不是代理认证。我们不对代理认证的
安全性作任何保证。
:::

# 代理认证

代理认证让 Headplane 把用户认证委托给可信的反向代理。当 Headplane 已经由 nginx basic auth、
Authelia、Authentik 或其他具备 SSO 能力的代理保护，而你不希望用户再单独登录 Headplane 时，
这个功能很有用。

代理认证是刻意设为选择启用的，并且需要 `headscale.api_key`。启用后，Headplane 只对客户端 IP
匹配 `server.proxy_auth.allowed_cidrs` 的请求信任身份请求头；随后所有 Headscale API 调用都会
使用配置好的 `headscale.api_key`。

## 基本配置

```yaml
headscale:
  api_key: "<your-headscale-api-key>"

server:
  proxy_auth:
    enabled: true
    user_header: "Remote-User"
    email_header: "Remote-Email"
    name_header: "Remote-Name"
    allowed_cidrs:
      - "127.0.0.1/32"
      - "::1/128"
```

请求要通过认证必须提供 `user_header`，其默认值为 `Remote-User`。该值在 Headplane 中会以
`proxy:<value>` 的形式成为稳定的代理身份。`email_header`、`name_header` 和
`picture_header` 是可选的资料元数据请求头。

第一个通过代理认证的用户会被创建为 Headplane 的所有者，与常规 SSO 的首个用户行为一致。之后
的用户会以成员身份创建，可以在用户页面重新分配角色。

## 客户端 IP 检查

如果省略 `allowed_cidrs`，Headplane 只信任本机。默认情况下，这个 CIDR 检查使用的是连接到
Headplane 的套接字地址，而不是 `X-Forwarded-For`、`X-Real-IP` 或其他转发请求头。请把
`allowed_cidrs` 配置为你的代理连接 Headplane 时所使用的直接地址范围。

## 转发的客户端 IP 请求头

如果你需要从代理请求头中检查原始客户端 IP，请把 `ip_header` 设为 `X-Forwarded-For`、
`X-Real-IP` 或你的代理可控制的其他请求头。设置 `ip_header` 后，只有当直接连接的套接字对端
匹配 `trusted_proxy_cidrs`（默认为本机）时，Headplane 才会读取该请求头。随后请求头中的第一个
IP 会与 `allowed_cidrs` 比对：

```yaml
server:
  proxy_auth:
    enabled: true
    ip_header: "X-Forwarded-For"
    trusted_proxy_cidrs:
      - "127.0.0.1/32"
    allowed_cidrs:
      - "10.0.0.0/8"
```

::: warning
只有在 Headplane 无法被不受信任的客户端直接访问时，才应启用代理认证。任何能从允许的 CIDR
连接到 Headplane 的人，都能伪造所配置的身份请求头。只有在请求头由你的可信反向代理设置或覆盖
时，才应配置 `ip_header`。
:::

## 请求头参考

| 字段                                    | 说明                                                                                     |
| --------------------------------------- | ---------------------------------------------------------------------------------------- |
| `server.proxy_auth.enabled`             | 启用代理认证。                                                                           |
| `server.proxy_auth.user_header`         | 包含稳定的已认证用户身份的请求头。默认为 `Remote-User`。                                 |
| `server.proxy_auth.email_header`        | 可选。包含已认证用户邮箱地址的请求头。                                                   |
| `server.proxy_auth.name_header`         | 可选。包含已认证用户显示名称的请求头。                                                   |
| `server.proxy_auth.picture_header`      | 可选。包含已认证用户头像 URL 的请求头。                                                  |
| `server.proxy_auth.allowed_cidrs`       | 允许通过认证的客户端 CIDR。默认为本机。                                                  |
| `server.proxy_auth.ip_header`           | 可选。原始客户端 IP 请求头，例如 `X-Forwarded-For` 或 `X-Real-IP`。                      |
| `server.proxy_auth.trusted_proxy_cidrs` | 可信的、可以提供 `ip_header` 的直接代理 CIDR。默认为本机。                               |
