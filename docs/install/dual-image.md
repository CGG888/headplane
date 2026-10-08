---
title: fnOS（飞牛）· 双镜像模式
description: "在飞牛 fnOS 上用两个容器分别运行 Headscale 与 HeadplaneCN：host 网络、容器内外同一个绝对路径、Docker 集成，含 .env、完整 compose、两份配置、启动自检、升级回滚与验收清单。"
outline: [2, 3]
---

# fnOS（飞牛）· 双镜像模式安装

这一页只讲**安装与自检**：**Headscale** 与 **HeadplaneCN** 各跑一个容器，两个容器都用
**host 网络**（`127.0.0.1` 就是这台 NAS），Headscale 的数据目录在容器内外用**同一个绝对路径**，
所以配置文件里的绝对路径一个字都不用改。配置保存后由面板**重启 Headscale 容器**来生效。

它不讲的东西分别在哪：从别的形态搬过来或搬回去看 [迁移与回退](/install/migration)；
中继（内嵌 DERP、`derp.paths`、官方区域筛选）看 [DERP 与中继](/configuration/derp)；
域名与证书看 [域名与访问方式](/install/domains)；反代怎么填、STUN 怎么放行看
[Lucky 反向代理](/install/reverse-proxy-lucky)；界面上每个页面提供什么看
[功能总览](/features/overview)。

::: tip 适用环境

- NAS（飞牛 fnOS 等）：Docker 与 Docker Compose 已就绪
- 反向代理：Lucky、Caddy 等（可以和这两个容器不在同一台机器上）
- 客户端已经注册在一个**固定的 `server_url`** 上 —— 全程不改它
  :::

## 需要你改的值

| 占位符             | 示例                             | 说明                                                    | 在哪里改                                           |
| ------------------ | -------------------------------- | ------------------------------------------------------- | -------------------------------------------------- |
| Headscale 域名     | `ha.example.com`                 | **必须改**：客户端注册并连接的域名                      | Headscale 的 `server_url`、面板的 `public_url`     |
| 面板域名           | `panel.example.com`              | **必须改**：浏览器打开面板用的域名                      | 面板的 `base_url`、反代规则                        |
| 对外端口           | `8443`                           | **可改**：反代对外监听的端口，几处必须写一致            | `server_url`、`public_url`、`base_url`、反代规则   |
| NAS 局域网 IP      | `192.168.1.10`                   | **必须改**：反代回源要打这个地址，写 `127.0.0.1` 连不上 | `.env` 的 `PANEL_BIND`、面板的 `server.host`       |
| 基础目录           | `/vol1/1000/APP/headplaneCN`     | **可改**：配置、数据、备份都放在这里                    | `.env` 的 `BASE_DIR` 与所有绝对路径                |
| 面板端口           | `4100`                           | **可改**（默认 4100）：面板自己监听的端口               | `.env` 的 `PANEL_PORT`                             |
| 镜像版本           | `0.29.4` / `0.22.22`             | **可改**：升级就是改这两行数字                          | `.env`                                             |
| Headscale 数据属主 | `965:966`                        | **必须改**：按数据目录的实际属主填                      | `.env` 的 `HEADSCALE_UID` / `HEADSCALE_GID`        |
| API Key            | `hskey-api-...`                  | **必须改**：第二节生成，只显示一次                      | 面板的 `headscale.api_key`                         |
| cookie 密钥        | `openssl rand -base64 24` 的输出 | **必须改**：正好 32 字符，手写必错                      | 面板的 `server.cookie_secret`                      |
| Headscale 控制端口 | `127.0.0.1:8480`                 | **别动**：面板靠它连 Headscale                          | Headscale 的 `listen_addr`、面板的 `headscale.url` |
| 时区               | `Asia/Shanghai`                  | **可改**                                                | `.env` 的 `TZ`                                     |

## 先认清路径：容器内外是同一个路径

这个形态靠三件事成立：

| 机制             | 做法                                                       | 带来的结果                                                                   |
| ---------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **host 网络**    | 两个服务都 `network_mode: host`，不写 `ports:`             | 面板用 `http://127.0.0.1:8480` 访问 Headscale；`udp/3478` 直接可用，无需映射 |
| **同一绝对路径** | 数据目录挂成 `${BASE_DIR}/headscale:${BASE_DIR}/headscale` | 配置里的绝对路径不用改；两个容器看到同一份 `config.yaml` 和地图文件          |
| **Docker 集成**  | 面板挂 `/var/run/docker.sock`，按容器名找到 Headscale 容器 | 保存配置 / 点「重新加载」时由面板重启 Headscale 容器，**不发 SIGHUP**        |

