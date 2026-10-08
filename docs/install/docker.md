---
title: Docker
description: 用 Docker 安装 HeadplaneCN。
outline: [2, 3]
---

# Docker 安装

::: tip
如果你不想用 Docker 部署，请参考[**原生模式**](/install/native-mode)部署指南。
:::

部署 HeadplaneCN 最推荐的方式是 Docker。它快捷、简单，在大多数环境里都能用，前提是 Headscale
也运行在 Docker 中。

## 前置条件

- Docker 与 Docker Compose
- 已安装并运行 Headscale 0.27.0 或更新版本
- 一份[填写完成的 HeadplaneCN 配置文件](./index.md)。

## 安装

用 Docker 运行 HeadplaneCN，只需要应用一个 compose 文件：

```yaml
services:
  headplane:
    image: ghcr.io/cgg888/headplanecn:latest
    container_name: headplane
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - "./config.yaml:/etc/headplane/config.yaml"
      - "./headplane-data:/var/lib/headplane"
```

挂载配置文件、并给 HeadplaneCN 提供一个持久化存储位置来保存自己的数据，这两点很重要。想换端口
运行，改端口映射即可。

## 健康检查

Docker 镜像内置了健康检查，用来确认 HeadplaneCN 服务正在运行并响应。Docker 会自动监视容器并
报告它的健康状态，不需要额外配置。

健康检查二进制文件位于容器内的 `/bin/hp_healthcheck`。需要覆盖默认健康检查行为时，可以在
`compose.yaml` 里这样写：

```yaml
services:
  headplane:
    image: ghcr.io/cgg888/headplanecn:latest
    healthcheck:
      test: ["CMD", "/bin/hp_healthcheck"]
      interval: 30s
      timeout: 5s
      start_period: 5s
      retries: 3
```

## 访问 HeadplaneCN

容器启动后，在浏览器里打开 `http://localhost:3000/admin` 就能访问 HeadplaneCN 界面（如果不是
在本机运行，把 `localhost` 换成服务器的 IP 地址或域名）。

登录需要提供一把 Headscale API 密钥。可以在 Headscale 环境里执行下面的命令创建：

```bash
# 按需调整有效期
headscale apikeys create --expiration 90d
```

## 启用高级功能

到这里安装其实已经完成，但如果你想启用「在界面上编辑网络设置」或「从浏览器远程 SSH」这类高级
功能，请继续往下读。

### 网络管理

网络管理让你可以在 HeadplaneCN 界面里配置 Tailnet 设置，例如 DNS 服务器、自定义 A 记录、tailnet
域名和 MagicDNS。

#### 前置条件

网络管理（以及其他可配置的 Headscale 功能）要求 HeadplaneCN 与 Headscale 运行在同一台 Docker
主机上，因为 HeadplaneCN 需要以下权限：

