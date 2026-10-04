---
title: fnOS（飞牛）
description: 在飞牛 fnOS 上用第三方应用源安装 headscale，再用 Docker 部署 Headplane。
outline: [2, 3]
---

# fnOS（飞牛）部署指南

这份指南按「**headscale 用第三方应用源的 fpk 包原生运行 + Headplane 用 Docker 运行 + Lucky 反向代理**」
这套部署方式编写，包含两份可直接使用的设置文件（Headplane 的 `config.yaml` 与
`docker-compose.yml`），以及全部常见问题的排查方法。

::: tip 环境对应关系

- Headscale：fnOS 应用中心（**第三方源**）安装的 fpk 包，**原生进程**（不是 Docker 容器）
- Headplane：Docker 容器，本指南用 host 网络、监听 `4100`
- 反向代理：Lucky（可以和 Headplane 不在同一台机器上）
  :::

::: warning 安装 Headscale 必须先添加第三方应用源

fnOS **官方应用中心不提供 headscale**。请先在「飞牛应用中心 → 设置 → 第三方市场 → 添加源」
里添加第三方源 [github.com/conversun/fnos-store](https://github.com/conversun/fnos-store)，
刷新后安装 `headscale`（它的依赖会一并装上）。
:::

## 先决条件

- fnOS 已安装并运行 headscale（来自上方的第三方源 `https://github.com/conversun/fnos-store`，
  官方应用中心没有这个包），版本建议 **0.29.2 或更高**（0.29.0 beta ~ 0.29.1 的浏览器 SSH
  有 WebSocket 回归）
- 已安装 Docker / Docker Compose（fnOS 自带）
- Headplane 镜像：`ghcr.io/cgg888/headplane`（本仓库），国内可用加速前缀，例如
  `v6.gh-proxy.org/docker/ghcr.io/cgg888/headplane:latest`
- 建议版本 **0.16.0 或更高**：设置页已是「分段式 Tab + 展开/折叠卡片」，并包含 DERP 面板、
  操作审计、配置快照与配置检查；**0.8.4 是反代环境的最低要求**（它修复了「保存/切换时报
  `Unexpected Server Error`」这一关键问题，见文末常见问题）
- 需要进容器排查时，用带 shell 的调试标签 `:<版本>-shell`（官方镜像是 distroless，见第七节）

## 一、先认清三个路径（最容易搞混）

| 路径                          | 角色                | 里面有什么                                                                                                          |
| ----------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `/vol1/@appcenter/headscale/` | **程序目录**        | `headscale`（可执行文件/CLI）、`bin/headscale-server`（启动脚本）、`config/config.yaml`（**种子模板**）、`ui/`      |
| `/vol1/@appdata/headscale/`   | **配置 + 数据目录** | `config.yaml`（**真正生效**）、`db.sqlite`、`noise_private.key`、`headscale.sock`、`headscale.pid`、`headscale.log` |
| `/vol1/1000/APP/headplane/`   | **Headplane 目录**  | `docker-compose.yml`、`config.yaml`、`data/`（本指南使用这个目录）                                                  |

**为什么生效的是 `@appdata` 那份？** fnOS 的启动脚本 `@appcenter/headscale/bin/headscale-server`
的关键逻辑就是「种子模板只在第一次落地，之后永远读 `@appdata`」：

```sh
APP_DIR="${TRIM_APPDEST}"        # /vol1/@appcenter/headscale
APP_DATA_DIR=$1                  # /vol1/@appdata/headscale（由 cmd/service-setup 传入）
CONFIG_FILE="$APP_DATA_DIR/config.yaml"

# 只在 @appdata 那份不存在时，才把种子模板里的 __APP_DATA_DIR__ 替换后写过去
if [ ! -f "$CONFIG_FILE" ]; then
    sed "s|__APP_DATA_DIR__|${APP_DATA_DIR}|g" "$APP_DIR/config/config.yaml" > "$CONFIG_FILE"
fi

exec ./headscale serve --config "$CONFIG_FILE"
```

所以：

- ✅ 要改配置 → 改 `/vol1/@appdata/headscale/config.yaml`，改完**重启 fnOS 里的 headscale 应用**
- ❌ 改 `@appcenter/headscale/config/config.yaml` **没有效果**（只是首次安装的种子，升级还会被覆盖）
- ⚠️ 二进制与 CLI 在 `@appcenter/headscale/`，**数据与配置在 `@appdata/headscale/`**：
  在 `@appdata/headscale` 下执行 `./headscale` 会报 `No such file or directory`

现场核对（一条命令即可确认）：

```bash
ps -ef | grep '[h]eadscale serve'
# 期望：... ./headscale serve --config /vol1/@appdata/headscale/config.yaml
```

## 二、确认 headscale 正在运行

```bash
curl -s http://127.0.0.1:8480/health          # 期望 {"status":"pass"}
ss -lntp | grep -E '8480|8481|50443'          # 8480 是控制端口，8481 是 metrics
```

## 三、生成 Headscale API Key（Headplane 服务端用）

```bash
cd /vol1/@appcenter/headscale
# 若提示权限不足，请以 root 执行（fnOS 的应用目录属于 root）
./headscale --config /vol1/@appdata/headscale/config.yaml apikeys create --expiration 3650d
```

- 输出形如 `hskey-api-xxxxxxxx...`，**只显示一次**，请立刻记录；
- `3650d` ≈ 10 年（Headscale 不支持"永不过期"，传 `0` 会得到立即过期的废 key）；
- 旧 key 泄漏后用 `apikeys list` 查前缀、`apikeys expire --prefix <前缀>` 撤销；
- 这把 key 要写进 Headplane 的 `headscale.api_key`，是**服务端**凭据：Agent 同步、OIDC 会话、
  代理认证都由它发起。它与你在网页登录框里输入的那把是两件事 —— **Agent / OIDC 用的是配置
  文件里的这把**，写错（或只写了列表里看到的前缀）就会 401。

## 四、按需要调整 headscale 配置

编辑**生效的那份**：`/vol1/@appdata/headscale/config.yaml`

```yaml
# 客户端实际连接的地址（Lucky 对外暴露的地址或局域网地址）
server_url: https://headscale.example.com

listen_addr: 0.0.0.0:8480

# 让 Headplane 能在网页里保存 ACL（改完必须重启 headscale 才生效）
policy:
  mode: database
  path: ""

# 可选但推荐：DNS 记录改走文件，Headplane 改完无需重启 headscale
dns:
  magic_dns: true
  base_domain: headscale.internal
  override_local_dns: false
  nameservers:
    global: [1.1.1.1, 1.0.0.1]
    split: {}
  search_domains: []
  extra_records_path: /vol1/@appdata/headscale/extra-records.json

unix_socket: /vol1/@appdata/headscale/headscale.sock
unix_socket_permission: "0770"
```

改完重启：

```bash
# 在 fnOS 应用中心把 headscale 停止 → 启动
# 若启用 extra_records_path：先创建文件，否则 headscale 启动会报错
printf '[]\n' > /vol1/@appdata/headscale/extra-records.json
```

::: danger 单独使用 `headscale.dns_records_path` 会让 Headplane 退出
Headplane 只有在 Headscale 配置里存在 `dns.extra_records_path` 时才允许你指定
`headscale.dns_records_path`。只配了后者、没配前者，启动日志会打印
`Using separate DNS config file but dns.extra_records_path is not set in Headscale config` 并直接退出。
两处要么都配，要么只让 Headplane 从 Headscale 配置自动读取。
:::

::: warning 关于 `policy.mode`

- `file`（默认）：ACL 由文件提供，Headscale 的策略 API **只读** → Headplane 保存时报
  `403 Policy is not writable`（Headplane 0.8.5 起会给出中文说明）
- `database`：策略存进 Headscale 数据库，**Web 界面可以编辑** —— 想用网页改 ACL 就必须选它
- 切换不会影响现有连通性：原文件模式下 `policy.path: ""` 相当于没有策略，数据库初始也是空策略（默认允许全部）
  :::

### 可选：自建内嵌 DERP 中继

Headscale 自带 Tailscale 的公开 DERP 地图；如果想让中继流量走自己的服务器，在**同一份配置**里启用内嵌服务器：

```yaml
# 中继和 Headscale 共用这个 HTTPS 端点：端口由 server_url 决定，必须是 https
server_url: https://headscale.example.com:8443

derp:
  server:
    enabled: true
    region_id: 999
    region_code: headscale
    region_name: "Headscale Embedded DERP"
    stun_listen_addr: "0.0.0.0:3478"
    private_key_path: /vol1/@appdata/headscale/derp_server_private.key
  urls: [] # 只用自建中继，不再加载 Tailscale 的公开 DERP 地图
```

要点（与 Headplane 的 DERP 页提示一致）：

- `server_url` **必须是 https**：DERP 基于 TLS。
- **中继端口就是 `server_url` 里的端口**：写 `https://headscale.example.com:8443`，客户端就连 8443；
  不写端口就是 443（Tailscale 官方推荐）。
- 客户端需要 **udp/3478 直达 Headscale**（STUN），它不能经过 HTTP 代理。
- `private_key_path` 指向的文件**无需预先存在**：缺失时 Headscale 会自动生成，只要所在目录对
  Headscale 可写、已存在的文件可读。
- 反向代理（Lucky / nginx）必须**转发 `/derp` 路径**、放行 DERP 的 **HTTP Upgrade** 且**不要缓冲**，
  并对客户端提供有效 HTTPS。
- `derp.urls: []` 之后自建中继是**唯一**中继：它不可达时客户端之间无法通过 DERP 互联，
  建议先用一台客户端 `tailscale debug derp-map` 确认区域已出现再清空公开地图。

## 五、准备 Headplane 目录

```bash
mkdir -p /vol1/1000/APP/headplane/data
cd /vol1/1000/APP/headplane
openssl rand -base64 24        # 生成 32 字符 cookie_secret，记下来
```

## 六、设置文件 ①：Headplane 的 `config.yaml`

路径：`/vol1/1000/APP/headplane/config.yaml`

```yaml
server:
  # 容器内监听地址/端口，不要改（对外端口由 compose 的 host 网络 + 环境变量控制）
  host: "0.0.0.0"
  port: 3000

  # 【必改】浏览器实际访问的地址：协议 + 域名 + 端口，绝对不能带 /admin
  base_url: "https://headplane.example.com"

  # 【必改】必须正好 32 个字符：openssl rand -base64 24
  #   多一个或少一个字符都会被配置校验拒绝，容器启动即失败
  cookie_secret: "请替换为你的32位随机串"

  # 走 HTTPS 反代 → true；纯 HTTP 访问 → false
  cookie_secure: true
  cookie_max_age: 86400

  # Headplane 自身数据目录（已在 compose 中持久化到 ./data）
  # 会话、内部数据库、agent 状态，以及「配置快照」都存在这里
  data_path: "/var/lib/headplane"

headscale:
  # host 网络下，容器内的 127.0.0.1 就是宿主机；
  # 这样 headscale 可以只监听 127.0.0.1，不必暴露到局域网
  url: "http://127.0.0.1:8480"

  # 浏览器里展示、以及浏览器 SSH 使用的 Headscale 地址；不填则回退上面的 url
  public_url: "https://headscale.example.com"

  # 【必改】第三节生成的 API Key —— 完整的 key，不是列表里显示的前缀
  #   Agent 与 OIDC 会话用的就是这把（不是你登录 Headplane 时输入的那把）
  api_key: "hskey-api-..."

  # 【必填】容器内 headscale 生效配置的路径（与 compose 挂载点一致）
  #   这是 DNS / 设置 两个页面能否出现的唯一条件
  config_path: "/etc/headscale/config.yaml"

  # 可选：与 headscale 的 dns.extra_records_path 指向同一个文件（改 DNS 记录无需重启）
  #   注意：Headscale 配置里必须有 dns.extra_records_path，否则 Headplane 会直接退出
  # dns_records_path: "/etc/headscale/extra-records.json"

integration:
  # headscale 是 fpk 原生进程 → 用"原生进程"集成：
  # 保存配置 / 系统页的重载按钮会向 headscale serve 发送 SIGHUP
  # 前置：容器必须 pid: host（见 compose）
  proc:
    enabled: true

  # Headplane Agent：同步节点版本/OS 等详情，并提供各机器所用的 DERP 区域与延迟
  # 要求：Headscale ≥ 0.28（0.29.x 满足）+ 有效的 headscale.api_key
  # agent 状态持久化在 /var/lib/headplane/agent
  agent:
    enabled: true
    # host_name: "headplane-agent"      # 同时会作为 tag:headplane-agent 使用

# ---- 以下都是可选项，按需开启 ----

# 单点登录（浏览器 SSH 必须先启用 OIDC；与 API Key 登录可共存）
# oidc:
#   issuer: "https://你的IdP/realms/xxx"
#   client_id: "headplane"
#   client_secret: "******"
#   # 在 IdP 里注册的回调地址：
#   #   https://headplane.example.com/admin/oidc/callback

# 代理认证（仅当 Lucky 已经做了认证时再开，否则等于把后台敞开）
# proxy_auth:
#   enabled: true
#   user_header: "Remote-User"
#   trusted_proxy_cidrs: ["127.0.0.1/32", "::1/128"]
```

::: danger `cookie_secret` 必须正好 32 个字符
配置校验写死了「长度必须等于 32」；不是 32 个字符（多了或少了）时容器会带着
`The configuration is missing required fields or has invalid values` 退出。
`openssl rand -base64 24` 生成的正好是 32 个字符，别自己手写、也别截断。
:::

## 七、设置文件 ②：`docker-compose.yml`

路径：`/vol1/1000/APP/headplane/docker-compose.yml`

```yaml
services:
  headplane:
    # 国内可用加速前缀，例如 v6.gh-proxy.org/docker/ghcr.io/cgg888/headplane:latest
    # 需要进容器排查时，临时换成带 shell 的调试标签：ghcr.io/cgg888/headplane:0.16.0-shell
    image: ghcr.io/cgg888/headplane:latest
    container_name: headplane
    restart: unless-stopped

    # host 网络：容器内 127.0.0.1 == 宿主机，可直接访问 fpk 安装的 headscale
    # host 模式下不能再写 ports / extra_hosts
    network_mode: host

    # 共享宿主机 PID 命名空间：integration.proc 需要读 /proc 找到 headscale 进程
    pid: host

    volumes:
      # Headplane 主配置（只读即可）
      - "/vol1/1000/APP/headplane/config.yaml:/etc/headplane/config.yaml:ro"

      # Headplane 持久化数据（会话、内部数据库、agent 状态、配置快照）
      - "/vol1/1000/APP/headplane/data:/var/lib/headplane"

      # 【关键】headscale 的生效配置 —— 必须读写，不能 :ro
      # 有它才会出现 DNS / 设置 入口，并且能保存
      - "/vol1/@appdata/headscale/config.yaml:/etc/headscale/config.yaml"

      # 【推荐】只读挂载 headscale 的数据目录，且容器内路径与宿主机完全一致：
      # 配置检查与配置快照靠它看到 db.sqlite、noise_private.key、策略文件等
      # 只读是刻意的：Headplane 的权限不是 Headscale 的权限，
      # 因此「数据库目录无法验证写入权限」是预期结果，不是故障（见第十二节）
      - "/vol1/@appdata/headscale:/vol1/@appdata/headscale:ro"

      # 【可选】DNS 记录文件（配合 headscale 的 dns.extra_records_path）
      # 需先执行：printf '[]\n' > /vol1/@appdata/headscale/extra-records.json
      # - "/vol1/@appdata/headscale/extra-records.json:/etc/headscale/extra-records.json"

      # 【不需要】docker.sock：headscale 是原生进程而非容器，docker 集成用不上；
      # 而且挂载它等于把宿主机 root 权限交给容器
      # - "/var/run/docker.sock:/var/run/docker.sock:ro"

    environment:
      - "TZ=Asia/Shanghai"
      # 监听地址用本机局域网 IP（Lucky 在另一台机器也能访问）；只想本机访问就改 127.0.0.1
      - "HEADPLANE_SERVER__HOST=192.168.1.10"
      - "HEADPLANE_SERVER__PORT=4100"

      # 与上面挂载点一致的容器内路径（DNS/设置入口出现的条件）
      - "HEADPLANE_HEADSCALE__CONFIG_PATH=/etc/headscale/config.yaml"
      # 原生进程集成（保存后向 headscale 发送 SIGHUP）
      - "HEADPLANE_INTEGRATION__PROC__ENABLED=true"
      # 同步节点详情（版本/OS/DERP 中继列与机器详情中继面板）的基础
      - "HEADPLANE_INTEGRATION__AGENT__ENABLED=true"
      # 与 extra-records 挂载配套（Headscale 侧必须有 dns.extra_records_path）
      # - "HEADPLANE_HEADSCALE__DNS_RECORDS_PATH=/etc/headscale/extra-records.json"

      # 排查问题时再开
      # - "HEADPLANE_DEBUG_LOG=true"

    # 仅在 agent 启动报 TUN / 权限错误时才需要放开
    # cap_add:
    #   - "NET_ADMIN"
    # devices:
    #   - "/dev/net/tun:/dev/net/tun"

    healthcheck:
      test: ["CMD", "/bin/hp_healthcheck"]
      interval: 30s
      timeout: 5s
      start_period: 10s
      retries: 3

    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

::: info 为什么用环境变量写这三项
`HEADPLANE_*` 环境变量会覆盖 `config.yaml`，所以集成开关可以集中在 compose 里；
`config.yaml` 里同时写也不会冲突（值相同）。数组型配置项（如 `allowed_action_origins`）
**不支持**环境变量，只能写在 `config.yaml` 里。
:::

::: warning 官方镜像是 distroless，没有 shell
`docker compose exec headplane ls ...` 会失败：镜像里的 `/bin/sh` 只是一个打印提示的假 shell
（`Headplane containers do not contain a shell by default.`，退出码 127）。
要进容器排查，请把 `image:` 临时换成调试标签 `ghcr.io/cgg888/headplane:0.16.0-shell`
（`:<版本>-shell` 是官方发布的带 shell/curl 的调试镜像），排查完再换回 `latest`；
宿主机侧的检查（`ls`、`ss`、`curl`）本来就不需要进容器。
:::

## 八、启动与自检

```bash
cd /vol1/1000/APP/headplane
docker compose up -d

# 1) 容器与健康状态
docker compose ps
# 2) 关键日志：出现这行说明 DNS/设置 判定通过
docker compose logs headplane | grep -i 'Headscale configuration'
#    期望：Found a valid Headscale configuration file at /etc/headscale/config.yaml
#    只读挂载会打印：Headscale configuration file at /etc/headscale/config.yaml is not writable
# 3) 进程集成是否找到 headscale
docker compose logs headplane | grep -i 'Found headscale serve'
#    期望：Found headscale serve (PID ...)
# 4) agent 是否连上 Tailnet
docker compose logs headplane | grep -iE 'Agent|Tailnet'
#    期望：Connecting to Tailnet at http://127.0.0.1:8480 as headplane-agent
# 5) 本地访问
curl -I http://192.168.1.10:4100/admin
```

浏览器打开 `http://192.168.1.10:4100/admin`，用第三节的 API Key 登录。
登录后导航栏应包含：**机器 / 用户 / 访问控制 / DNS / 设置**。

## 九、Lucky 反向代理要点

这里有**两条**反代链路，要求完全不同，别混在一起：

| 链路          | 前端                                                          | 后端                       | 关注点                                            |
| ------------- | ------------------------------------------------------------- | -------------------------- | ------------------------------------------------- |
| **Headplane** | `https://headplane.example.com`                               | `http://192.168.1.10:4100` | `base_url`、跨站校验、WebSocket（浏览器 SSH）     |
| **Headscale** | `https://headscale.example.com`（自建 DERP 时通常带 `:8443`） | `http://192.168.1.10:8480` | **原样透传路径**、放行 HTTP Upgrade、关闭响应缓冲 |

### 9.1 Headplane 的反代

| 项目                        | 要求                                                                                      |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| **保留原始 Host**           | 建议让后端看到的 `Host` 就是浏览器访问的域名；若 Lucky 改写成内网 IP，就会出现下面问题 1  |
| **`server.base_url`**       | 必须与浏览器地址完全一致（协议 + 域名 + 端口），否则保存类操作会被判定为跨站              |
| **WebSocket**（浏览器 SSH） | 转发 `Upgrade: websocket`、`Connection: Upgrade`，`Sec-WebSocket-Protocol` 原样透传       |
| **CORS**（浏览器 SSH）      | Headplane 与 Headscale 不同源时，Headscale 侧需返回 `Access-Control-Allow-Origin`（见下） |

Headscale 侧（不同源时）需要补充的响应头：

```
Access-Control-Allow-Origin:  https://headplane.example.com
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, Upgrade, Sec-WebSocket-Protocol
```

### 9.2 Headscale 的反代（启用自建内嵌 DERP 时必需）

内嵌 DERP 与 Headscale 的控制服务**共用同一个 HTTPS 端点**，走的是 `/derp` 路径上的**长连接升级**。所以这一步的目标**不是"新增一条 `/derp` 规则"**，而是**别把路径吃掉**：

1. **前端**：`headscale.example.com`，监听你实际对外的端口（如 8443），挂上证书
2. **后端**：`http://192.168.1.10:8480`
   - ⚠️ 只填 `主机:端口`，**不要**在后面补 `/` 或任何路径
3. **匹配路径 / 子规则**：**留空**，或 `/*`
   - ❌ 不要只填 `/api`、`/ts2021`、`/health` —— 这正是"只转发了 API 和控制路径"的典型症状，`/derp` 会 404
4. **路径替换 / URL 重写 / 前缀重写**：全部**关闭**（一旦重写，`/derp` 会被改写或去掉）
5. **WebSocket / Upgrade**：有开关就打开；Lucky 一般会自动透传 `Connection: Upgrade`
6. **超时与缓冲**：读/写超时调大到 **300 秒以上**，并**关闭响应缓冲/压缩改写**（DERP 是长连接，缓冲会把它切断）
7. **Host 头**：无所谓 —— Headscale 不做来源校验（这点和 Headplane 相反，只有 Headplane 需要 `base_url` 正确）
8. 若这条规则还兼着代理别的应用，用**子规则按域名/路径分流**，但必须保证 `/derp` 落在 Headscale 这一支

::: tip 一句话记法
Headscale 这条反代 = **透明管道**：不改路径、不缓冲、放行长连接。
:::

### 9.3 STUN 的 UDP 3478 必须单独转发

HTTP 反向代理**转发不了 UDP**。DERP map 里公告的 STUN 端口是 `udp/3478`，客户端会往 `headscale.example.com:3478/udp` 发包，所以要在 **Lucky 所在机器（或路由器）**上做端口转发：

```
udp/3478  →  192.168.1.10:3478/udp        # 指向运行 headscale 的那台 fnOS
```

（若公网入口在路由器上，则：公网 `udp/3478` → fnOS `udp/3478`。）

### 9.4 验证（三招，按顺序做）

```bash
# ① 直连 Headscale：确认 /derp 路由存在
#    预期是"需要升级协议"类的 4xx（例如 400/426），**不是 404**
curl -si http://127.0.0.1:8480/derp | head -3

# ② 经反代：状态码应与 ① 一致
#    若这里 404 而 ① 正常 → 就是路径没被转发（回看 9.2 的第 3、4 步）
curl -si https://headscale.example.com:8443/derp | head -3

# ③ 客户端侧（决定性证据，在任意一台装了 Tailscale 的机器上执行）
tailscale debug derp-map | grep -A 12 -i <你的 region_code>
tailscale debug derp <你的 region_code>
```

- `derp-map` 里应能看到你的区域，且 `hostname:port` 与 `server_url` 一致；
- `tailscale debug derp` 能连通，说明路径、Upgrade、证书都对了。

### 9.5 常见坑

| 症状                              | 原因                                     | 处理                                                                          |
| --------------------------------- | ---------------------------------------- | ----------------------------------------------------------------------------- |
| 经反代 `/derp` 返回 404，直连正常 | 只转发了 `/api`、`/ts2021` 等白名单路径  | 匹配路径改留空或 `/*`（9.2 第 3 步）                                          |
| `/derp` 路径被改写或去掉          | 开启了"URL 替换/前缀重写"                | 关闭路径重写（9.2 第 4 步）                                                   |
| DERP 偶发失败、延迟高             | 反代开启了缓冲，或超时太短，升级连接被断 | 关闭缓冲、超时 ≥300 秒（9.2 第 6 步）                                         |
| 客户端 map 里地址/端口不对        | `server_url` 与实际对外端口不一致        | 把 `server_url` 写成带端口的完整地址，如 `https://headscale.example.com:8443` |
| STUN 一直不通                     | 忘了转发 `udp/3478`                      | 做 UDP 端口转发（9.3）                                                        |
| 内嵌区域已在 map 里但没人用       | 端口 / 防火墙 / 证书任一环节不通         | 按 9.4 三招排查；必要时先保留 Tailscale 公共 DERP 兜底                        |

## 十、界面现在提供什么（对照截图）

设置区已经是统一外壳：**分段式（pill）Tab 导航 + 展开/折叠卡片**，卡片带图标与状态徽标
（OIDC 是否配置、策略模式、可信代理数量、内嵌中继状态、密钥数量、Agent 同步、快照体积、
检查结果），保存按钮统一右对齐；窄屏下 Tab 可横向滚动。各页面：

| 页面                  | 内容                                                                                                                                                                                                                                                 |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/settings/headscale` | OIDC 全量配置、可信代理、策略模式（file/database）、节点有效期 / 临时节点回收 / 日志级别与格式 / Taildrop / 自动更新 / logtail / 更新检查，以及 **DERP**（自定义 map、内嵌服务器预设、区域名称映射、连通性提示、由 `server_url` 推导的公开中继端口） |
| `/settings/system`    | Headscale 版本与更新提示、诊断（可达性、API Key、版本、策略模式、OIDC、可信代理、配置可读性、集成）、**配置检查**（见下），以及由进程集成驱动的「重新加载配置 / 重启 Headscale」按钮                                                                 |
| `/settings/api-keys`  | 创建、查看与**使 Headscale API Key 过期**                                                                                                                                                                                                            |
| `/settings/audit`     | 操作审计：谁在什么时候改了什么                                                                                                                                                                                                                       |
| `/settings/snapshots` | 写入 Headscale 配置前自动留一份快照（`config.yaml`，文件模式下还有策略文件），支持下载与一键恢复；**不备份数据库**                                                                                                                                   |
| `/settings/agent`     | Agent 状态、上次同步时间与节点数、立即同步、批准待处理注册；api_key 被拒时直接提示是配置里的哪把 key 无效并给出跳转                                                                                                                                  |

配置检查（web 版 `configtest`）会逐项给出结论与修复入口：已从 Headscale 移除的 `oidc.*` 键、
被拒绝的可信代理范围（`0.0.0.0/0` 与 `::/0`）、TLS 证书/ACME 路径缺失、数据库目录缺失或不可写、
策略文件缺失/为空、`dns.extra_records` 与 `dns.extra_records_path` 冲突、OIDC 一致性
（有 issuer 没 client_id、PKCE 方式非法、同时写了 secret 和 secret 文件）、noise 私钥缺失。
容器看不到的宿主路径会显示为「无法验证」而不是失败 —— 按第七节挂载数据目录后它们才会变成真检查。

## 十一、功能开启清单

| 功能                   | 怎么开                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 中英繁切换             | 默认可用：登录后右上角**头像菜单**；登录页右上角地球按钮                                                            |
| 机器 / 用户管理        | 默认可用                                                                                                            |
| **ACL 编辑**           | headscale 配置 `policy.mode: database` 后**重启 headscale 应用**                                                    |
| **DNS / 设置可编辑**   | 本指南第六、七节（`config_path` + 读写挂载）；保存后由 `integration.proc` 发 SIGHUP 使其重载                        |
| **DNS 记录即时生效**   | headscale 用 `dns.extra_records_path` + 把该文件挂给 Headplane                                                      |
| **版本 / OS / 中继列** | `integration.agent.enabled: true`（本指南已开）+ 有效 `headscale.api_key`；机器详情页的中继（DERP）面板也来自它     |
| **配置快照 / 审计**    | 默认可用（`config_path` 可读后可写快照；快照与审计数据存在 `data_path` 里，务必持久化）                             |
| **浏览器 SSH**         | Agent + 目标节点 `tailscale up --ssh` + **Headplane 用 OIDC 登录**（API Key 登录不支持）                            |
| VNC / RDP              | ❌ Headplane 不含此功能；可另配 [headscale-console](https://github.com/rickli-cloud/headscale-console) 或 Guacamole |

## 十二、升级、备份与卸载

```bash
# 升级 Headplane（先看 CHANGELOG，注意 base_url / 集成配置是否变化）
cd /vol1/1000/APP/headplane
cp docker-compose.yml docker-compose.yml.bak-$(date +%F)
docker compose pull && docker compose up -d

# 备份（Headplane 数据 + headscale 生效配置与数据库）
tar -czf /vol1/1000/APP/headplane-backup-$(date +%F).tar.gz \
  -C /vol1/1000/APP/headplane config.yaml data \
  -C /vol1/@appdata headscale

# 卸载
docker compose down            # Headplane 停止；headscale 仍由 fnOS 应用管理
```

::: tip 配置快照 ≠ 数据库备份
`/settings/snapshots` 只保存 Headscale 的**配置文件**（以及文件模式下的策略文件），
恢复时也只写回这两类文件。`db.sqlite`（用户、节点、API Key、database 模式下的策略）
必须单独备份，并建议在 Headscale 停止后再复制。
:::

## 十三、常见问题

### 1. 保存 / 切换时出现 `Unexpected Server Error`（且日志里 `Error: Bad Request`）

**原因**：反代改写了 `Host` 头，React Router 的 CSRF 校验认为浏览器 `Origin` 与请求来源不一致，
于是拒绝所有"客户端表单提交"。**解决**：升级到 **0.8.4+**，并确保 `server.base_url` 是浏览器
访问的完整地址（不带 `/admin`）；必要时在 `config.yaml` 中追加：

```yaml
server:
  allowed_action_origins:
    - "headplane.example.com"
```

或让 Lucky 保留原始 `Host`。

### 2. 所有表单保存报错（添加用户、创建密钥、保存 ACL）

**原因**：反代剥掉了 `POST` 请求的 `Content-Type`，`request.formData()` 解析失败。
**解决**：升级到 **0.8.3+**（会自动补回并打印 `Request POST … arrived without a form Content-Type` 日志）。

### 3. 点"退出登录"报错

**解决**：升级到 **0.8.2+**（退出改为导航式，OIDC 单点登出失败也不再阻断）。

### 4. 导航栏里根本没有 DNS / 设置

**原因**：Headplane 读不到 headscale 的配置文件（`readable()` 为 false）。
**排查**：

```bash
docker compose logs headplane | grep -i 'Headscale configuration'
#  Unable to read …                     → 路径/挂载不对
#  No Headscale configuration file was provided → config.yaml 少了 headscale.config_path
# 在宿主机核对（容器是 distroless，没有可用的 ls）
ls -l /vol1/@appdata/headscale/config.yaml
```

**解决**：按第六、七节设置 `headscale.config_path` 并**读写**挂载生效配置（不要 `:ro`；
只读挂载会让入口出现但保存失败）。

### 5. 保存 ACL 报 `403 Policy is not writable`

**原因**：headscale 的 `policy.mode` 还是 `file`，策略 API 只读。
**解决**：改成 `database` 并重启 headscale 应用（见第四节）。

### 6. 容器访问不到 headscale

- 使用 host 网络时，容器内 `127.0.0.1` = 宿主机 → `headscale.url: http://127.0.0.1:8480`
- 若用默认 bridge 网络：需要 `extra_hosts: ["host.docker.internal:host-gateway"]`
  且 `headscale.url: http://host.docker.internal:8480`，同时 headscale 的 `listen_addr` 不能只绑 127.0.0.1

### 7. `./headscale: No such file or directory`

二进制在 `/vol1/@appcenter/headscale/`，配置在 `/vol1/@appdata/headscale/config.yaml`：

```bash
cd /vol1/@appcenter/headscale
./headscale --config /vol1/@appdata/headscale/config.yaml users list
```

### 8. 登录后立刻被踢回登录页 / 会话异常

- 走 HTTPS 反代时 `server.cookie_secure` 必须为 `true`，纯 HTTP 时为 `false`
- `server.base_url` 的协议/域名/端口必须和浏览器地址完全一致

### 9. 容器起不来，日志说配置无效

- 先看是不是 `cookie_secret` 长度不对：必须**正好 32 个字符**（`openssl rand -base64 24`）
- 再确认 `headscale.url` / `base_url` 是合法的 URL；环境变量里的数组型配置不会被解析

### 10. 配置检查里显示「无法验证」，或数据库目录提示只读

**原因**：Headplane 只挂了 `config.yaml`，没挂它指向的目录；或者按第七节用了只读挂载。
**解决**：保持 `/vol1/@appdata/headscale:/vol1/@appdata/headscale:ro` 这份只读挂载，
让检查能看到 `db.sqlite`、`noise_private.key`、策略文件；「无法验证写入权限」只会出现
在只读挂载下，属正常现象 —— 只有 Headscale 自己报写不进去时才需要处理。

### 11. 内嵌 DERP 区域一直没人用

多半是端口或反代：`server_url` 不是 https、客户端到不了 `server_url` 指示的端口（写端口就用
该端口，不写就是 443）、udp/3478 被防火墙挡掉、或 Lucky 没有转发 `/derp` 并放行 Upgrade。
先用 `tailscale debug derp-map` 看区域是否下发，再逐项对照第四节。

### 12. `docker compose exec` 报 `Headplane containers do not contain a shell by default.`

官方镜像是 distroless（假 `/bin/sh`，退出码 127）。临时把镜像换成 `:<版本>-shell`
调试标签即可；日常排查优先用 `docker compose logs` 和宿主机命令。

### 13. Agent 页提示 API Key 被拒绝（401）

Agent 用的是**配置文件里**的 `headscale.api_key`，不是你登录时输入的那把。
到 `/settings/api-keys`（或 CLI `apikeys create`）新建一把、写进 `config.yaml`，然后重启容器。

### 14. 浏览器 SSH 按钮点了报错

| 界面提示                                                          | 解决                                               |
| ----------------------------------------------------------------- | -------------------------------------------------- |
| `…only available when the Headplane agent integration is enabled` | 打开 `integration.agent.enabled`                   |
| `…only available when OIDC authentication is enabled.`            | 用 OIDC 登录（API Key 登录不支持浏览器 SSH）       |
| `You'll need to link your user account to a Headscale user`       | 在 Users 页面把 OIDC 用户关联到某个 Headscale 用户 |
| `No node found with hostname …`                                   | 目标节点执行 `tailscale up --ssh`，并确认主机名    |

另外，Headscale 0.29 beta ~ 0.29.1 会以 `Method Not Allowed` 拒绝浏览器 SSH 的
Tailscale WebSocket 请求，请升级到 0.29.2 或更高。

## 十四、验收清单

部署完成后逐项打勾：

```bash
cd /vol1/1000/APP/headplane

# 1) 配置被识别为有效（DNS / 设置 页面因此出现）
docker compose logs headplane | grep -i 'valid Headscale configuration'
# 2) 进程集成找到了 headscale serve（设置页的重载/重启按钮因此可用）
docker compose logs headplane | grep -i 'Found headscale serve'
# 3) Agent 已连上 Tailnet 并完成同步
docker compose logs headplane | grep -iE 'Agent|Tailnet'
# 4) Headplane 与 headscale 都活着（Headplane 绑在 compose 里写的监听地址上）
curl -sI http://192.168.1.10:4100/admin | head -n 1
curl -s http://127.0.0.1:8480/health
```

浏览器侧：

- [ ] 登录后导航栏有 **机器 / 用户 / 访问控制 / DNS / 设置**
- [ ] `/settings/system` 显示 Headscale 版本；**配置检查**有输出（只读挂载导致的「无法验证」属正常）；
      「重新加载配置」按钮可用并返回成功
- [ ] `/settings/headscale` 能保存并生效（例如切换 `policy.mode` 后重载）
- [ ] DNS 页面新增一条记录并保存成功；`cat /vol1/@appdata/headscale/extra-records.json` 能看到它，
      且**无需重启** Headscale 即生效
- [ ] `/settings/agent` 显示「上次同步」时间与节点数（正常状态）
- [ ] `/settings/api-keys`、`/settings/audit`、`/settings/snapshots` 均可打开；快照列表里能看到自动生成的一份
- [ ] 启用内嵌 DERP 后，DERP 页显示中继来源（仅内嵌 / 内嵌 + 公开地图）与由 `server_url` 推导的公开端口

客户端侧（任一已加入 Tailnet 的机器）：

```bash
tailscale debug derp-map          # 确认能看到自建区域（例如 headscale）
tailscale debug derp headscale    # 观察该区域的实际连通性
```

## 十五、命令速查

```bash
# ---- headscale（宿主机，原生进程）----
cd /vol1/@appcenter/headscale
CFG=/vol1/@appdata/headscale/config.yaml
./headscale --config $CFG version
./headscale --config $CFG users list
./headscale --config $CFG nodes list
./headscale --config $CFG apikeys list
./headscale --config $CFG apikeys create --expiration 3650d
./headscale --config $CFG apikeys expire --prefix <前缀>
./headscale --config $CFG policy get

# ---- Headplane（容器）----
cd /vol1/1000/APP/headplane
docker compose ps
docker compose logs -f headplane
docker compose up -d --force-recreate
# 进容器排查：先把 image 换成 :<版本>-shell 调试标签，再执行
# docker compose exec headplane ls -l /etc/headscale/config.yaml

# ---- 现场核对 ----
ps -ef | grep '[h]eadscale serve'
curl -s http://127.0.0.1:8480/health
ss -lntup | grep -E '4100|8480|3478'   # -u 才能看到内嵌 DERP 的 udp/3478
ls -l /vol1/@appdata/headscale/
```
