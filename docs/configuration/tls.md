---
title: TLS 与证书
description: 在进程内终止 HTTPS、信任私有 CA，以及与 cookie 和健康检查的联动。
---

# TLS 与证书

HeadplaneCN 与 TLS 有关的一切都在这一页：在进程内终止 HTTPS、为出站连接信任私有证书颁发机构，
以及与 cookie 和内置 Docker 健康检查的联动。

## 自定义证书颁发机构

如果你用私有或自签名证书颁发机构给 HeadplaneCN 通信的任一服务（Headscale 服务器、OIDC 提供方、
HTTPS 的 Docker 守护进程等）加了前置证书，HeadplaneCN 就需要信任该 CA。最干净的做法是使用标准的
Node.js `NODE_EXTRA_CA_CERTS` 环境变量，进程内**每一次**出站 TLS 连接都会遵循它（OIDC discovery、
Headscale API、Docker，以及任何使用 `fetch` 或 `https` 的调用）。

把它设为一个 PEM 编码的 CA 证书包路径（可以包含多张证书）：

```bash
NODE_EXTRA_CA_CERTS=/etc/headplane/extra-cas.pem
```

在 Docker 里，把该文件挂进容器并把变量传进去：

```yaml
services:
  headplane:
    image: ghcr.io/cgg888/headplanecn:latest
    environment:
      NODE_EXTRA_CA_CERTS: /etc/headplane/extra-cas.pem
    volumes:
      - "./internal-ca.pem:/etc/headplane/extra-cas.pem:ro"
      - "./config.yaml:/etc/headplane/config.yaml"
      - "./headplane-data:/var/lib/headplane"
```

这个证书包是**追加在**系统信任库之上的，因此公共证书（Let's Encrypt、ZeroSSL 等）照常可用。

> `headscale.tls_cert_path` 是一个更窄的旋钮：它把 Headscale 的 API 连接固定到唯一一张证书上，
> 绕过信任库的其余部分。如果你确实想让 HeadplaneCN 只接受那一张证书，它依然有用；但当你只是想
> 往信任集合里加一个 CA 时，`NODE_EXTRA_CA_CERTS` 才是对的工具。

## TLS 终止

当配置文件里同时设置了 `server.tls_cert_path` 与 `server.tls_key_path` 时，HeadplaneCN 可以自己
终止 TLS。两者都必须指向 HeadplaneCN 可读的 PEM 编码文件。

```yaml
server:
  port: 443
  tls_cert_path: "/var/lib/headplane/tls/fullchain.pem"
  tls_key_path: "/var/lib/headplane/tls/privkey.pem"
```

配置 TLS 后，HeadplaneCN 在 `server.port` 上提供 HTTPS/1.1。进程内有意不支持 HTTP/2 和 HTTP/3
—— 如果你现在就需要它们，请在反向代理（例如 Caddy 或 Traefik）上终止，再用 HTTP/1.1 转发给
HeadplaneCN。

只要启用了 TLS，`server.cookie_secure` 就会被强制为 `true`（浏览器拒绝在 HTTPS 上使用没有
`Secure` 的 cookie）；如果你的配置里原本是 `false`，日志里会有一条警告。

对大多数部署，我们仍然推荐在反向代理上终止 TLS（见[反向代理](./index.md)），这样可以与
Headscale 及其他服务共用证书。内置 TLS 面向的是「HeadplaneCN 只在一台机器上」这类更简单的场景。

## 健康检查

内置的 Docker 健康检查会自动采用正确的协议与端口 —— HeadplaneCN 启动时会把自己的回环 URL 写入
`/tmp/headplane-listen`，健康检查从那里读取。因此开关 TLS 不需要任何针对健康检查的额外配置，
一切都会正常工作。
