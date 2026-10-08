---
title: 双镜像部署
description: "用两个容器分别运行 Headscale 与 HeadplaneCN：host 网络、容器内外同一绝对路径、Docker 集成，含 .env、compose、两份完整配置、双向迁移、反代与验收清单。"
outline: [2, 3]
---

# 双镜像部署：Headscale 与 HeadplaneCN 各跑一个容器

这份指南对应**已经定型的部署形态**：Headscale 与 HeadplaneCN 各跑一个容器，Headscale 不再由
NAS 应用中心（fnOS 的 fpk 应用）托管。两个容器都用 **host 网络**，容器里的 `127.0.0.1` 就是这台
NAS 本机：Headscale 的监听端口、指标端口、`udp/3478`（STUN）直接落在 NAS 上，不需要端口映射。

它和另一种常见形态的区别只有一个，但影响很大：

| 形态       | Headscale 在哪 | Headscale 配置里的绝对路径                       | 集成方式                                  |
| ---------- | -------------- | ------------------------------------------------ | ----------------------------------------- |
| 原生 / fpk | 宿主机进程     | 宿主机路径（`/vol1/@appdata/headscale/...`）     | `integration.proc`：发 SIGHUP 重载 ACL    |
| **双镜像** | 容器           | **路径不变**（把宿主目录按同一绝对路径挂进容器） | `integration.docker`：重启 Headscale 容器 |
| 旧双镜像   | 容器           | 被改写成容器路径（`/etc/headscale/...`）         | `integration.proc` + `pid: host`          |

**这份指南用的是中间那一行**：Headscale 跑在容器里，但数据目录以「宿主机上的同一个绝对路径」
挂进容器，于是 `config.yaml` 里所有绝对路径（数据库、noise 私钥、DERP 私钥、`unix_socket`、
`derp.paths`）**一个字都不用改** —— 迁移时少改一处，就少一次「改了路径、Headscale 启动不了」
的事故。

::: tip 适用环境

- NAS（fnOS 等）：Docker 与 Docker Compose 已就绪
- 反向代理：Lucky 等（可以和这两个容器不在同一台机器上）
- 客户端已经注册在一个**固定的 `server_url`** 上 —— 迁移全程不改它
  :::

