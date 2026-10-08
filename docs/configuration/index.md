---
title: 配置
description: HeadplaneCN 配置文件的字段、环境变量覆盖、敏感值与反向代理。
outline: [2, 3]
---

# 配置

> 早期版本的 HeadplaneCN 只使用环境变量，没有配置文件。
> 从 0.5 起，你需要手动把配置迁移到新格式。

HeadplaneCN 用一份配置文件管理自己的设置
（[**config.example.yaml**](https://github.com/CGG888/headplaneCN/blob/main/config.example.yaml)）。默认情况
下，HeadplaneCN 在 `/etc/headplane/config.yaml` 找这份文件。可以用 **`HEADPLANE_CONFIG_PATH`** 环境
变量把它指向别处。

HeadplaneCN 默认还会把数据存放在 `/var/lib/headplane` 目录。这个路径可以在配置文件里按段分别设置，
但非常重要的是：这个目录必须持久化，并且对 HeadplaneCN 可写。

## 环境变量

也可以用环境变量覆盖配置文件。这些改动会在配置文件载入**之后**合并，因此优先级更高。
环境变量的命名规则是 **`HEADPLANE_<段名>__<键名>`**。例如要覆盖 `oidc.client_secret`，就把
`HEADPLANE_OIDC__CLIENT_SECRET` 设成你想要的值。

几个例子：

- `HEADPLANE_HEADSCALE__URL`：`headscale.url`
- `HEADPLANE_SERVER__PORT`：`server.port`

**这个功能默认是关闭的！** 要启用它，请设置环境变量
**`HEADPLANE_LOAD_ENV_OVERRIDES=true`**。设置它同时会让 HeadplaneCN 把相对的 `.env` 文件载入环境。

> 另外请注意，这只适用于**配置覆盖**，而不是普通环境变量 —— 也就是说你不能用它指定
> `HEADPLANE_DEBUG_LOG=true` 或 `HEADPLANE_CONFIG_PATH=/etc/headplane/config.yaml` 这类变量。

面板还认几个普通环境变量：`HEADPLANE_DEBUG_LOG`（调试日志）、`HEADPLANE_RELEASE_MIRROR`（版本查询
用的镜像前缀，见[设置 → 系统](/features/system-status)），以及想走真实 HTTP 代理时给 Node 用的
`NODE_USE_ENV_PROXY=1` 和 `HTTPS_PROXY=http://代理地址:端口`。

## 敏感值

对于密钥、私钥和私有证书这类敏感配置，HeadplaneCN 支持「值 / 文件路径」双模式。每个这样的字段，
你可以选择：

1. 直接在配置文件里写值（例如 `cookie_secret: "your-32-character-long-secret"`）
2. 用带 `_path` 后缀的键给出存放该值的文件路径（例如
   `cookie_secret_path: "/path/to/your/cookie_secret_file"`）

使用 `_path` 选项时，会读取指定文件的内容并作为该设置的取值。这些路径支持环境变量插值
（例如 `${CREDENTIALS_DIRECTORY}/my_secret_file`），便于与 systemd 的 `LoadCredential` 这类工具
配合。

**双模式字段的重要规则：**

- **不能**同时设置直接值（如 `cookie_secret`）与对应的 `_path`（如 `cookie_secret_path`）。这样做
  会导致配置错误。
- 如果提供了 `_path`，对应的直接值字段（若也存在且不为 null）通常会被忽略，或者视具体字段与
  载入逻辑而报校验错误。最好是只提供一个。
- 双模式同样适用于环境变量：可以用 `HEADPLANE_OIDC__CLIENT_SECRET` 提供直接值，或用
  `HEADPLANE_OIDC__CLIENT_SECRET_PATH` 指定存有密钥的文件路径。

**关于路径处理的说明：**
HeadplaneCN 用白名单决定哪些 `_path` 字段的内容会作为密钥载入。只有下面明确列出的路径会读取文件
内容并用作配置值。其他带 `_path` 后缀的路径只会做环境变量插值，不会载入内容。

HeadplaneCN 中按密钥路径处理的配置项如下：

- **服务器设置（`server.*`）：**
  - `cookie_secret_path`（用于 Web 会话编码）
    - _说明：_ 必须提供 `cookie_secret` 或 `cookie_secret_path` 之一，以保证 Web 会话安全。

- **Headscale 连接设置（`headscale.*`）：**
  - `api_key_path`（用于服务端操作，例如 OIDC、代理认证和 Agent 同步的 Headscale API 密钥）
    - _说明：_ 使用 OIDC、代理认证或 Agent 时，必须提供 `api_key` 或 `api_key_path` 之一。
  - `tls_cert_path`（连接 Headscale 时使用的自定义 TLS 证书）
    - _说明：_ 它按普通路径处理，不是密钥路径，因此不会载入文件内容。

- **OIDC 设置（`oidc.*`）：**
  - `client_secret_path`（OIDC 客户端密钥）
    - _说明：_ 使用 OIDC 认证时，必须提供 `client_secret` 或 `client_secret_path` 之一。
  - `headscale_api_key_path`（**已废弃**，请改用 `headscale.api_key_path`）

**非密钥路径的区别：**
其他以 `_path` 结尾的配置字段按普通路径处理，不会载入内容。例如：

- `headscale.config_path`：Headscale `config.yaml` 文件的可选路径，HeadplaneCN 可能会读取它或据此
  校验。

所有路径字段（无论是否为密钥路径）都支持用 `${VAR_NAME}` 语法做环境变量插值。

基于路径的密钥载入同样适用于环境变量，例如：

- `HEADPLANE_OIDC__CLIENT_SECRET_PATH=/path/to/secret/file` 会从指定文件载入 OIDC 客户端密钥
- `HEADPLANE_SERVER__COOKIE_SECRET_PATH=${CREDENTIALS_DIRECTORY}/cookie_secret` 会在路径里做环境
  变量插值

## 调试

HeadplaneCN 用 Pino 输出换行分隔的 JSON 服务端日志。每条记录包含时间戳、级别、组件和消息
（`msg`），便于日志聚合工具直接过滤与索引。

要启用调试日志，请设置 **`HEADPLANE_DEBUG_LOG=true`** 环境变量。这会打开 HeadplaneCN 的全部调试
日志，可能很快填满日志空间，不推荐在生产环境使用。

## TLS 与证书

与 TLS 有关的一切 —— 在进程内终止 HTTPS、为发往 Headscale 或 OIDC 提供方的出站连接信任私有
CA、与 `cookie_secure` 的联动，以及 Docker 健康检查 —— 都在单独一页：
[TLS 与证书](./tls.md)。

## 反向代理

部署 Web 应用时反向代理非常常见，Headscale 和 HeadplaneCN 在这方面非常相似。你可以沿用自己熟悉
的任意反向代理配置。下面是用 Traefik 的示例：

> 这里的关键是 CORS 中间件，前端与后端通信需要它。如果你用的是别的反向代理，请务必补上必要的
> 响应头，让前端能和后端通信。

```yaml
http:
  routers:
    headscale:
      rule: "Host(`headscale.example.com`)"
      service: "headscale"
      middlewares:
        - "cors"

    rewrite:
      rule: "Host(`headscale.example.com`) && Path(`/`)"
      service: "headscale"
      middlewares:
        - "rewrite"

    headplane:
      rule: "Host(`headscale.example.com`) && PathPrefix(`/admin`)"
      service: "headplane"

  services:
    headscale:
      loadBalancer:
        servers:
          - url: "http://headscale:8080"

    headplane:
      loadBalancer:
        servers:
          - url: "http://headplane:3000"

  middlewares:
    rewrite:
      addPrefix:
        prefix: "/admin"
    cors:
      headers:
        accessControlAllowHeaders: "*"
        accessControlAllowMethods:
          - "GET"
          - "POST"
          - "PUT"
        accessControlAllowOriginList:
          - "https://headscale.example.com"
        accessControlMaxAge: 100
        addVaryHeader: true
```