- 通过 Headscale 与 HeadplaneCN 共用的卷，读写 Head**scale** 的配置文件。
- 访问 Docker socket（通常是 `/var/run/docker.sock`，也可以使用
  [Tecnativa/docker-socket-proxy](https://github.com/Tecnativa/docker-socket-proxy) 这类代理）。

HeadplaneCN 启动时会与守护进程协商 Docker API 版本。它目标是 API 版本 `1.44`，并回退到守护进程
提供的版本，下限为 `1.24`（Docker Engine 1.12+）。这覆盖了所有现代 Docker 安装，以及 Podman
的 Docker 兼容 socket。

#### 配置

首先要把 Headscale 和 HeadplaneCN 跑在同一个 Docker 环境里。下面是一份能做到这点的
`compose.yaml` 示例：

```yaml
services:
  headplane:
    image: ghcr.io/cgg888/headplanecn:latest
    container_name: headplane
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      # 与前面相同
      - "/path/to/your/config.yaml:/etc/headplane/config.yaml"
      - "/path/to/data/storage:/var/lib/headplane"

      # 指向 Headscale 配置文件的共享路径。重要的是挂载路径必须与
      # Headplane 的 config.yaml 里 `headscale.config_path` 完全一致。
      - "/path/to/headscale/config.yaml:/etc/headscale/config.yaml"

      # 如果你在 Headscale 里使用 dns.extra_records_path（推荐），
      # 也把这个文件挂进来，让 Headplane 能读写它。若容器内路径与
      # Headscale 的 dns.extra_records_path 不同，请在 Headplane 的
      # config.yaml 里设置 `headscale.dns_records_path`。
      - "/path/to/headscale/dns_records.json:/etc/headscale/dns_records.json"

      # Docker socket（或使用 socket 代理）。注意 `:ro` 只保护 socket 文件本身、
      # 挡不住 Docker API 调用，所以别把它当安全边界：拿到这个 socket 等于拿到宿主 root
      - "/var/run/docker.sock:/var/run/docker.sock:ro"
  headscale:
    image: headscale/headscale:0.29.4
    container_name: headscale
    restart: unless-stopped
    command: serve
    labels:
      # 这个标签对 Headplane 找到 Headscale 是绝对必要的。
      me.tale.headplane.target: headscale
    ports:
      - "8080:8080"
    volumes:
      # 注意这些路径对 Headscale 和 Headplane 都是宿主机上的同一路径！
      # 这一点非常重要。
      - "/path/to/headscale/config.yaml:/etc/headscale/config.yaml"
      - "/path/to/headscale/dns_records.json:/etc/headscale/dns_records.json"

      - "/path/to/headscale/data/storage:/var/lib/headscale"
```

::: info
理论上，你也可以花点功夫把 Headscale 和 HeadplaneCN 跑在分开的 Docker 主机上，并远程连接 Docker
守护进程。这是高级用法，本文档不涉及。更多细节请参考
[示例配置](https://github.com/CGG888/headplaneCN/blob/main/config.example.yaml)。
:::

还需要在 HeadplaneCN 配置文件里启用几个字段：

| 字段                             | 说明                                                                                                |
| -------------------------------- | --------------------------------------------------------------------------------------------------- |
| **`integration.docker.enabled`** | 设为 `true` 以启用 Docker 集成。                                                                    |
| **`headscale.config_path`**      | 容器内 Head**scale** 配置文件的路径（例如 `/etc/headscale/config.yaml`）。                          |
| `headscale.dns_records_path`     | _可选_。细节请参考[示例配置](https://github.com/CGG888/headplaneCN/blob/main/config.example.yaml)。 |

设置好这些之后重启 HeadplaneCN。你应该会在界面导航栏里看到「DNS」和「设置」这样的新入口，可以在
那里管理 Tailnet 配置。

### 浏览器远程 SSH

浏览器远程 SSH 让你可以直接从 HeadplaneCN 界面、通过
[Tailscale SSH](https://tailscale.com/kb/1193/tailscale-ssh) 打开到 Tailscale 节点的终端会话。
该功能要求节点上启用了 Tailscale SSH（通过 `tailscale up --ssh` 完成）。

该功能使用 [HeadplaneCN Agent](/features/agent) 来建立 SSH 连接，设置方法见
[Agent 文档](/features/agent)。

### 单点登录（SSO）

单点登录（SSO）认证让用户可以使用外部身份提供商登录 HeadplaneCN，例如 Google、GitHub，或任何
支持 OpenID Connect（OIDC）的提供方。

要开始使用 SSO，请参考 SSO 文档里的详细设置说明（该页目前只有英文版，可在导航栏的语言菜单里切换到 English 查看）。

## 反向代理

生产环境**应该**把 HeadplaneCN 放在 Nginx 或 Caddy 这类反向代理后面。此外，把 Headscale 也放到
反向代理后面，可以让两个服务共用同一个域名和 TLS 证书。

#### 配置

Headscale 支持与 [多种反向代理](https://headscale.net/stable/ref/integration/reverse-proxy/)
集成，例如 Nginx、Caddy、Apache 等。部署 HeadplaneCN 只需要加一条把 `/admin` 的请求路由到
HeadplaneCN 服务的规则。参考配置见下面的 Traefik 示例；不用 Docker 的类似配置见
[原生模式](/install/native-mode)安装文档。

#### Traefik 配置示例

下面的配置让 Traefik 代理 `headscale.example.com` 上所有 Headscale 请求，并在 `/admin` 路径下
提供 HeadplaneCN 界面。这与 Tailscale 自己的管理控制台的提供方式完全一致。

请注意这份配置本身并不能直接工作，你还需要按需配置 Traefik 与 TLS 证书。这里只是一个片段，
用来说明如何为 HeadplaneCN 和 Headscale 配置路由。

```yaml
services:
  # 与前面相同
  headplane:
    image: ghcr.io/cgg888/headplanecn:latest
    container_name: headplane
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - "/path/to/your/config.yaml:/etc/headplane/config.yaml"
      - "/path/to/data/storage:/var/lib/headplane"
      - "/path/to/headscale/config.yaml:/etc/headscale/config.yaml"
      - "/path/to/headscale/dns_records.json:/etc/headscale/dns_records.json"
      - "/var/run/docker.sock:/var/run/docker.sock:ro"
    labels:
      # 在 /admin 下暴露管理界面
      - "traefik.enable=true"
      - "traefik.http.routers.headplane.rule=Host(`headscale.example.com`) && PathPrefix(`/admin`)"
      - "traefik.http.routers.headplane.entrypoints=websecure"
      - "traefik.http.routers.headplane.tls=true"
  headscale:
    image: headscale/headscale:0.29.4
    container_name: headscale
    restart: unless-stopped
    command: serve
    ports:
      - "8080:8080"
    volumes:
      - "/path/to/headscale/config.yaml:/etc/headscale/config.yaml"
      - "/path/to/headscale/dns_records.json:/etc/headscale/dns_records.json"
      - "/path/to/headscale/data/storage:/var/lib/headscale"
    labels:
      - "me.tale.headplane.target=headscale"

      # 把 Headscale 暴露在 headscale.example.com 的 Traefik 标签
      - "traefik.enable=true"
      - "traefik.http.routers.headscale.rule=Host(`headscale.example.com`)"
      - "traefik.http.routers.headscale.entrypoints=websecure"
      - "traefik.http.routers.headscale.tls=true"

      # 这个中间件对 Headplane 正常工作至关重要
      - "traefik.http.routers.headscale.middlewares=cors"
      - "traefik.http.middlewares.cors.headers.accesscontrolallowheaders=*"
      - "traefik.http.middlewares.cors.headers.accesscontrolallowmethods=GET,POST,PUT"
      - "traefik.http.middlewares.cors.headers.accesscontrolalloworiginlist=https://headscale.example.com"
      - "traefik.http.middlewares.cors.headers.accesscontrolmaxage=100"
      - "traefik.http.middlewares.cors.headers.addvaryheader=true"

      # 可选：自动把 / 重定向到 /admin
      - "traefik.http.routers.rewrite.rule=Host(`headscale.example.com`) && Path(`/`)"
      - "traefik.http.routers.rewrite.service=headscale"
      - "traefik.http.routers.rewrite.middlewares=rewrite"
      - "traefik.http.middlewares.rewrite.addprefix.prefix=/admin"

  traefik:
    image: traefik:v3.0
    container_name: traefik
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      # 示例挂载与设置，请按需配置 Traefik
      - "/var/run/docker.sock:/var/run/docker.sock:ro"
      - "/path/to/certs/storage:/certs"
```
