---
title: 原生模式
description: 不用 Docker 安装 Headplane。
outline: [2, 3]
---

# 原生模式

::: tip
如果你想用 Docker 部署，请参考[**Docker**](/install/docker)部署指南。
:::

Headplane 可以不用 Docker，直接安装并运行在你的宿主机上。这种方式适合已经在原生运行
Headscale、或者偏好不用容器的用户。

## 前置条件

- 基于 Linux 的操作系统（例如 Ubuntu、Debian、CentOS、Fedora）
- 与所检出发布版 `go.mod` 里 `go` 指令匹配的 Go（只有构建 Headplane 时才需要）
- 与所检出发布版 `package.json` 里 `engines` 字段匹配的 Node.js 与
  [pnpm](https://pnpm.io/)。以 v0.7.1 为例，使用 Node.js `>=24.2 <25`、pnpm `>=10.4 <11`；
  `packageManager` 把 pnpm 固定为 `10.4.0`。
- 已安装并运行 Headscale 0.27.0 或更新版本
- 一份[填写完成的 Headplane 配置文件](./index.md)。

在构建和运行 Headplane 之前，请确认配置里 `server.data_path` 指向的目录存在，并且运行
Headplane 的用户对它可写。

```bash
# 按需调整，也可以指定其他用户
sudo mkdir -p /var/lib/headplane
sudo chown -R $(whoami):$(whoami) /var/lib/headplane
```

## 构建 Headplane

克隆 Headplane 仓库、安装依赖并构建：

```bash
# 也可以检出某个发布标签
git clone https://github.com/CGG888/headplaneCN.git
cd headplaneCN
./build.sh
```

构建脚本会安装锁定版本的依赖，并构建 Web 应用、浏览器 SSH WASM 模块、Headplane Agent 和
healthcheck 二进制文件。Go 与 pnpm 只是构建期工具；生成的应用用 Node.js 运行。

## 运行 Headplane

在项目目录里执行 `node build/server/index.js` 即可启动 Headplane。装了 pnpm 的话，
`pnpm start` 是同一条命令。Headplane 默认在 `/etc/headplane/config.yaml` 找配置文件，也可以
通过 `HEADPLANE_CONFIG_PATH` 环境变量指定其他路径。

> 请确保运行启动命令时所在的位置存在 `build/` 目录，否则 Headplane 找不到前端资源。

### systemd 服务示例

把这个文件放到 `/etc/systemd/system/headplane.service`，就能用 systemd 管理 Headplane。按需
调整路径与用户名，执行 `sudo systemctl daemon-reload`，然后启用并启动该服务。

```ini
[Unit]
Description=Headplane Service
After=network.target # （若 headscale 也由 systemd 管理，则为 headscale.service）
Requires=network.target # （同上）
StartLimitIntervalSec=0

[Service]
Type=simple
User=your-username
WorkingDirectory=/path/to/your/cloned/headplane
ExecStart=/usr/bin/node /path/to/your/cloned/headplane/build/server/index.js
Restart=on-failure
RestartSec=5s

# 使用自定义配置路径时取消注释并填写
# Environment=HEADPLANE_CONFIG_PATH=/path/to/your/config.yaml

[Install]
WantedBy=multi-user.target
```

要访问 Headplane，在浏览器里打开 `http://localhost:3000/admin`（如果不是在本机运行，把
`localhost` 换成服务器的 IP 地址或域名）。

登录需要提供一把 Headscale API 密钥。可以在 Headscale 环境里执行下面的命令创建：

```bash
# 按需调整有效期
headscale apikeys create --expiration 90d
```

## 启用高级功能

到这里安装其实已经完成，但如果你想启用「在界面上编辑网络设置」或「从浏览器远程 SSH」这类高级
功能，请继续往下读。

### 网络管理

网络管理让你可以在 Headplane 界面里配置 Tailnet 设置，例如 DNS 服务器、自定义 A 记录、tailnet
域名和 MagicDNS。

#### 前置条件

网络管理（以及其他可配置的 Headscale 功能）要求 Headplane 与 Headscale 运行在同一台机器上，
因为 Headplane 需要：

- 读写 Head**scale** 配置文件的权限
- 在 Linux 上读取 `/proc` 文件系统以定位 Headscale 进程的权限

#### 配置

启用网络管理只需在 Headplane 配置文件里多设几个字段：

| 字段                           | 说明                                                                                                                           |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| **`integration.proc.enabled`** | 设为 `true` 以启用进程检查。                                                                                                    |
| **`headscale.config_path`**    | Head**scale** 配置文件的路径（例如 `/etc/headscale/config.yaml`）。                                                             |
| `headscale.dns_records_path`   | _可选_。细节请参考[示例配置](https://github.com/CGG888/headplaneCN/blob/main/config.example.yaml)。                                  |

设置好这些之后重启 Headplane。你应该会在界面导航栏里看到「DNS」和「设置」这样的新入口，可以在
那里管理 Tailnet 配置。

### 浏览器远程 SSH

浏览器远程 SSH 让你可以直接从 Headplane 界面、通过
[Tailscale SSH](https://tailscale.com/kb/1193/tailscale-ssh) 打开到 Tailscale 节点的终端会话。
该功能要求节点上启用了 Tailscale SSH（通过 `tailscale up --ssh` 完成）。

该功能使用 [Headplane Agent](/features/agent) 来建立 SSH 连接，设置方法见
[Agent 文档](/features/agent)，并且请特别按其中的「原生模式配置」一节把 Headplane
指向正确的 Agent 位置。

### 单点登录（SSO）

单点登录（SSO）认证让用户可以使用外部身份提供商登录 Headplane，例如 Google、GitHub，或任何
支持 OpenID Connect（OIDC）的提供方。

要开始使用 SSO，请参考 SSO 文档里的详细设置说明（该页目前只有英文版，可在导航栏的语言菜单里切换到 English 查看）。

## 反向代理

生产环境**应该**把 Headplane 放在 Nginx 或 Caddy 这类反向代理后面。此外，把 Headscale 也放到
反向代理后面，可以让两个服务共用同一个域名和 TLS 证书。

#### 配置

::: tip
如果你给 Headplane 用了自定义路径前缀，请相应调整下面示例里的 `/admin` 路径。
:::

Headscale 支持与 [多种反向代理](https://headscale.net/stable/ref/integration/reverse-proxy/)
集成，例如 Nginx、Caddy、Apache 等。部署 Headplane 只需要加一条把 `/admin` 的请求路由到
Headplane 服务的规则。参考配置见下面的 Nginx 示例；Docker 环境下类似的 Traefik 配置见
[Docker](/install/docker)安装文档。

#### Nginx 配置示例

下面的配置让 Nginx 代理 `headscale.example.com` 上所有 Headscale 请求，并在 `/admin` 路径下
提供 Headplane 界面。这与 Tailscale 自己的管理控制台的提供方式完全一致。

```nginx
server {
    listen 80;
    listen [::]:80;

    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name headscale.example.com;

    # 也可以配合 Certbot 使用 LetsEncrypt（随你）
    ssl_certificate /path/to/your/fullchain.pem;
    ssl_certificate_key /path/to/your/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;

    location / { # Headscale 运行在根路径
        proxy_pass http://localhost:8080/; # Headscale 端口不同时请调整
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_redirect http:// https://;
        proxy_buffering off;

        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        add_header Strict-Transport-Security "max-age=15552000; includeSubDomains" always;
    }

    location /admin/ { # Headplane 提供在 /admin 下
        proxy_pass http://localhost:3000; # Headplane 端口不同时请调整
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_redirect http:// https://;
        proxy_buffering off;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## 自定义路径前缀

::: warning
Headplane 官方唯一支持的路径前缀是 `/admin`。使用自定义路径前缀可能导致意料之外的问题，
不推荐这样做。
:::

如果因为某些原因你不想把 Headplane 提供在 `/admin` 下（例如想放在 `/headplane`），可以在构建
Headplane 时通过 `__INTERNAL_PREFIX` 环境变量设置前缀。

```bash
# 以 /headplane 前缀为例
git clone https://github.com/CGG888/headplaneCN.git
cd headplaneCN
# 在这里设置前缀
__INTERNAL_PREFIX=/headplane ./build.sh
```

运行 Headplane 时，所有请求只会提供在指定的路径下。如果你在用反向代理，请记得同步调整它的配置。
另外，想再次更换路径前缀，就必须用新前缀重新构建 Headplane。