由此得到两条附带结论：**不需要** `security_opt: ["apparmor=unconfined"]`（那是给原生进程发信号才要的，
容器默认的 AppArmor 配置会拒绝，报 `kill EACCES`）；**`pid: host` 是可选的**（Docker 集成不需要它，
留着只是为了面板里的 Agent 能看到宿主机进程信息）。

它和 [fnOS 原生模式](/install/fnos) 的唯一区别，就是 Headscale 从宿主机进程变成容器、集成方式
从「发 SIGHUP」变成「重启容器」。为什么路径不用改，看下面这张对照：

```text
宿主机   /vol1/1000/APP/headplaneCN/headscale            ← 数据在这里
headscale 容器   - "${BASE_DIR}/headscale:${BASE_DIR}/headscale"
容器内   /vol1/1000/APP/headplaneCN/headscale            ← 同一个路径
配置里   private_key_path: /vol1/1000/APP/headplaneCN/headscale/noise_private.key
```

于是「配置里写谁」和「文件在哪」永远一致；备份、快照、面板的路径检查也都指向同一处。唯一的例外是
**配置文件本身的挂载点**：Headscale 默认从 `/etc/headscale/config.yaml` 读配置，所以那一份仍然挂到
`/etc/headscale/config.yaml`。

## 一、确认 Headscale 与端口现状

```bash
curl -s http://127.0.0.1:8480/health         # 已有 Headscale 时 {"status":"pass"}
ss -lntup | grep -E '8480|8481|50443|4100'   # 这些端口有没有被别的服务占用（-u 才能看到 udp/3478）
```

- **全新安装**：上面两条命令没有输出是正常的，继续往下。
- **已有 Headscale**（原生进程或旧形态）：记下它是否在跑 —— 双镜像形态下它必须让出 `8480`（见第八节）。
- 装之前先扫一遍端口。真实事故：NAS 上 `8443` 曾被别的容器占用，把反代的端口规划和 `server_url` 一起打乱。

## 二、生成 API 密钥

面板需要一把 Headscale 管理 API 密钥（形如 `hskey-api-...`），**只显示一次**，立刻记下来。

```bash
cd /vol1/1000/APP/headplaneCN
docker compose exec headscale headscale apikeys create --expiration 90d
```

这一步要求 **headscale 容器已经在跑**，所以分两种情况：

- **从原生模式搬过来**（Headscale 现在还是宿主机进程）：先用原生 CLI 生成，等容器起来以后再核对：

  ```bash
  cd /vol1/@appcenter/headscale
  ./headscale --config /vol1/@appdata/headscale/config.yaml apikeys create --expiration 90d
  ```

- **全新安装**：先按第四 ~ 七节把文件放好并 `docker compose up -d`，再回到这里执行上面的命令，
  把 key 填进第五节的 `headscale.api_key`，然后 `docker compose up -d` 让面板读到它。

- 权限不足时用 `sudo` 执行（fnOS 的应用目录属于 root）。
- 这把 key 是**服务端**凭据：Agent 同步、OIDC 会话、代理认证都由它发起，它和你以后在登录框里输的那把是两件事。
- 旧 key 泄漏：`apikeys list` 查前缀 → `apikeys expire --prefix <前缀>` 撤销。

## 三、要改的 Headscale 配置（只列必须项）

生效的配置是 `${BASE_DIR}/headscale/config.yaml`。**从原生部署搬过来的话，一个字都不用改**；
全新安装至少要写这几项：

```yaml
# /vol1/1000/APP/headplaneCN/headscale/config.yaml

# 客户端实际连的地址；改它会让已注册节点需要重新注册
server_url: https://ha.example.com:8443 # ← 必须改（不能带路径前缀）

listen_addr: 0.0.0.0:8480 # ← 别动（面板靠 127.0.0.1:8480 连它）
metrics_listen_addr: 127.0.0.1:8481 # ← 别动（指标只听本机）
grpc_listen_addr: 127.0.0.1:50443 # ← 别动（本机 headscale CLI 用）

trusted_proxies: # ← 别动（反代就在本机）
  - 127.0.0.1/32
  - 192.168.1.0/24 # ← 可改（你的局域网网段）
  - fd00::/8

noise:
  private_key_path: /vol1/1000/APP/headplaneCN/headscale/noise_private.key # ← 别动（必须落在数据目录里）

database:
  type: sqlite # ← 别动
  sqlite:
    path: /vol1/1000/APP/headplaneCN/headscale/db.sqlite # ← 别动

policy:
  mode: database # ← 必须改（想用网页改 ACL 就必须 database）
  path: "" # ← 别动

unix_socket: /vol1/1000/APP/headplaneCN/headscale/headscale.sock # ← 别动
unix_socket_permission: "0770" # ← 别动

dns:
  magic_dns: false # ← 可改
  base_domain: example.internal # ← 可改
  override_local_dns: false # ← 别动
  # extra_records_path: /vol1/1000/APP/headplaneCN/headscale/extra-records.json   # ← 可改（推荐）
```