如果你现在的部署是「Headscale 原生进程 + HeadplaneCN 容器」——[fnOS 部署](/install/fnos) 或
[原生模式](/install/native-mode)——直接看[从 fnOS 原生迁移到双镜像](#从-fnos-原生迁移到双镜像)；
想从双镜像退回原生进程，看[回退到 fnOS 原生模式](#回退到-fnos-原生模式)。

## 这个形态靠三件事成立

| 机制             | 做法                                                                                               | 带来的结果                                                                       |
| ---------------- | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| **host 网络**    | 两个服务都 `network_mode: host`，不写 `ports:`                                                     | 面板用 `http://127.0.0.1:8480` 访问 Headscale；`udp/3478` 直接可用，无需映射     |
| **同一绝对路径** | Headscale 数据目录挂成 `/vol1/1000/APP/headplaneCN/headscale:/vol1/1000/APP/headplaneCN/headscale` | 配置里的绝对路径不用改；面板与 Headscale 看到的是同一份 `config.yaml` 和地图文件 |
| **Docker 集成**  | 面板挂 `/var/run/docker.sock`，用容器标签找到 Headscale 容器                                       | 保存配置 / 点「重新加载」时由面板重启 Headscale 容器，**不需要发 SIGHUP**        |

由此带来两个附带结论：

- **不需要 `security_opt: ["apparmor=unconfined"]`**。那是 `integration.proc`（跨进程发 SIGHUP）
  才需要的：容器默认的 AppArmor 配置只允许向同一配置的进程发信号，给原生进程发信号会被拒绝
  （`kill EACCES`）。Docker 集成走 docker socket 重启容器，不涉及信号。
- **`pid: host` 是可选的**。Docker 集成不需要它；保留它的唯一理由是面板里的 Agent 能直接看到
  宿主机进程信息（Headscale 版本、系统信息、DERP 中继详情）。不加也能跑，Agent 会退化为从
  容器内可见的信息推断。

## 运行安装脚本（可选）

上面的 `.env`、compose 文件、两份配置和迁移步骤，都可以交给脚本一次问清楚再生成：
[`scripts/dual-image-install.sh`](https://github.com/CGG888/headplaneCN/blob/main/scripts/dual-image-install.sh)。

```bash
# 在 NAS 上（或直接克隆仓库后：bash scripts/dual-image-install.sh）
curl -fsSL -o dual-image-install.sh \
  https://raw.githubusercontent.com/CGG888/headplaneCN/main/scripts/dual-image-install.sh

bash dual-image-install.sh --help      # 每个问题和开关的说明
bash dual-image-install.sh --dry-run   # 只打印计划，不写任何文件
bash dual-image-install.sh --self-test # 不起容器，验证脚本自身生成的 compose / 配置
bash dual-image-install.sh             # 正式安装
```

- **无人值守也能跑**：`--defaults` 全部使用默认答案；`--base-dir`、`--admin-bind`、
  `--headscale-tag`、`--headplane-tag` 直接指定目录与镜像版本，适合写进你自己的部署脚本。
- **全程交互，默认值就是本文的值**：基础目录、两个镜像 tag、`server_url`、监听端口、面板绑定
  地址、时区、API Key、cookie secret、是否从原生部署迁移，逐个询问并校验；输入不合格会重新问。
- **先看后写**：`--dry-run` 打印每一个要写的文件、每一次复制和之后要执行的命令，什么都不改；
  正式运行也会先打印完整计划，确认之后才落盘，且**不确认就不会启动容器**。
- **不会删你的数据**：已有配置只按需改写个别键（原文件另存 `.bak`），迁移只做**复制**并先打
  时间戳备份，脚本里没有任何删除数据的动作。
- 写完之后会问是否立刻 `docker compose up -d`，并顺手跑一遍 `docker compose ps`、
  Headscale 日志、`headscale health` 与面板健康检查的验收命令。

## 目录布局

所有路径以 `/vol1/1000/APP/headplaneCN` 为例，按你的实际存储位置替换。**两个容器、一个目录**，
配置、数据、备份都在一处，`tar` 一次就是完整备份。

| 宿主机路径                                         | 用途                                                                                                  | 容器内路径                                          |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `/vol1/1000/APP/headplaneCN/docker-compose.yml`    | 两个容器的定义                                                                                        | —                                                   |
| `/vol1/1000/APP/headplaneCN/.env`                  | 版本号、运行用户、绑定地址                                                                            | —                                                   |
| `/vol1/1000/APP/headplaneCN/config.yaml`           | HeadplaneCN 自己的配置                                                                                | `/etc/headplane/config.yaml`（只读）                |
| `/vol1/1000/APP/headplaneCN/data/`                 | 面板数据：会话、内部库、快照、Agent 状态                                                              | `/var/lib/headplane`                                |
| `/vol1/1000/APP/headplaneCN/headscale/config.yaml` | **Headscale 生效配置**（0.29.4 完整配置）                                                             | `/etc/headscale/config.yaml`（容器只读 / 面板读写） |
| `/vol1/1000/APP/headplaneCN/headscale/`            | `db.sqlite`、`noise_private.key`、`derp_server_private.key`、`headscale.sock`、`cache/`、`derp-maps/` | **同一个绝对路径**（headscale 读写 / 面板只读）     |
| `/vol1/1000/APP/headplaneCN/headscale/derp-maps/`  | 本地 DERP 地图（含「官方区域筛选」写出的那份）                                                        | **同一个绝对路径**（面板读写）                      |
| `/vol1/1000/APP/headplaneCN/backup/`               | 迁移与升级前的 `tar.gz` 备份                                                                          | —                                                   |

```bash
mkdir -p /vol1/1000/APP/headplaneCN/{data,backup} \
         /vol1/1000/APP/headplaneCN/headscale/derp-maps
```

## .env

compose 会自动读取同目录的 `.env`。**版本号和运行用户都在这里**，升级只改一个数字。

```ini
# /vol1/1000/APP/headplaneCN/.env

# --- 镜像版本 ---------------------------------------------------------------
# 固定版本，不要用 latest：升级就是显式改这两行
HEADSCALE_VERSION=0.29.4
HEADPLANE_VERSION=0.22.22

# --- 运行 headscale 容器的用户 ----------------------------------------------
# 官方镜像以非 root 用户构建，而数据目录的属主是原来那个 headscale 用户。
# 用 `ls -ln /vol1/1000/APP/headplaneCN/headscale` 看属主，按它填：
#   例：属主 965:966 → HEADSCALE_UID=965 HEADSCALE_GID=966
# 填 0 表示以 root 运行：能正常启动，但新建的 WAL / socket 文件属主会变成 root。
HEADSCALE_UID=0
HEADSCALE_GID=0

# --- 宿主机参数 -------------------------------------------------------------
# 基础目录：容器内外都用它，所以必须写成绝对路径
BASE_DIR=/vol1/1000/APP/headplaneCN

# 面板监听的地址与端口。绑具体 IP 比绑 0.0.0.0 安全：面板是管理台，
# 不建议直接暴露到公网；前面必须有一层 TLS 反代或防火墙。
PANEL_BIND=192.168.1.10
PANEL_PORT=4100

TZ=Asia/Shanghai
```

::: warning 绑定具体 IP 时，两个地方要跟着改
面板的 `HEADPLANE_SERVER__HOST` 和它自己的健康检查探针用的是同一个地址。compose 里两者都引用
`${PANEL_BIND}:${PANEL_PORT}`，所以改 `.env` 一处即可 —— 手工改 compose 时不要只改一处，否则
容器会一直显示 `unhealthy`（详见[常见故障](#面板容器一直显示-unhealthy)）。
:::

## compose 文件

路径：`/vol1/1000/APP/headplaneCN/docker-compose.yml`

```yaml
services:
  # ---------------------------------------------------------------------------
  # Headscale 服务端（取代 fnOS/fpk 原生安装）
  # ---------------------------------------------------------------------------
  headscale:
    # 国内拉不动时用代理前缀，例如：
    #   v6.gh-proxy.org/docker/ghcr.io/juanfont/headscale:${HEADSCALE_VERSION}
    # 调试用（带 shell，二进制在 /ko-app/headscale）：
    #   v6.gh-proxy.org/docker/ghcr.io/juanfont/headscale:${HEADSCALE_VERSION}-debug
    image: headscale/headscale:${HEADSCALE_VERSION:?请在 .env 中设置 HEADSCALE_VERSION}
    container_name: headscale
    restart: unless-stopped

    # 与原生安装行为一致：直接用宿主机网络栈
    network_mode: host

    # 只读根文件系统（官方推荐）：可写的地方靠挂载和 tmpfs 提供
    read_only: true
    tmpfs:
      - /var/run/headscale
      - /tmp

    # 官方镜像不是 root 用户；数据目录属主是谁，这里就填谁（见 .env）
    user: "${HEADSCALE_UID:-0}:${HEADSCALE_GID:-0}"

    # 面板的 Docker 集成靠这个标签（或 container_name）找到本容器
    labels:
      me.tale.headplane.target: "headscale"

    volumes:
      # 配置文件：面板写的是同一个宿主文件，本容器只读挂载
      - "${BASE_DIR}/headscale/config.yaml:/etc/headscale/config.yaml:ro"
      # 【关键】数据目录以同一个绝对路径挂进来 → config.yaml 里的绝对路径不用改
      - "${BASE_DIR}/headscale:${BASE_DIR}/headscale"

    # 镜像入口就是 headscale 二进制；配置按默认顺序在 /etc/headscale 找到
    command: serve

    healthcheck:
      test: ["CMD", "headscale", "health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s

    # 容器日志取代原来的 headscale.log（原生版本那个文件能长到几百 MB 且不轮转）
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

  # ---------------------------------------------------------------------------
  # HeadplaneCN 面板
  # ---------------------------------------------------------------------------
  headplaneCN:
    # 国内可换加速前缀，例如：
    #   v6.gh-proxy.org/docker/ghcr.io/cgg888/headplanecn:${HEADPLANE_VERSION}
    image: ghcr.io/cgg888/headplanecn:${HEADPLANE_VERSION:-0.22.22}
    container_name: headplaneCN
    restart: unless-stopped

    # host 网络：面板才能用 127.0.0.1:8480 访问 Headscale 容器
    network_mode: host

    # 可选：Agent 需要宿主 PID 命名空间才能看到宿主机进程。Docker 集成不需要它。
    pid: host

    # 只保证启动顺序；面板自身会在 Headscale 就绪前重试
    depends_on:
      - headscale

    volumes:
      # 面板自己的配置与数据
      - "${BASE_DIR}/config.yaml:/etc/headplane/config.yaml:ro"
      - "${BASE_DIR}/data:/var/lib/headplane"

      # 面板要能改写 Headscale 配置与 DERP 地图
      - "${BASE_DIR}/headscale/config.yaml:/etc/headscale/config.yaml"
      - "${BASE_DIR}/headscale/derp-maps:${BASE_DIR}/headscale/derp-maps"
      # 数据目录按同一绝对路径挂进来（只读）：配置检查与快照能看到数据库、私钥
      - "${BASE_DIR}/headscale:${BASE_DIR}/headscale:ro"

      # 【可选】启用 dns.extra_records_path 时，把该文件也挂进来（需要可写）：
      # - "${BASE_DIR}/headscale/extra-records.json:${BASE_DIR}/headscale/extra-records.json"

      # Docker 集成靠它重启 headscale 容器。
      # ⚠️ 这是近乎 root 的权限：:ro 只保护 socket 文件本身，挡不住 API 调用，
      #    所以别指望用 :ro 降低风险，请把面板的访问控制做好。
      - "/var/run/docker.sock:/var/run/docker.sock"

    environment:
      - "TZ=${TZ}"
      # 面板监听地址（也用于它自己的健康检查探针）
      - "HEADPLANE_SERVER__HOST=${PANEL_BIND}"
      - "HEADPLANE_SERVER__PORT=${PANEL_PORT}"
      # 容器内 Headscale 生效配置的路径，与挂载点逐字一致
      - "HEADPLANE_HEADSCALE__CONFIG_PATH=/etc/headscale/config.yaml"

      # 集成方式：重启 Headscale 容器（而不是发 SIGHUP）
      - "HEADPLANE_INTEGRATION__DOCKER__ENABLED=true"
      - "HEADPLANE_INTEGRATION__DOCKER__CONTAINER_NAME=headscale"
      - "HEADPLANE_INTEGRATION__PROC__ENABLED=false"

    # 面板自带 /bin/hp_healthcheck 固定探 127.0.0.1，绑了具体 IP 时会连接被拒（容器一直 unhealthy）→
    # 这里直接用镜像里的 node 探真实地址（/admin/healthz 无需鉴权，返回 {"status":"OK"}）。
    healthcheck:
      test:
        [
          "CMD",
          "/nodejs/bin/node",
          "-e",
          "fetch('http://${PANEL_BIND}:${PANEL_PORT}/admin/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",
        ]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s

    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

### 每个挂载的作用（一行一条）

| 挂载                                                       | 作用                                                                                      |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `config.yaml:/etc/headscale/config.yaml:ro`（headscale）   | Headscale 的生效配置，只读挂载；面板改的是同一个宿主文件                                  |
| `headscale:${BASE_DIR}/headscale`（headscale）             | 数据库、私钥、socket、地图的读写位置，**路径与宿主机逐字一致**                            |
| `config.yaml:/etc/headplane/config.yaml:ro`（面板）        | 面板自己的配置，只读即可                                                                  |
| `data:/var/lib/headplane`（面板）                          | 面板的持久化数据（会话、内部库、快照、Agent 状态）                                        |
| `headscale/config.yaml:/etc/headscale/config.yaml`（面板） | 面板在这里读写 Headscale 配置（系统页、DERP 页、ACL 等）                                  |
| `headscale/derp-maps:${BASE_DIR}/.../derp-maps`（面板）    | DERP 地图的查看/编辑/保存；「官方区域筛选」写出的文件也在这里，Headscale 读的是同一个文件 |
| `headscale:${BASE_DIR}/headscale:ro`（面板）               | 同一绝对路径 + 只读：配置检查与快照能看到 `db.sqlite`、私钥等；只读避免面板误写           |
| `/var/run/docker.sock`（面板）                             | Docker 集成用它重启 Headscale 容器；`:ro` 并不能限制 socket 通信，请按 root 权限对待      |

::: info 只读的数据目录是刻意的
HeadplaneCN 的用户不是 Headscale 的用户。把数据目录挂成只读，配置检查里「数据库目录」一项会显示
**无法验证写入权限** —— 这是预期结果，不是故障。
:::

### host 网络的限制

`network_mode: host` 的容器**不要写 `ports:`，也不要写 `extra_hosts:`**：host 网络下容器直接使用
宿主机的网络命名空间，端口映射没有意义（Compose 会拒绝或忽略它），`extra_hosts` 同样无效 ——
也不需要，容器里的 `127.0.0.1` 本来就是宿主机。

于是对外端口完全由容器里监听什么决定：

| 端口        | 谁在听                     | 怎么对外                                                                  |
| ----------- | -------------------------- | ------------------------------------------------------------------------- |
| `tcp/8480`  | Headscale 控制服务         | 反代回源到 `127.0.0.1:8480`（控制路径与 `/derp` 都在这个端口上）          |
| `tcp/8481`  | Headscale 指标             | 默认只听 `127.0.0.1`；不要发布到公网                                      |
| `tcp/50443` | gRPC（`grpc_listen_addr`） | 默认只听 `127.0.0.1`，给本机 `headscale` CLI 用；不用对外                 |
| `udp/3478`  | 内嵌 DERP 的 STUN          | 在路由器/防火墙上把 `udp/3478` 直接放开到这台 NAS，**不能**走 HTTP 反代   |
| `tcp/4100`  | HeadplaneCN                | 反代回源到 `${PANEL_BIND}:${PANEL_PORT}`（默认 `4100`，改了要同步改回源） |

> 这里用 `8480 / 8481`（很多 fnOS 原生安装的历史端口）；官方默认是 `8080 / 9090`。用哪个都行，
> 只要**全程一致**：`config.yaml` 的 `listen_addr`、反代回源、健康检查。

> [!IMPORTANT]
> `tcp/4100` 是管理台，暴露面最大。只在本机做反代时把 `PANEL_BIND` 收成 `127.0.0.1` 更安全；
> 无论哪种情况，都不要把 `tcp/4100` 直接暴露到公网。

## 两侧的配置改动

### HeadplaneCN：`/vol1/1000/APP/headplaneCN/config.yaml`

```yaml
server:
  host: "192.168.1.10" # 与 .env 的 PANEL_BIND 一致；绑具体 IP 比 0.0.0.0 安全
  port: 4100

  # 浏览器访问的完整地址：协议 + 域名 + 端口，结尾不带 /admin
  base_url: "https://admin.example.com:8443"
  # 必须正好 32 个字符：openssl rand -base64 24
  cookie_secret: "<32 位随机串>"
  cookie_secure: true
  data_path: "/var/lib/headplane"

headscale:
  # host 网络下容器里的 127.0.0.1 就是宿主机，也就是 Headscale 容器
  url: "http://127.0.0.1:8480"

  # 浏览器里展示、浏览器 SSH 使用的对外地址（不填则回退上面的 url）
  public_url: "https://ha.example.com:8443"

  # 【必填】完整的 API Key，不是列表里显示的前缀
  api_key: "hskey-api-<你的完整 API Key>"

  # 【必填】容器内 Headscale 生效配置的路径，与挂载点逐字一致
  config_path: "/etc/headscale/config.yaml"

  # 可选：与 Headscale 的 dns.extra_records_path 指向同一个文件，改 DNS 记录无需重启
  # dns_records_path: "/vol1/1000/APP/headplaneCN/headscale/extra-records.json"

integration:
  # 【本形态的默认】保存配置 / 点「重新加载」时重启 Headscale 容器
  docker:
    enabled: true
    # 用容器名或标签二选一；两者都能找到（compose 里都写了）
    container_name: "headscale"
    container_label: "me.tale.headplane.target=headscale"
    socket: "unix:///var/run/docker.sock"

  # 原生进程才用它；双镜像形态下保持关闭
  proc:
    enabled: false

  # Agent：同步节点版本 / OS 详情，以及各机器所用的 DERP 区域与延迟
  agent:
    enabled: true
    host_name: "nas"
    cache_ttl: 30
    work_dir: "/var/lib/headplane/agent"
    executable_path: "/usr/local/bin/hp_agent"
```

必改的只有五项：`server.base_url`、`server.cookie_secret`、`headscale.url`、
`headscale.api_key`、`headscale.config_path`。

::: tip compose 里已经用环境变量写了这些
上面的 `HEADPLANE_SERVER__HOST/PORT`、`HEADPLANE_HEADSCALE__CONFIG_PATH`、
`HEADPLANE_INTEGRATION__DOCKER__*` 与配置文件里的键一一对应，而且**环境变量优先级更高**。
两种写法二选一即可：写进 compose 就不用动 `config.yaml`；写进配置文件就可以删掉那些环境变量。
:::

### Headscale：`/vol1/1000/APP/headplaneCN/headscale/config.yaml`

下面是 **Headscale 0.29.4 的完整配置**（脱敏后的示例值）。关键在于：所有绝对路径都指向
`/vol1/1000/APP/headplaneCN/headscale/...`，而这个目录在容器里就是**同一个绝对路径** ——
所以从原生部署搬过来时，这些路径**不用改**。

```yaml
# /vol1/1000/APP/headplaneCN/headscale/config.yaml

# 【最重要】客户端注册用的地址。迁移全程保持逐字不变：改了它，所有已注册节点都要重新登录
server_url: https://ha.example.com:8443

# 监听地址；host 网络下就是 NAS 自己的端口
listen_addr: 0.0.0.0:8480
metrics_listen_addr: 127.0.0.1:8481
grpc_listen_addr: 127.0.0.1:50443
grpc_allow_insecure: false

# 反向代理所在网段/地址（面板与 Headscale 在同一台机器上时，127.0.0.1 是必须的）
trusted_proxies:
  - 127.0.0.1/32
  - 192.168.1.0/24
  - fd00::/8

# 客户端密钥与节点 IP 段
noise:
  private_key_path: /vol1/1000/APP/headplaneCN/headscale/noise_private.key

prefixes:
  v4: 100.64.0.0/10
  v6: fd7a:115c:a1e0::/48
  allocation: sequential

derp:
  # 内嵌 DERP 中继（自建中继）：客户端会用它做中继
  server:
    enabled: true
    region_id: 999
    region_code: "GDDG"
    region_name: "广东东莞"
    verify_clients: true
    stun_listen_addr: "[::]:3478"
    private_key_path: /vol1/1000/APP/headplaneCN/headscale/derp_server_private.key
    automatically_add_embedded_derp_region: true
    # 可选：对外公告的地址；没有公网地址就留空 ""
    ipv4: 203.0.113.10
    ipv6: 2001:db8::1

  # 官方 DERP 全量列表；只用自建中继就保持 []
  urls: []

  # 本地地图文件。路径必须与面板 DERP 页里「官方区域筛选」的目标文件一致，
  # 否则保存后 Headscale 重载会找不到文件（见常见故障）
  paths:
    - /vol1/1000/APP/headplaneCN/headscale/derp-maps/official-mirror.yaml

  # 内置地图与官方列表的自动更新
  auto_update_enabled: true
  update_frequency: 24h
  disable_check_updates: false

node:
  expiry: 0
  ephemeral:
    inactivity_timeout: 30m
  routes:
    ha:
      probe_interval: 10s
      probe_timeout: 5s

database:
  type: sqlite
  debug: false
  gorm:
    prepare_stmt: true
    parameterized_queries: true
    skip_err_record_not_found: true
    slow_threshold: 1000
  sqlite:
    path: /vol1/1000/APP/headplaneCN/headscale/db.sqlite
    write_ahead_log: true
    wal_autocheckpoint: 1000

# TLS：由反代终止时全部留空（下面这些是 Headscale 自己申请证书时才用）
acme_url: https://acme-v02.api.letsencrypt.org/directory
acme_email: ""
tls_letsencrypt_hostname: ""
tls_letsencrypt_cache_dir: /vol1/1000/APP/headplaneCN/headscale/cache
tls_letsencrypt_challenge_type: HTTP-01
tls_letsencrypt_listen: ":http"
tls_cert_path: ""
tls_key_path: ""

log:
  level: info
  format: text

# ACL：想在网页里保存策略就必须是 database；用文件时改成 file 并填 path
policy:
  mode: database
  path: ""

dns:
  magic_dns: false
  base_domain: example.internal
  override_local_dns: false
  nameservers:
    global:
      - 1.1.1.1
      - 8.8.8.8
    split: {}
  search_domains: []
  extra_records: []
  # 启用「额外 DNS 记录」并希望在面板里保存即生效时，指向下面这个文件，
  # 同时把 compose 里那条可选挂载取消注释：
  # extra_records_path: /vol1/1000/APP/headplaneCN/headscale/extra-records.json

# 本机 CLI（headscale ...）用的 unix socket，同样落在数据目录里
unix_socket: /vol1/1000/APP/headplaneCN/headscale/headscale.sock
unix_socket_permission: "0770"

# OIDC 登录（用面板自带账号登录时整段删掉或保持注释）
oidc:
  only_start_if_oidc_is_available: true
  issuer: "https://idp.example.com/oidc"
  client_id: "<OIDC client id>"
  client_secret: "<OIDC client secret>"
  use_expiry_from_token: true
  scope:
    - openid
    - profile
    - email
  email_verified_required: true
  allowed_domains:
    - example.com
  allowed_users: []
  pkce:
    enabled: true
    method: S256

logtail:
  enabled: false
taildrop:
  enabled: true
auto_update:
  enabled: false
```

::: tip 这份配置是全量参考；安装脚本只写它负责的键
上面这份是 Headscale 0.29.4 的完整配置，照抄即可。安装脚本从零生成时只写它负责的键
（`server_url`、`listen_addr`、`metrics_listen_addr`、`prefixes`、`derp.*`、
`database.sqlite.path`、`noise.private_key_path`、`policy` 等），其余留空、由 Headscale 自己的默认值
生效 —— 例如不写 `grpc_listen_addr`，它就监听内置的 `127.0.0.1:50443`。已有的配置则只被改写这些键，
其它键原样保留。
:::

::: warning 不要凭记忆手写这份配置
Keys 写错时 Headscale 会直接拒绝启动（日志里是 `unknown key` / `cannot unmarshal`）。改完先验证：

```bash
cd /vol1/1000/APP/headplaneCN
docker compose exec headscale headscale configtest    # 只校验，不启动
```

如果报错就逐字对照镜像自带的示例配置（`docker compose exec headscale headscale -h` 能看到它支持的
子命令），或回到迁移前的原文重新对照 —— 注意迁移前那份里的绝对路径指向
`/vol1/@appdata/headscale/...`，复制进这个目录后要改成 `${BASE_DIR}/headscale/...`（见下一节），
其余键值照抄即可。
:::

### 为什么这次不用改绝对路径

旧的双镜像文档要求把 `noise_private_key_path`、`database.sqlite.path`、`derp.paths` 全部改写成
容器路径（`/var/lib/headscale/...`、`/etc/headscale/...`），因为那时只挂了「宿主机目录 → 另一个
容器路径」。这一版把**宿主机目录按同一个绝对路径**挂进容器：

```text
宿主机   /vol1/1000/APP/headplaneCN/headscale            ← 数据在这里
headscale 容器   - "${BASE_DIR}/headscale:${BASE_DIR}/headscale"
容器内   /vol1/1000/APP/headplaneCN/headscale            ← 同一个路径
配置里   private_key_path: /vol1/1000/APP/headplaneCN/headscale/noise_private.key
```

于是「配置里写谁」和「文件在哪」永远一致；备份、快照、面板的路径检查也都指向同一处。唯一的例外是
**配置文件的挂载点**：Headscale 默认从 `/etc/headscale/config.yaml` 读配置（除非用 `-c` 指定），
所以那一份仍然挂到 `/etc/headscale/config.yaml`。

### DERP 地图与「官方区域筛选」的目标路径

「设置 → Headscale → DERP」里的**官方区域节点筛选**会把自己生成的地图写成一个文件，并把它加进
`derp.paths`。这个文件的默认位置**由 Headscale 的实况配置推导**，不再写死：

1. `derp.paths` 里第一个绝对路径所在目录 + `official-mirror.yaml`；
2. 没有的话，用 Headscale 数据目录（由 `noise.private_key_path` → `database.sqlite.path` →
   `derp.server.private_key_path` → `unix_socket` 依次推断）+ `derp-maps/official-mirror.yaml`；
3. 都推断不出来时，才回退到老的原生默认值 `/vol1/@appdata/headscale/derp-maps/official-mirror.yaml`。

所以在双镜像形态里，只要 `derp.paths` 里那份文件存在，卡片就会自动指向
`/vol1/1000/APP/headplaneCN/headscale/derp-maps/official-mirror.yaml`。**你手动改过路径就以你的
为准**；只有还停留在老默认值时才按上面的规则重新推导 —— 从原生部署迁过来后如果卡片仍提示
「无法读取 /vol1/@appdata/...」，说明面板保存的是老路径，按下面两种办法任一处理：

- 在卡片里把路径改成新路径并保存；
- 或直接改面板数据文件（改前先备份，然后 `docker compose restart headplaneCN`）：

  ```bash
  cd /vol1/1000/APP/headplaneCN/data
  cp -a derp-region-mirror.json derp-region-mirror.json.bak-$(date +%Y%m%d-%H%M%S)
  sed -i "s#/vol1/@appdata/headscale/derp-maps/official-mirror.yaml\
  #/vol1/1000/APP/headplaneCN/headscale/derp-maps/official-mirror.yaml#g" \
    derp-region-mirror.json
  cd .. && docker compose restart headplaneCN
  ```

页面上的「DERP 地图文件的挂载提示」也会跟着 `derp.paths` 推导（`- "<目录>:<目录>"`），
不会再显示写死的 `/vol1/@appdata/...`。

## 从 fnOS 原生迁移到双镜像

按顺序做，别跳步。**全程不要改 `server_url`**。下面假定：原生数据在 `/vol1/@appdata/headscale`，
新目录是 `/vol1/1000/APP/headplaneCN`（按实际替换）。

**1. 先备份**

```bash
# 数据库、noise 私钥、配置、策略文件、DERP 地图与 DERP 私钥
sudo mkdir -p /vol1/1000/APP/headplaneCN/backup
sudo tar -czf /vol1/1000/APP/headplaneCN/backup/native-headscale-$(date +%Y%m%d-%H%M%S).tar.gz \
  -C /vol1/@appdata headscale
```

想拿到绝对一致的数据库副本，先在 fnOS 应用中心停掉 headscale 再做这份备份。原生安装的
`headscale.log` 可能有几百 MB：上面的 `tar` 会连它一起打包，介意就加
`--exclude=headscale/headscale.log`。

**2. 停掉原生 Headscale，确认端口空出来**

```bash
# fnOS 应用中心 → headscale → 停止
ps -ef | grep '[h]eadscale serve'          # 期望没有输出
ss -lntup | grep -E '8480|8481|3478|50443' # 期望没有输出（-u 才能看到 udp/3478）
```

**3. 复制数据到新目录（保持同一绝对路径的最终形态）**

```bash
mkdir -p /vol1/1000/APP/headplaneCN/headscale
sudo cp -a /vol1/@appdata/headscale/. /vol1/1000/APP/headplaneCN/headscale/

# 只删运行期残留：日志、pid、旧 socket（容器会重建 socket）
sudo rm -f /vol1/1000/APP/headplaneCN/headscale/headscale.log \
           /vol1/1000/APP/headplaneCN/headscale/headscale.pid \
           /vol1/1000/APP/headplaneCN/headscale/headscale.sock

# 属主：按 .env 里 HEADSCALE_UID/GID 填的值保持一致；私钥保持 600
sudo chmod 600 /vol1/1000/APP/headplaneCN/headscale/noise_private.key
sudo chmod 600 /vol1/1000/APP/headplaneCN/headscale/derp_server_private.key
ls -ln /vol1/1000/APP/headplaneCN/headscale | head   # 记下属主，填进 .env
```

**4. 放好 `.env`、`docker-compose.yml`、面板 `config.yaml`**

Headscale 的 `config.yaml` **原样保留**（第 3 步已经复制过去了）。要改的只有 `.env` 里的
`HEADSCALE_UID/GID`（按第 3 步看到的属主）、`PANEL_BIND`、两个版本号。

::: warning 只有当路径本来就指向新目录时才真的「原样」
配置里的 `noise.private_key_path`、`database.sqlite.path`、`derp.server.private_key_path`、
`derp.paths`、`unix_socket`（如果填了）都是**宿主机绝对路径**。它们必须落在
`${BASE_DIR}/headscale/` 里面 —— 容器只是把这个目录按同一绝对路径挂进去，路径本身不改。
如果它们还写着 `/vol1/@appdata/headscale/...`，手工迁移要自己改成
`/vol1/1000/APP/headplaneCN/headscale/...`（安装脚本会自动把这些旧路径改写过来，但只会改到
`${BASE_DIR}/headscale` 下，绝不会改写成 `/etc/headscale` 或 `/var/lib/headscale`）。
:::

::: tip 老 compose 先留一份
如果目录里已有「面板单容器 + 原生 headscale」的 compose，先备份成
`docker-compose.yml.bak-native-$(date +%Y%m%d-%H%M%S)` 再写新的 —— 回退那一节会用到。
:::

**5. 校验后起栈**

```bash
cd /vol1/1000/APP/headplaneCN
docker compose config --quiet        # 语法与变量都齐了吗
docker compose up -d
docker compose ps                    # 两个服务都应是 Up (healthy)
```

**6. 看日志、看页面**

```bash
docker compose logs headscale | tail -n 50
# 期望：version=v0.29.4、DB 打开在 …/headscale/db.sqlite、DERP region 999、
#       stun server started、listening and serving HTTP on 0.0.0.0:8480

curl -s http://127.0.0.1:8480/health              # {"status":"pass"}
docker compose exec headscale headscale nodes list | head
docker compose exec headscale headscale users list

docker compose logs headplaneCN | tail -n 50
# 期望：Connected to Headscale 0.29.4、
#       Found a valid Headscale configuration file at /etc/headscale/config.yaml、
#       Using Docker integration、Listening on http://<PANEL_BIND>:4100
```

浏览器打开 `https://admin.example.com:8443/admin`，进 **设置 → 系统**：集成应显示 **Docker**，
保存配置后 Headscale 容器会重启（日志里能看到 `Found container` / 容器重启）。再去
**设置 → Headscale → DERP** 确认地图卡片显示的是新路径。

**7. 客户端不需要重新注册**

`server_url`、对外端口、数据库、`noise_private.key`、DERP 私钥全都没变，所以已注册节点什么都不用做：

```bash
# 在任意一台客户端上
tailscale status        # 应该直接显示已连接，不需要 tailscale up
```

不要在这时候执行 `tailscale up --login-server ...` 或重新注册 —— 那会让节点以新的身份重新入网。

**8. 收尾**

- 把 fnOS 应用中心的 headscale 设为**不自动启动**（或择日卸载）。否则重启后它会先抢占 `8480`，
  容器里的 Headscale 起不来。
- `/vol1/@appdata/headscale` 原样保留几周再清理（它现在只是备份；注意里面可能有几百 MB 日志）。

## 回退到 fnOS 原生模式

双镜像要退回「Headscale 原生进程 + 面板容器」时，数据本身不用转换，只是搬回原位、换回进程集成。

**1. 停栈并备份**

```bash
cd /vol1/1000/APP/headplaneCN
docker compose down
sudo tar -czf backup/dual-image-headscale-$(date +%Y%m%d-%H%M%S).tar.gz -C . headscale
```

**2. 数据搬回原生目录**

```bash
sudo cp -a /vol1/1000/APP/headplaneCN/headscale/. /vol1/@appdata/headscale/
sudo rm -f /vol1/@appdata/headscale/headscale.sock        # 让原生进程重建
# 属主改回 fnOS 的 headscale 用户（用 `id headscale` 看实际 uid:gid）
sudo chown -R "$(id -u headscale):$(id -g headscale)" /vol1/@appdata/headscale
```

`config.yaml` 里的绝对路径要改回**原生数据目录**。双镜像形态下它们指向
`${BASE_DIR}/headscale/...`（例如 `/vol1/1000/APP/headplaneCN/headscale/...`），而 fnOS 原生进程读的是
`/vol1/@appdata/headscale/...`：把 `noise.private_key_path`、`database.sqlite.path`、
`derp.server.private_key_path`、`derp.paths`、`unix_socket`（如果填了）逐一改回去。
（正向迁移时安装脚本会自动把旧路径改写到新目录；反向这一步要手动改。）

**3. 起原生 Headscale**

fnOS 应用中心 → headscale → 启动（并恢复「开机自启」）。确认：

```bash
ps -ef | grep '[h]eadscale serve'
curl -s http://127.0.0.1:8480/health        # {"status":"pass"}
```

**4. 面板改回进程集成**

面板不再有 Headscale 容器可重启，所以集成要从 Docker 换成 proc，并按原生模式的要求改 compose：

```yaml
services:
  headplaneCN:
    image: ghcr.io/cgg888/headplanecn:<版本>
    container_name: headplaneCN
    restart: unless-stopped
    network_mode: host
    # 【必须】proc 集成要读 /proc 找到 headscale serve，才能给它发信号
    pid: host
    # 【必须】默认的 docker AppArmor 配置只允许向同一配置的进程发信号；
    # 给原生进程（unconfined）发 SIGHUP 会被拒绝：
    #   Failed to send SIGHUP to PID ...: Error: kill EACCES
    security_opt:
      - "apparmor=unconfined"
    volumes:
      - "/vol1/1000/APP/headplaneCN/config.yaml:/etc/headplane/config.yaml:ro"
      - "/vol1/1000/APP/headplaneCN/data:/var/lib/headplane"
      # 原生配置目录按同一绝对路径挂进来，面板才能改写它
      - "/vol1/@appdata/headscale:/vol1/@appdata/headscale"
      # 不再需要 docker.sock
    environment:
      - "TZ=Asia/Shanghai"
      - "HEADPLANE_SERVER__HOST=192.168.1.10"
      - "HEADPLANE_SERVER__PORT=4100"
      - "HEADPLANE_HEADSCALE__CONFIG_PATH=/vol1/@appdata/headscale/config.yaml"
      - "HEADPLANE_INTEGRATION__DOCKER__ENABLED=false"
      - "HEADPLANE_INTEGRATION__PROC__ENABLED=true"
      # 界面上的「重启 Headscale」按钮：需要进程被 systemd / s6 等监管时才安全
      - "HEADPLANE_INTEGRATION__PROC__ALLOW_RESTART=false"
```

```bash
docker compose up -d
docker compose logs headplaneCN | grep -iE 'valid Headscale configuration|Found headscale serve'
# 期望：Found headscale serve (PID ...)
```

**5. 验证**

- 面板 **设置 → 系统** 里集成显示为 **原生进程**；保存配置后日志出现 `Sent SIGHUP to Headscale`；
- 已注册客户端依旧不需要重新注册；
- 面板健康检查的探针地址与 `HEADPLANE_SERVER__HOST` 一致（见常见故障）。

完整细节（含原生模式的权限、监管进程要求）见 [fnOS 部署](/install/fnos) 与
[原生模式](/install/native-mode)。

## 升级与回滚

```bash
cd /vol1/1000/APP/headplaneCN

# 【必做】动 Headscale 之前先备份：数据库迁移是单向的
docker compose stop headscale
tar -czf backup/before-upgrade-$(date +%F-%H%M%S).tar.gz \
  --exclude=backup -C . headscale data config.yaml docker-compose.yml .env
docker compose start headscale

# 改 .env 里的版本号（两个都可以只改一个），然后
docker compose pull
docker compose up -d

# 检查
docker compose ps
docker compose logs headscale | tail -n 30
docker compose exec headscale headscale version
```

- **HeadplaneCN 回滚**：把 `HEADPLANE_VERSION` 改回旧版本，`docker compose up -d` 即可。它的数据
  在自己的 `data/` 里，与 Headscale 版本无关。
- **Headscale 回滚**：把 `HEADSCALE_VERSION` 改回旧版本再 `up -d`；**如果新版本已经跑过数据库
  迁移，光换回镜像不够** —— 先 `docker compose down`，用备份里的 `db.sqlite` 覆盖
  `headscale/db.sqlite`（连同 `-wal` / `-shm` 一起删掉再覆盖），再 `up -d`。
- 官方升级规则：**逐个次版本**升（0.26 → 0.27 → 0.28 → 0.29），不能跳版本；0.29 起要求客户端
  ≥ v1.80.0。
- 固定在 `.env` 里的版本号就是「锁版本」；不要为了让 `latest` 自动升级而放弃它。

## 反向代理要点

对外只有一个端口 `8443` 和两个主机名（外加可选的 `derp.`），按 Host 头分流，全部回源到这台 NAS：

| 对外主机名               | 回源                       | 承载流量                                                                                       |
| ------------------------ | -------------------------- | ---------------------------------------------------------------------------------------------- |
| `ha.example.com:8443`    | `http://127.0.0.1:8480`    | `server_url` 所在域名：客户端控制流量（`/key`、`/ts2021`、`/api/v1/*`、`/health`）以及 `/derp` |
| `derp.example.com:8443`  | `http://127.0.0.1:8480`    | `/derp` 中继流量的另一个入口（同一个容器）                                                     |
| `admin.example.com:8443` | `http://<PANEL_BIND>:4100` | HeadplaneCN 管理界面（`/admin`，含浏览器 SSH 的 WebSocket）                                    |
| `udp/3478`（不经反代）   | NAS 的 `udp/3478`          | STUN，必须直连                                                                                 |

### 客户端控制流量（`ha.`）

- 必须**支持 HTTP/2 并能一路透传到容器**：控制隧道 `/ts2021` 是长连接，代理降级到 HTTP/1.1 或做了
  缓冲会让节点时断时续。
- 读写超时调到 **300 秒以上**（或关闭），并**关闭响应缓冲 / gzip 改写**。
- **不要改写路径**：`/api/v1/*`、`/ts2021`、`/key`、`/health`、`/verify` 都要原样落到 `8480`。
- 证书必须是客户端信任的、且与 `server_url` 的域名一致。

### DERP 中继流量（`/derp`）

- 客户端拿到的中继地址是 Headscale 用 `server_url` 推导出来的（域名取 `server_url` 的域名、端口取
  它的端口、路径是 `/derp`）。所以**`server_url` 那个域名必须能吃下 `/derp`**；
  `derp.example.com` 只是同一个容器上的第二个入口。
- 保留 **Upgrade / WebSocket** 升级头，**不要缓冲**，超时 ≥300 秒；路径不要重写、不要去掉。
- 两个域名都要有有效证书；TLS 由反代终止，容器里继续是明文 HTTP。

### STUN（`udp/3478`）

HTTP 反向代理**转发不了 UDP**。DERP map 里公告的 STUN 端口是 `udp/3478`，客户端会往
`<server_url 的域名>:3478/udp` 发包，所以要在路由器/防火墙上直接放开：

```text
udp/3478  →  <NAS 的 IP>:3478/udp
```

### 验证（三招，按顺序）

```bash
# ① 直连 Headscale：确认 /derp 路由存在（期望 400/426 一类，不是 404）
curl -si http://127.0.0.1:8480/derp | head -3

# ② 经反代：状态码应与 ① 一致
curl -si https://ha.example.com:8443/derp | head -3

# ③ 客户端侧（决定性证据）
tailscale debug derp-map | grep -A 12 -i headscale
tailscale debug derp headscale
```

## 验收清单

```bash
cd /vol1/1000/APP/headplaneCN

docker compose ps                                     # 两个服务都 Up (healthy)
docker compose logs headplaneCN | grep -i 'valid Headscale configuration'
docker compose logs headplaneCN | grep -i 'Using Docker integration'
docker compose logs headplaneCN | grep -i 'Listening on'
docker compose logs headscale | grep -iE 'error|derp' | tail
docker compose exec headscale headscale health
curl -s http://127.0.0.1:8480/health                  # {"status":"pass"}
```

- [ ] 两个容器都在跑，`docker compose restart` 后自动恢复、`up -d` 幂等
- [ ] 面板 **设置 → 系统** 集成显示 **Docker**，保存配置能重启 Headscale 容器
- [ ] **已注册客户端不重新注册即可上线**（`tailscale status` 直接显示已连接）
- [ ] `设置 → 系统 → 配置检查`整体为绿（只读数据目录的「无法验证写入权限」是预期）
- [ ] 内嵌中继真的被使用：`tailscale debug derp-map` 能看到区域，机器详情页显示该区域
- [ ] DERP 页「官方区域筛选」的目标文件路径与 `derp.paths` 一致，且文件存在、可读
- [ ] 通过反代能打开 `https://admin.example.com:8443/admin`
- [ ] `udp/3478` 从公网可达（`tailscale netcheck` 里 STUN 不是「不可用」）

## 常见故障

### 面板容器一直显示 `unhealthy`

面板镜像自带的健康检查是 `/bin/hp_healthcheck`，它固定探 `127.0.0.1:<port>`。当
`server.host` / `HEADPLANE_SERVER__HOST` 绑的是**具体 IP**（例如 `192.168.1.10`）时，
回环地址上并没有监听，于是：

```text
Health check failed: Get "http://127.0.0.1:4100/admin/healthz": dial tcp 127.0.0.1:4100: connect: connection refused
```

容器功能完全正常，只是健康状态一直红 —— 按本页 compose 里的写法用自己的探针替掉即可（用镜像里的
`/nodejs/bin/node` 探真实地址）：

```yaml
healthcheck:
  test:
    [
      "CMD",
      "/nodejs/bin/node",
      "-e",
      "fetch('http://192.168.1.10:4100/admin/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",
    ]
```

改完 `docker compose up -d`（只会重建面板容器）。

### 面板容器里没有 shell

发布镜像默认是 distroless，没有 `sh`：`docker compose exec headplaneCN sh -c '...'` 会直接失败
（输出 `Headplane containers do not contain a shell by default.`）。要排查就用镜像里的 node：

```bash
docker compose exec headplaneCN /nodejs/bin/node -e "console.log(require('fs').readFileSync('/var/lib/headplane/derp-region-mirror.json','utf8').slice(0,200))"
```

或者临时换 `:<版本>-shell` 变体镜像来排查。

### 「官方区域筛选」提示「无法读取 /vol1/@appdata/headscale/derp-maps/...」

面板数据文件里保存的还是老的原生路径，而双镜像形态下容器**没有挂载** `/vol1/@appdata`。
按上文[DERP 地图与「官方区域筛选」的目标路径](#derp-地图与官方区域筛选-的目标路径)改成新路径
即可（卡片里改，或改 `data/derp-region-mirror.json` 后重启面板）。

### `getting DERPMap: open .../derp-maps/xxx.yaml: no such file or directory`

Headscale 启动/重载时读不到 `derp.paths` 里的某个文件，于是直接退出。三种原因：

1. **文件不存在**：先建占位文件，再把它写进配置。

   ```bash
   printf 'regions: {}\n' > /vol1/1000/APP/headplaneCN/headscale/derp-maps/official-mirror.yaml
   ```

2. **`derp.paths` 与面板卡片里的路径不一致**：两处必须是同一条路径（同一个文件）。
3. **挂载没生效**：compose 里少了 `"${BASE_DIR}/headscale:${BASE_DIR}/headscale"`，或路径写错。

   ```bash
   docker compose exec headscale ls -l /vol1/1000/APP/headplaneCN/headscale/derp-maps/
   ```

先让它能起来：把 `derp.paths` 里那一行注释掉，或用面板 **设置 → 快照** 回滚到写入前的配置快照，
重启后再按「先在宿主目录建文件 → 确认挂载 → 写进 `derp.paths`」的顺序重做。

### 客户端一直不上线

按可能性从高到低排查：

| 检查                    | 命令 / 位置                                                                 | 结论                                                       |
| ----------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `server_url` 有没有被改 | `docker compose exec headscale grep server_url /etc/headscale/config.yaml`  | 必须与迁移前逐字一致；改过就得把每个节点重新注册           |
| 域名与证书              | 外网机器上 `curl -sI https://ha.example.com:8443/health`                    | 证书必须受客户端信任、域名必须与 `server_url` 一致         |
| 反代是否透传长连接      | 反代里看是否 HTTP/2、是否关了缓冲、超时是否 ≥300 秒                         | `/ts2021` 被缓冲或降级会让节点连不上或频繁掉线             |
| noise 私钥是否搬过来    | `docker compose exec headscale ls -l /vol1/1000/APP/headplaneCN/headscale/` | 私钥被重新生成时，已注册节点全部无法通信（必须从备份恢复） |
| 数据库是否搬过来        | `docker compose exec headscale headscale nodes list`                        | 列表为空说明 `db.sqlite` 没搬对或指向了别的路径            |
| 端口被原生进程占用      | `ss -lntup \| grep 8480`                                                    | 应用中心里的 headscale 还在跑 → 停掉它并关掉开机自启       |
| 服务本身是否活着        | `curl -s http://127.0.0.1:8480/health`、`docker compose logs headscale`     | 不是 `{"status":"pass"}` 就先看日志里的第一条错误          |

::: tip 一句话
客户端只认 `server_url` 和它背后的证书与链路；数据库和 noise 私钥是「它还是原来那个控制服务」的
凭据。这两样对了，客户端就不需要重新注册。

其它症状（保存报 `Unexpected Server Error`、`403 Policy is not writable` 等）见
[常见问题](/configuration/common-issues)。
:::