::: warning 配置文件里不能写 `${BASE_DIR}`
`.env` 和 compose 里的 `${BASE_DIR}` 由 Docker Compose 替换，但 **`config.yaml` 不经过 Compose**，
所以上面每一个绝对路径都要写成完整路径（例如 `/vol1/1000/APP/headplaneCN/headscale/...`）；
写了 `${BASE_DIR}` 会变成一个字面量路径，Headscale 找不到文件就起不来。
:::

::: warning 不要凭记忆手写这份配置
键名写错时 Headscale 会直接拒绝启动（日志里是 `unknown key` / `cannot unmarshal`）。改完先校验：

```bash
cd /vol1/1000/APP/headplaneCN
docker compose exec headscale headscale configtest    # 只校验，不启动
```

:::

::: tip 完整配置从哪来
全新安装时，完整的 0.29.4 配置交给[安装脚本](/install/dual-image#十二、可选-用安装脚本一次生成)生成
（`--dry-run` 会先打印给你看）；从原生部署迁移时，现成的那份直接照用，见
[迁移与回退](/install/migration)。想要中继（内嵌 DERP、`derp.paths` 本地地图、官方区域筛选），
`derp:` 段不在本页展开，见 [DERP 与中继](/configuration/derp)。
:::

::: tip 要搬家？（迁移步骤不在本页）

- 现在的形态是「Headscale 原生进程 + 面板容器」，想换成这一页的双镜像 → 看
  [迁移与回退](/install/migration)，备份、复制、校验都写在那边。
- 想从双镜像退回 fnOS 原生模式 → 同一页的回退部分。
  :::

## 四、准备目录

所有路径以 `/vol1/1000/APP/headplaneCN` 为例，按你的实际存储位置替换。**两个容器、一个目录**，
配置、数据、备份都在一处，`tar` 一次就是完整备份。

| 宿主机路径                                         | 用途                                                                                                  | 容器内路径                                          |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `/vol1/1000/APP/headplaneCN/docker-compose.yml`    | 两个容器的定义                                                                                        | —                                                   |
| `/vol1/1000/APP/headplaneCN/.env`                  | 版本号、运行用户、绑定地址                                                                            | —                                                   |
| `/vol1/1000/APP/headplaneCN/config.yaml`           | HeadplaneCN 自己的配置                                                                                | `/etc/headplane/config.yaml`（只读）                |
| `/vol1/1000/APP/headplaneCN/data/`                 | 面板数据：会话、内部库、快照、Agent 状态                                                              | `/var/lib/headplane`                                |
| `/vol1/1000/APP/headplaneCN/headscale/config.yaml` | **Headscale 生效配置**                                                                                | `/etc/headscale/config.yaml`（容器只读 / 面板读写） |
| `/vol1/1000/APP/headplaneCN/headscale/`            | `db.sqlite`、`noise_private.key`、`derp_server_private.key`、`headscale.sock`、`cache/`、`derp-maps/` | **同一个绝对路径**（headscale 读写 / 面板只读）     |
| `/vol1/1000/APP/headplaneCN/headscale/derp-maps/`  | 本地 DERP 地图                                                                                        | **同一个绝对路径**（面板读写）                      |
| `/vol1/1000/APP/headplaneCN/backup/`               | 迁移与升级前的 `tar.gz` 备份                                                                          | —                                                   |

```bash
mkdir -p /vol1/1000/APP/headplaneCN/{data,backup} \
         /vol1/1000/APP/headplaneCN/headscale/derp-maps

cd /vol1/1000/APP/headplaneCN
openssl rand -base64 24        # 生成 cookie_secret，记下来（正好 32 字符）
chmod 600 /vol1/1000/APP/headplaneCN/headscale/noise_private.key   # 私钥权限（文件已存在时）
```

## 五、设置文件 ①：`config.yaml`（面板）

路径：`/vol1/1000/APP/headplaneCN/config.yaml`

```yaml
server:
  host: "192.168.1.10" # ← 必须改（NAS 局域网 IP；别写 0.0.0.0，反代按它回源）
  port: 4100 # ← 别动（对外端口由 compose 环境变量覆盖）

  # 浏览器访问的完整地址：协议 + 域名 + 端口，结尾不带 /admin
  base_url: "https://panel.example.com:8443" # ← 必须改
  cookie_secret: "请用上面的命令生成" # ← 必须改（正好 32 字符，多了少了容器起不来）
  cookie_secure: true # ← 必须改（HTTPS 反代 true；纯 HTTP 访问 false）
  data_path: "/var/lib/headplane" # ← 别动（compose 已持久化到 ./data）

headscale:
  # host 网络下容器里的 127.0.0.1 就是宿主机，也就是 Headscale 容器
  url: "http://127.0.0.1:8480" # ← 别动
  public_url: "https://ha.example.com:8443" # ← 必须改（浏览器里展示、浏览器 SSH 用）
  api_key: "hskey-api-..." # ← 必须改（第二节那把完整 key，不是列表里的前缀）
  config_path: "/etc/headscale/config.yaml" # ← 别动（必须与 compose 挂载点逐字一致）
  # dns_records_path: "/vol1/1000/APP/headplaneCN/headscale/extra-records.json"   # ← 可改

integration:
  docker:
    enabled: true # ← 别动（保存配置 / 点「重新加载」时重启 Headscale 容器）
    container_name: "headscale" # ← 别动（用容器名或标签二选一，两者都能找到）
    container_label: "me.tale.headplane.target=headscale" # ← 别动
    socket: "unix:///var/run/docker.sock" # ← 别动
  proc:
    enabled: false # ← 别动（原生进程才用它；双镜像形态保持关闭）
  agent:
    enabled: true # ← 别动（节点版本 / OS 详情 / DERP 区域靠它同步）
    host_name: "nas" # ← 可改
    cache_ttl: 180000 # ← 别动（单位毫秒，默认 3 分钟；写小了 Agent 每次都要重新同步）
    work_dir: "/var/lib/headplane/agent" # ← 别动
    executable_path: "/usr/libexec/headplane/agent" # ← 别动（镜像里 Agent 的实际路径）
```

::: danger `cookie_secret` 必须正好 32 个字符
校验写死了长度等于 32；多了少了容器都会带着
`The configuration is missing required fields or has invalid values` 退出。
`openssl rand -base64 24` 生成的正好 32 字符，别手写、别截断。
:::

::: tip compose 里已经用环境变量写了这些
第六节的 `HEADPLANE_SERVER__HOST/PORT`、`HEADPLANE_HEADSCALE__CONFIG_PATH`、
`HEADPLANE_INTEGRATION__DOCKER__*` 与这里的键一一对应，而且**环境变量优先级更高**。
两种写法二选一即可：写进 compose 就不用动这份配置文件；写进配置文件就可以删掉那些环境变量。
:::

## 六、设置文件 ②：`.env` 与 `docker-compose.yml`

### `.env`

compose 会自动读取同目录的 `.env`。**版本号和运行用户都在这里**，升级只改一个数字。

```ini
# /vol1/1000/APP/headplaneCN/.env

# --- 镜像版本 ---------------------------------------------------------------
# 固定版本，不要用 latest：升级就是显式改这两行
HEADSCALE_VERSION=0.29.4        # ← 可改（升级只改这里）
HEADPLANE_VERSION=0.22.22       # ← 可改

# --- 运行 headscale 容器的用户 ----------------------------------------------
# 官方镜像以非 root 用户构建，而数据目录的属主是原来那个 headscale 用户。
# 用 `ls -ln /vol1/1000/APP/headplaneCN/headscale` 看属主，按它填：
#   例：属主 965:966 → HEADSCALE_UID=965 HEADSCALE_GID=966
# 填 0 表示以 root 运行：能正常启动，但新建的 WAL / socket 文件属主会变成 root。
HEADSCALE_UID=0                 # ← 必须改（按数据目录实际属主）
HEADSCALE_GID=0                 # ← 必须改

# --- 宿主机参数 -------------------------------------------------------------
# 基础目录：容器内外都用它，必须是绝对路径（配置文件里要写成完整路径，不能用这个变量）
BASE_DIR=/vol1/1000/APP/headplaneCN     # ← 可改

# 面板监听的地址与端口。绑具体 IP 比绑 0.0.0.0 安全：面板是管理台，
# 前面必须有一层 TLS 反代或防火墙，不要直接暴露到公网。
PANEL_BIND=192.168.1.10         # ← 必须改（NAS 的局域网 IP）
PANEL_PORT=4100                 # ← 可改（默认 4100）

TZ=Asia/Shanghai                # ← 可改
```

::: warning 绑定具体 IP 时，两个地方要跟着改
面板的 `HEADPLANE_SERVER__HOST` 和它自己的健康检查探针用的是同一个地址。compose 里两者都引用
`${PANEL_BIND}:${PANEL_PORT}`，所以改 `.env` 一处即可 —— 手工改 compose 时不要只改一处，否则
容器会一直显示 `unhealthy`（详见[常见问题](#_1-面板容器一直显示-unhealthy)）。
:::

### `docker-compose.yml`

路径：`/vol1/1000/APP/headplaneCN/docker-compose.yml`

```yaml
services:
  # ---------------------------------------------------------------------------
  # Headscale 服务端（取代 fnOS 应用中心的原生安装）
  # ---------------------------------------------------------------------------
  headscale:
    # 国内拉不动时用代理前缀，例如：
    #   v6.gh-proxy.org/docker/ghcr.io/juanfont/headscale:${HEADSCALE_VERSION}
    # 调试用（带 shell，二进制在 /ko-app/headscale）：
    #   v6.gh-proxy.org/docker/ghcr.io/juanfont/headscale:${HEADSCALE_VERSION}-debug
    image: headscale/headscale:${HEADSCALE_VERSION:?请在 .env 中设置 HEADSCALE_VERSION}
    container_name: headscale # ← 别动（面板按这个名字/标签找容器）
    restart: unless-stopped # ← 别动

    network_mode: host # ← 别动（host 模式不能再写 ports / extra_hosts）

    read_only: true # ← 别动（官方推荐：可写的地方靠挂载和 tmpfs）
    tmpfs:
      - /var/run/headscale
      - /tmp

    user: "${HEADSCALE_UID:-0}:${HEADSCALE_GID:-0}" # ← 必须改（按数据目录属主，见 .env）

    labels:
      me.tale.headplane.target: "headscale" # ← 别动（面板的 Docker 集成靠它找到本容器）

    volumes:
      # 配置文件：面板写的是同一个宿主文件，本容器只读挂载
      - "${BASE_DIR}/headscale/config.yaml:/etc/headscale/config.yaml:ro" # ← 可改路径
      # 【关键】数据目录以同一个绝对路径挂进来 → config.yaml 里的绝对路径不用改
      - "${BASE_DIR}/headscale:${BASE_DIR}/headscale" # ← 可改路径

    command: serve # ← 别动

    healthcheck:
      test: ["CMD", "headscale", "health"] # ← 别动
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s

    # 容器日志取代原来的 headscale.log（原生那个文件能长到几百 MB 且不轮转）
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

  # ---------------------------------------------------------------------------
  # HeadplaneCN 面板
  # ---------------------------------------------------------------------------
  headplaneCN:
    # 国内可换加速前缀：v6.gh-proxy.org/docker/ghcr.io/cgg888/headplanecn:${HEADPLANE_VERSION}
    image: ghcr.io/cgg888/headplanecn:${HEADPLANE_VERSION:-0.22.22} # ← 可改版本
    container_name: headplaneCN # ← 别动
    restart: unless-stopped # ← 别动

    network_mode: host # ← 别动（面板才能用 127.0.0.1:8480 访问 Headscale 容器）

    pid: host # ← 可改（只有 Agent 要看宿主机进程；Docker 集成不需要）

    depends_on:
      - headscale # ← 别动（只保证启动顺序，面板自己会重试）

    volumes:
      # 面板自己的配置与数据
      - "${BASE_DIR}/config.yaml:/etc/headplane/config.yaml:ro" # ← 可改路径
      - "${BASE_DIR}/data:/var/lib/headplane" # ← 可改路径

      # 面板要能改写 Headscale 配置与 DERP 地图
      - "${BASE_DIR}/headscale/config.yaml:/etc/headscale/config.yaml" # ← 可改路径
      - "${BASE_DIR}/headscale/derp-maps:${BASE_DIR}/headscale/derp-maps" # ← 可改路径
      # 数据目录按同一绝对路径挂进来（只读）：配置检查与快照能看到数据库、私钥
      - "${BASE_DIR}/headscale:${BASE_DIR}/headscale:ro" # ← 可改路径

      # 【可选】启用 dns.extra_records_path 时，把该文件也挂进来（需要可写）：
      # - "${BASE_DIR}/headscale/extra-records.json:${BASE_DIR}/headscale/extra-records.json"

      # Docker 集成靠它重启 headscale 容器。
      # ⚠️ 这是近乎 root 的权限：:ro 只保护 socket 文件本身，挡不住 API 调用，
      #    所以别指望用 :ro 降低风险，请把面板的访问控制做好。
      - "/var/run/docker.sock:/var/run/docker.sock" # ← 别动

    environment:
      - "TZ=${TZ}" # ← 可改
      # 面板监听地址（也用于它自己的健康检查探针）
      - "HEADPLANE_SERVER__HOST=${PANEL_BIND}" # ← 必须改（NAS 局域网 IP，见 .env）
      - "HEADPLANE_SERVER__PORT=${PANEL_PORT}" # ← 可改（默认 4100）
      # 容器内 Headscale 生效配置的路径，与挂载点逐字一致
      - "HEADPLANE_HEADSCALE__CONFIG_PATH=/etc/headscale/config.yaml" # ← 别动

      # 集成方式：重启 Headscale 容器（而不是发 SIGHUP）
      - "HEADPLANE_INTEGRATION__DOCKER__ENABLED=true" # ← 别动
      - "HEADPLANE_INTEGRATION__DOCKER__CONTAINER_NAME=headscale" # ← 别动
      - "HEADPLANE_INTEGRATION__PROC__ENABLED=false" # ← 别动

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

| 挂载                                                       | 作用                                                                                 |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `config.yaml:/etc/headscale/config.yaml:ro`（headscale）   | Headscale 的生效配置，只读挂载；面板改的是同一个宿主文件                             |
| `headscale:${BASE_DIR}/headscale`（headscale）             | 数据库、私钥、socket、地图的读写位置，**路径与宿主机逐字一致**                       |
| `config.yaml:/etc/headplane/config.yaml:ro`（面板）        | 面板自己的配置，只读即可                                                             |
| `data:/var/lib/headplane`（面板）                          | 面板的持久化数据（会话、内部库、快照、Agent 状态）                                   |
| `headscale/config.yaml:/etc/headscale/config.yaml`（面板） | 面板在这里读写 Headscale 配置（系统页、DERP 页、ACL 等）                             |
| `headscale/derp-maps:${BASE_DIR}/.../derp-maps`（面板）    | DERP 地图的查看 / 编辑 / 保存；Headscale 读的是同一个文件                            |
| `headscale:${BASE_DIR}/headscale:ro`（面板）               | 同一绝对路径 + 只读：配置检查与快照能看到 `db.sqlite`、私钥等                        |
| `/var/run/docker.sock`（面板）                             | Docker 集成用它重启 Headscale 容器；`:ro` 并不能限制 socket 通信，请按 root 权限对待 |

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
| `udp/3478`  | 内嵌 DERP 的 STUN          | 在路由器 / 防火墙上把 `udp/3478` 直接放开到这台 NAS，**不能**走 HTTP 反代 |
| `tcp/4100`  | HeadplaneCN                | 反代回源到 `${PANEL_BIND}:${PANEL_PORT}`（默认 `4100`，改了要同步改回源） |

> 这里用 `8480 / 8481`（很多 fnOS 原生安装的历史端口）；官方默认是 `8080 / 9090`。用哪个都行，
> 只要**全程一致**：`config.yaml` 的 `listen_addr`、反代回源、健康检查。

::: warning `tcp/4100` 是管理台
它暴露面最大。只在本机做反代时把 `PANEL_BIND` 收成 `127.0.0.1` 更安全；无论哪种情况，都不要把
`tcp/4100` 直接暴露到公网。
:::

## 七、启动与自检

```bash
cd /vol1/1000/APP/headplaneCN
docker compose config --quiet        # 语法与变量都齐了吗（没有输出就是没问题）
docker compose up -d
docker compose ps                    # 两个服务都应是 Up (healthy)

docker compose logs headscale | tail -n 50
# 期望：version=v0.29.4、DB 打开在 …/headscale/db.sqlite、
#       stun server started、listening and serving HTTP on 0.0.0.0:8480
curl -s http://127.0.0.1:8480/health              # {"status":"pass"}
docker compose exec headscale headscale nodes list | head
docker compose exec headscale headscale users list

docker compose logs headplaneCN | tail -n 50
# 期望：Connected to Headscale 0.29.4、
#       Found a valid Headscale configuration file at /etc/headscale/config.yaml、
#       Using Docker integration、Listening on http://192.168.1.10:4100
curl -s http://192.168.1.10:4100/admin/healthz    # {"status":"OK"}
```

浏览器打开 `http://192.168.1.10:4100/admin`，用第二节的 API Key 登录。进 **设置 → 系统**：集成应
显示 **Docker**，保存配置后 Headscale 容器会重启（日志里能看到 `Found container` / 容器重启）。

::: tip 下一步：发布到外网
容器本身只在局域网里监听，对外要靠一层反向代理（TLS 在那一层终止），怎么填见
[Lucky 反向代理](/install/reverse-proxy-lucky)；域名、证书与端口规划见
[域名与访问方式](/install/domains)。记住两件事：反代要**原样透传路径**（`/key`、`/ts2021`、
`/api/v1/*`、`/health`），`udp/3478`（STUN）**不能**走 HTTP 反代，必须在路由器上单独转发。
:::

## 八、常见问题（症状 → 原因 → 解决）

### 1. 面板容器一直显示 `unhealthy`

**原因**：面板镜像自带的健康检查是 `/bin/hp_healthcheck`，它固定探 `127.0.0.1:<端口>`；而
`server.host` 绑的是**具体 IP**（例如 `192.168.1.10`），回环地址上并没有监听：

```text
Health check failed: Get "http://127.0.0.1:4100/admin/healthz": dial tcp 127.0.0.1:4100: connect: connection refused
```

**解决**：容器功能其实完全正常，只是健康状态一直红。按第六节 compose 里的写法换成探真实地址的探针
（用镜像里的 `/nodejs/bin/node`），改完 `docker compose up -d`（只会重建面板容器）。

### 2. 面板容器里没有 shell

**原因**：发布镜像默认是 distroless，没有 `sh`：`docker compose exec headplaneCN sh -c '...'` 会直接失败
（输出 `Headplane containers do not contain a shell by default.`）。
**解决**：要排查就用镜像里的 node：

```bash
docker compose exec headplaneCN /nodejs/bin/node -e "console.log(require('fs').readFileSync('/var/lib/headplane/derp-region-mirror.json','utf8').slice(0,200))"
```

或临时把 `image:` 换成 `:<版本>-shell` 调试标签来排查，查完换回正式版本。

### 3. 容器起不来，日志说配置无效

**原因**：最常见的是 `cookie_secret` 不是正好 32 字符，其次是 `config.yaml` 里的键名写错
（日志 `unknown key` / `cannot unmarshal`），或绝对路径写成了 `${BASE_DIR}/...`。
**解决**：

```bash
cd /vol1/1000/APP/headplaneCN
docker compose logs headscale | tail -n 30         # 看第一条错误
docker compose exec headscale headscale configtest # Headscale 侧：只校验，不启动
```

用 `openssl rand -base64 24` 重新生成 `cookie_secret`；路径逐字写成完整路径。

### 4. 保存 ACL 报 `403 Policy is not writable`

**原因**：Headscale 的 `policy.mode` 还是 `file`，策略 API 只读。
**解决**：按第三节改成 `database`，然后 `docker compose restart headscale`（或在面板里点「重新加载」）。

### 5. 客户端一直不上线

按可能性从高到低排查：

| 检查                    | 命令 / 位置                                                                 | 结论                                                       |
| ----------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `server_url` 有没有被改 | `docker compose exec headscale grep server_url /etc/headscale/config.yaml`  | 必须与迁移前逐字一致；改过就得把每个节点重新注册           |
| 域名与证书              | 外网机器上 `curl -sI https://ha.example.com:8443/health`                    | 证书必须受客户端信任、域名必须与 `server_url` 一致         |
| 反代是否透传长连接      | 反代里看是否 HTTP/2、是否关了缓冲、超时是否 ≥300 秒                         | `/ts2021` 被缓冲或降级会让节点连不上或频繁掉线             |
| noise 私钥是否在        | `docker compose exec headscale ls -l /vol1/1000/APP/headplaneCN/headscale/` | 私钥被重新生成时，已注册节点全部无法通信（必须从备份恢复） |
| 数据库是否在            | `docker compose exec headscale headscale nodes list`                        | 列表为空说明 `db.sqlite` 没放对或指向了别的路径            |
| 端口被原生进程占用      | `ss -lntup \| grep 8480`                                                    | 应用中心里的 headscale 还在跑 → 停掉它并关掉开机自启       |
| 服务本身是否活着        | `curl -s http://127.0.0.1:8480/health`、`docker compose logs headscale`     | 不是 `{"status":"pass"}` 就先看日志里的第一条错误          |

::: tip 一句话
客户端只认 `server_url` 和它背后的证书与链路；数据库和 noise 私钥是「它还是原来那个控制服务」的
凭据。这两样对了，客户端就不需要重新注册。
:::

### 6. 保存时出现 `Unexpected Server Error`

**原因**：反代改写了 `Host` 头，表单提交被跨站校验拦下；或反代剥掉了 `POST` 的 `Content-Type`。
**解决**：让反代**保留原始 Host**、不要改写请求头，并确认 `server.base_url` 就是浏览器地址
（不带 `/admin`）。填法见 [Lucky 反向代理](/install/reverse-proxy-lucky)。

### 7. DERP（中继）相关的问题

内嵌中继区域没人用、DERP 页「官方区域筛选」提示**无法读取** `.../derp-maps/...`、Headscale 启动报
`getting DERPMap: open .../derp-maps/xxx.yaml: no such file or directory`、`/derp` 流量不通 —— 这些都
不在本页，按同样格式写在 [DERP 与中继](/configuration/derp)。

### 8. 其它症状

保存报错、权限、界面缺项等其它问题见 [常见问题](/configuration/common-issues)。

## 九、验收清单

```bash
cd /vol1/1000/APP/headplaneCN

docker compose ps                                     # 两个服务都 Up (healthy)
docker compose logs headplaneCN | grep -i 'valid Headscale configuration'
docker compose logs headplaneCN | grep -i 'Using Docker integration'
docker compose logs headplaneCN | grep -i 'Listening on'
docker compose logs headscale | grep -i 'error' | tail
docker compose exec headscale headscale health
curl -s http://127.0.0.1:8480/health                  # {"status":"pass"}
curl -s http://192.168.1.10:4100/admin/healthz        # {"status":"OK"}
```

- [ ] 两个容器都在跑，`docker compose restart` 后自动恢复、`up -d` 幂等
- [ ] 面板 **设置 → 系统** 集成显示 **Docker**，保存配置能重启 Headscale 容器
- [ ] **已注册客户端不重新注册即可上线**（`tailscale status` 直接显示已连接）
- [ ] `设置 → 系统 → 配置检查`整体为绿（只读数据目录的「无法验证写入权限」是预期）
- [ ] `docker compose exec headscale headscale users list` 能看到原有用户与节点
- [ ] `udp/3478` 从公网可达（`tailscale netcheck` 里 STUN 不是「不可用」）
- [ ] 通过反代能打开 `https://panel.example.com:8443/admin`

## 十、命令速查

```bash
# ---- 现场核对 ----
cd /vol1/1000/APP/headplaneCN
docker compose ps
docker compose logs headscale | tail -n 30
docker compose logs headplaneCN | tail -n 30
curl -s http://127.0.0.1:8480/health                  # {"status":"pass"}
ss -lntup | grep -E '4100|8480|3478'

# ---- 容器里的 Headscale CLI ----
docker compose exec headscale headscale version
docker compose exec headscale headscale users list
docker compose exec headscale headscale nodes list
docker compose exec headscale headscale apikeys list
docker compose exec headscale headscale apikeys create --expiration 90d
docker compose exec headscale headscale apikeys expire --prefix <前缀>

# ---- 改完配置之后 ----
docker compose exec headscale headscale configtest    # 只校验，不启动
docker compose up -d                                  # 起 / 更新
docker compose restart headscale                      # 等价于面板里点「重新加载」
```

## 十一、升级、回滚与卸载

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
- **卸载**：`docker compose down` 只是停止并删除容器，数据都还在；要连数据一起清理，**先按上面的命令备份** `headscale/`（重点是 `db.sqlite`、`noise_private.key`、`derp_server_private_key`）与面板的 `data/`、`config.yaml`，再删目录。删掉 `db.sqlite` 或 noise 私钥，所有已注册节点都得重新注册。

## 十二、可选：用安装脚本一次生成

上面的 `.env`、compose 文件、两份配置，都可以交给脚本一次问清楚再生成：
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
  时间戳备份，脚本里没有任何删除数据的动作。迁移相关的细节见[迁移与回退](/install/migration)。
- 写完之后会问是否立刻 `docker compose up -d`，并顺手跑一遍 `docker compose ps`、
  Headscale 日志、`headscale health` 与面板健康检查的验收命令。
