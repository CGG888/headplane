---
title: 双镜像部署
description: "用两个容器分别运行 Headscale 与 HeadplaneCN：共享绝对路径、一条命令升级、Lucky 反向代理与迁移步骤。"
outline: [2, 3]
---

# 双镜像部署：Headscale 与 HeadplaneCN 各跑一个容器

这份指南对应**已经定型的部署形态**：Headscale 与 HeadplaneCN 各跑一个容器，Headscale 不再由
NAS 应用中心托管。原来那种「Headscale 是宿主机原生进程、HeadplaneCN 在容器里」的部署不会再
回来；将来如果这个部署要变，就是变成这里的两容器形态。

两个容器都用 **host 网络**，所以容器里的 `127.0.0.1` 就是这台 NAS 本机：Headscale 的
`8080`（控制）、`9090`（指标）和 `udp/3478`（STUN）直接落在 NAS 上，不需要端口映射。

::: tip 适用环境

- NAS（fnOS 等）：Docker 与 Docker Compose 已就绪
- 反向代理：Lucky（可以和这两个容器不在同一台机器上）
- 客户端已经注册在一个**固定的 `server_url`** 上 —— 迁移全程不改它
  :::

如果你现在的部署还是「Headscale 原生进程 + HeadplaneCN 容器」——[fnOS 部署](/install/fnos)
或[原生模式](/install/native-mode)——那么[下面的迁移一节](#从当前部署迁移)就是给你的。

## 运行安装脚本（可选）

上面的目录布局、compose 文件、两份配置和迁移步骤，都可以交给脚本一次问清楚再生成：
[`scripts/dual-image-install.sh`](https://github.com/CGG888/headplaneCN/blob/main/scripts/dual-image-install.sh)。

```bash
# 在 NAS 上（或直接克隆仓库后：bash scripts/dual-image-install.sh）
curl -fsSL -o dual-image-install.sh \
  https://raw.githubusercontent.com/CGG888/headplaneCN/main/scripts/dual-image-install.sh

bash dual-image-install.sh --help      # 每个问题和开关的说明
bash dual-image-install.sh --dry-run   # 只打印计划，不写任何文件
bash dual-image-install.sh             # 正式安装
```

- **全程交互，默认值就是本文的值**：基础目录、两个镜像 tag、`server_url`、DERP 与
  管理界面的主机名、端口、时区、API Key、cookie secret、是否迁移，逐个询问并校验；
  输入不合格会重新问，不会直接退出。
- **目录布局由你决定**：HeadplaneCN 的配置文件与数据目录、Headscale 的配置目录与数据
  目录、DERP 地图目录（在 Headscale 配置目录里）都会逐个询问（默认值由基础目录推导），
  校验通过后先打印一次最终布局，再原样用于两个容器的 `volumes:`。
- **先看后写**：`--dry-run` 打印每一个要写的文件、每一次复制和之后要执行的命令，什么都
  不改；正式运行也会先打印完整计划，确认之后才落盘，且**不确认就不会启动容器**。
- **不会删你的数据**：已有配置只按需改写个别键（原文件另存 `.bak`），迁移只做**复制**
  并先打时间戳备份，脚本里没有任何删除数据的动作。
- 写完之后会问是否立刻 `docker compose up -d`，并顺手跑一遍 `docker compose ps`、
  Headscale 日志与 `headscale version` 的验收命令。

## 为什么用这个形态

- **没有路径与挂载的陷阱了。** `derp.paths` 过去要求「写宿主机路径 + 容器内挂载成同一个绝对
  路径」，那是因为 Headscale 在容器外。两个组件都在容器里之后，Headscale 读到的就是挂载给它
  的容器路径，`derp.paths` 直接写容器路径即可；只要两个容器把同一份目录挂在同一个绝对路径
  上，配置、地图文件天然是同一个文件。
- **两个组件可以分别重启。** 改 HeadplaneCN 的设置、升级 HeadplaneCN 的镜像，都不会顺带
  重启 Headscale；反过来 Headscale 重新加载配置也不影响 HeadplaneCN 的会话。生命周期解耦了。
- **升级仍然是一条命令。** 版本固定在 compose 的两个 tag 上，`docker compose pull && docker
compose up -d` 一次处理两个镜像；回滚就是把 tag 改回去再 `up -d`。
- **代价：Headscale 交给 compose 管。** 应用中心里没有它的启停按钮、也不会替你自动更新；
  版本、升级窗口、备份都要你在 compose 这一层负责（见下面的升级与回滚）。

## 目录布局

所有路径以 `/vol1/1000/APP/` 为例，按你的实际存储位置替换。

| 宿主机路径                                 | 用途                                                        | 容器内路径（两个容器一致）           |
| ------------------------------------------ | ----------------------------------------------------------- | ------------------------------------ |
| `/vol1/1000/APP/headplane/`                | compose 文件、HeadplaneCN 配置、HeadplaneCN 数据            | —                                    |
| `/vol1/1000/APP/headplane/config.yaml`     | HeadplaneCN 自己的配置                                      | `/etc/headplane/config.yaml`（只读） |
| `/vol1/1000/APP/headplane/data/`           | 会话、内部数据库、配置快照、Agent 状态                      | `/var/lib/headplane`                 |
| `/vol1/1000/APP/headscale/etc/`            | Headscale 的配置目录（要挂给两个容器）                      | `/etc/headscale`（读写）             |
| `/vol1/1000/APP/headscale/etc/config.yaml` | Headscale 生效配置                                          | `/etc/headscale/config.yaml`（读写） |
| `/vol1/1000/APP/headscale/etc/derp-maps/`  | 本地 DERP 地图（含区域筛选写出的那份）                      | `/etc/headscale/derp-maps/`（读写）  |
| `/vol1/1000/APP/headscale/data/`           | `db.sqlite`、`noise_private.key`、`derp_server_private.key` | `/var/lib/headscale`（读写 / 只读）  |

```bash
mkdir -p /vol1/1000/APP/headplane/data \
         /vol1/1000/APP/headscale/etc/derp-maps \
         /vol1/1000/APP/headscale/data
```

## compose 文件

路径：`/vol1/1000/APP/headplane/docker-compose.yml`

```yaml
services:
  headscale:
    # 固定版本，不要写 latest：升级就是显式改这一行
    image: headscale/headscale:0.29.2
    container_name: headscale
    restart: unless-stopped
    command: serve
    # host 网络：容器直接用 NAS 的 8080 / 9090 / udp 3478，不需要端口映射
    network_mode: host
    # 这里不需要 pid: host：进程集成跑在 HeadplaneCN 容器里，它已经共享宿主 PID
    # 命名空间，本来就能看到 headscale serve（只有 headplane 服务需要这一行）
    volumes:
      # 配置 + 本地 DERP 地图。两个容器里都是 /etc/headscale，HeadplaneCN 要能改写它
      - "/vol1/1000/APP/headscale/etc:/etc/headscale"
      # 数据库、noise 私钥、DERP 私钥：Headscale 自己读写
      - "/vol1/1000/APP/headscale/data:/var/lib/headscale"
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"

  headplane:
    # 与 HeadplaneCN 发布版本对应；国内可换加速前缀，例如
    # v6.gh-proxy.org/docker/ghcr.io/cgg888/headplanecn:0.22.11
    image: ghcr.io/cgg888/headplanecn:0.22.11
    container_name: headplane
    restart: unless-stopped
    depends_on:
      - headscale
    network_mode: host
    # 【必须】integration.proc 要读 /proc 找到 headscale serve 并向它发 SIGHUP
    pid: host
    volumes:
      # HeadplaneCN 自己的配置（只读即可）
      - "/vol1/1000/APP/headplane/config.yaml:/etc/headplane/config.yaml:ro"
      # HeadplaneCN 自己的数据：会话、内部数据库、配置快照、Agent 状态
      - "/vol1/1000/APP/headplane/data:/var/lib/headplane"
      # 【关键】与 headscale 容器**同一个绝对路径**：配置检查、保存配置、编辑 DERP 地图都靠它
      - "/vol1/1000/APP/headscale/etc:/etc/headscale"
      # 【推荐】数据目录也按同一个绝对路径挂进来，只读：路径检查与配置快照能看到
      # db.sqlite、noise_private.key 等。只读是刻意的，见「两侧的配置改动」
      - "/vol1/1000/APP/headscale/data:/var/lib/headscale:ro"
    environment:
      - "TZ=Asia/Shanghai"
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

### 每个挂载的作用（一行一条）

| 挂载                                                                 | 作用                                                                                                        |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `/vol1/1000/APP/headscale/etc/`（headscale）                         | 配置目录：`config.yaml`、`derp-maps/`、DNS 记录文件；读写                                                   |
| `/vol1/1000/APP/headscale/data:/var/lib/headscale`（headscale）      | 数据库与私钥的读写位置，容器重建也不会丢                                                                    |
| `/vol1/1000/APP/headplane/config.yaml:/etc/headplane/config.yaml:ro` | HeadplaneCN 自己的配置，只读即可                                                                            |
| `/vol1/1000/APP/headplane/data:/var/lib/headplane`                   | HeadplaneCN 的持久化数据（会话、内部库、快照、Agent 状态）                                                  |
| `/vol1/1000/APP/headscale/etc:/etc/headscale`（headplane）           | **同一个绝对路径**：`headscale.config_path`、保存配置、DERP 地图的查看/编辑/保存都落在这份文件上            |
| `/vol1/1000/APP/headscale/data:/var/lib/headscale:ro`（headplane）   | **同一个绝对路径 + 只读**：配置检查与快照能看到 `db.sqlite`、`noise_private.key`；只读避免 HeadplaneCN 误写 |

::: info 只读的数据目录是刻意的
HeadplaneCN 的用户不是 Headscale 的用户。把数据目录挂成只读，配置检查里「数据库目录」一项会
显示**无法验证写入权限** —— 这是预期结果，不是故障；只有 Headscale 自己报写不进去时才需要处理。
:::

### host 网络的限制

`network_mode: host` 的容器**不要写 `ports:`，也不要写 `extra_hosts:`**：host 网络下容器直接
使用宿主机的网络命名空间，端口映射没有意义（Compose 会拒绝或忽略它），而 `extra_hosts` 在
host 网络下同样无效 —— 也不需要，容器里的 `127.0.0.1` 本来就是宿主机。

于是对外端口完全由容器里监听什么决定：

| 端口       | 谁在听             | 怎么对外                                                                |
| ---------- | ------------------ | ----------------------------------------------------------------------- |
| `tcp/8080` | Headscale 控制服务 | Lucky 回源到 `127.0.0.1:8080`（控制路径与 `/derp` 都在这个端口上）      |
| `tcp/9090` | Headscale 指标     | 默认只给本机看；不要发布到公网                                          |
| `udp/3478` | 内嵌 DERP 的 STUN  | 在路由器/防火墙上把 `udp/3478` 直接放开到这台 NAS，**不能**走 HTTP 反代 |
| `tcp/4100` | HeadplaneCN        | Lucky 回源到 `127.0.0.1:4100`（默认是 `3000`，改了要同步改回源）        |

> [!IMPORTANT]
> `tcp/4100` 是管理台，暴露面最大：`server.host` 默认 `0.0.0.0`（整个局域网可达）。
> 只在本机做反代时把它收成 `127.0.0.1` 更安全 —— 安装脚本的 `--admin-bind 127.0.0.1`
> 在 host 网络下写 `server.host: "127.0.0.1"`，在 bridge 网络下把发布地址收成
> `127.0.0.1:4100`（容器内仍监听 `0.0.0.0`，否则 docker 无法转发）。无论哪种模式，
> 都不要把 `tcp/4100` 直接暴露到公网：前面必须有一层 TLS 反代或防火墙。

## 两侧的配置改动

### HeadplaneCN：`/vol1/1000/APP/headplane/config.yaml`

```yaml
server:
  host: "0.0.0.0"
  port: 4100 # 沿用你现在的 4100；默认是 3000，改了要同步改 Lucky 回源

  # 浏览器访问的完整地址：协议 + 域名 + 端口，结尾不带 /admin
  base_url: "https://admin.<domain>:8443"
  # 必须正好 32 个字符：openssl rand -base64 24
  cookie_secret: "<32 位随机串>"
  cookie_secure: true
  data_path: "/var/lib/headplane"

headscale:
  # host 网络下容器里的 127.0.0.1 就是宿主机，也就是 Headscale 容器
  url: "http://127.0.0.1:8080"

  # 浏览器里展示、浏览器 SSH 使用的对外地址（不填则回退上面的 url）
  public_url: "https://ha.<domain>:8443"

  # 【必填】完整的 API Key，不是列表里显示的前缀
  api_key: "hskey-api-..."

  # 【必填】容器内 Headscale 生效配置的路径，与挂载点逐字一致
  config_path: "/etc/headscale/config.yaml"

  # 可选：与 headscale 的 dns.extra_records_path 指向同一个文件，改 DNS 记录无需重启
  # dns_records_path: "/etc/headscale/extra-records.json"

integration:
  # 保存配置 / 系统页的重新加载按钮要向 headscale serve 发 SIGHUP
  # 前置：HeadplaneCN 容器必须 pid: host（见 compose）
  proc:
    enabled: true

  # Agent：同步节点版本 / OS 等详情，以及各机器所用的 DERP 区域与延迟
  agent:
    enabled: true
```

必改的只有五项：`headscale.url`、`headscale.config_path`、`headscale.api_key`、
`integration.proc.enabled`、`server.base_url`。

### Headscale：`/vol1/1000/APP/headscale/etc/config.yaml`

```yaml
# 【最重要】客户端注册用的地址：与迁移前完全一致，一个字符都不要改
server_url: https://ha.<domain>:8443

# 容器内监听地址；host 网络下就是 NAS 的 8080
listen_addr: 0.0.0.0:8080
metrics_listen_addr: 0.0.0.0:9090

# 私钥与数据库全部落在 /var/lib/headscale（就是宿主机上的 .../headscale/data）
noise_private_key_path: /var/lib/headscale/noise_private.key
database:
  type: sqlite
  sqlite:
    path: /var/lib/headscale/db.sqlite

# 可选：DNS 记录改走文件时，用两个容器都能看到的那份
# dns:
#   extra_records_path: /etc/headscale/extra-records.json

derp:
  server:
    enabled: true
    region_id: 999
    region_code: headscale
    region_name: "Headscale Embedded DERP"
    stun_listen_addr: "0.0.0.0:3478"
    private_key_path: /var/lib/headscale/derp_server_private.key
  # 下面的路径现在是**容器里的路径**，不再是宿主机路径
  paths:
    - /etc/headscale/derp-maps/official-mirror.yaml
```

| 改动                                                                            | 为什么                                                                                                              |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `listen_addr: 0.0.0.0:8080`                                                     | 容器内监听；host 网络下直接就是 NAS 的 `8080`。客户端不关心这个端口，它只认 `server_url`                            |
| `server_url` **保持不变**                                                       | 客户端是按它注册并校验的。改了它，所有已注册节点都要重新登录                                                        |
| `noise_private_key_path` / `database.sqlite.path` 指向 `/var/lib/headscale/...` | 这两个文件现在来自挂载的数据目录，路径必须是容器路径                                                                |
| `derp.paths` 改写成**容器路径**                                                 | Headscale 在容器里，它看到的是挂载给它的路径；写成 `/etc/headscale/derp-maps/...` 与 HeadplaneCN 看到的是同一个文件 |
| `stun_listen_addr: 0.0.0.0:3478`                                                | 内嵌 DERP 的 STUN；host 网络下直接占 NAS 的 `udp/3478`                                                              |
| `derp.server.enabled: true` + `private_key_path`                                | 自建内嵌中继；私钥放在可写的数据目录里，缺失时 Headscale 会自动生成                                                 |
| `derp.urls`                                                                     | 原样保留你现在的值（只用自建中继就保持 `[]`）                                                                       |
| `policy.mode`                                                                   | 原样保留（想用网页改 ACL 就必须是 `database`）                                                                      |

### 旧的「宿主机路径 + 相同绝对路径」规则为什么消失

那条规则存在，是因为 **Headscale 读的是宿主机上的路径**，而 HeadplaneCN 在容器里：只有把宿主
目录按它在宿主机上的绝对路径原样挂进容器，两边才指向同一个文件。所以那时 `derp.paths` 必须写
`/vol1/@appdata/headscale/derp-maps/...`，而容器挂载点必须逐字相同。

现在 **Headscale 也在容器里**，它读到的是挂载给它的容器路径。于是：

- `derp.paths` 写**容器路径**（`/etc/headscale/derp-maps/official-mirror.yaml`）；
- 两个容器把共享目录挂在**同一个绝对路径**上（`/etc/headscale`、`/var/lib/headscale`），
  这是「两个容器之间一致」，不再是「容器内路径必须等于宿主机路径」；
- 过去那句报错 `getting DERPMap: open /etc/headscale/derp-maps/derp.yaml: no such file or
directory` 当时是**必然**出现的；现在它只会因为「容器里真的没有这个文件」出现（文件没建、
  挂载没加、路径写错），见常见故障。

::: warning DERP 区域筛选卡片的目标路径也要改
「官方区域节点筛选」卡片的目标文件路径默认值是旧形态的宿主机路径
（`/vol1/@appdata/headscale/derp-maps/official-mirror.yaml`）。在两容器形态里请改成
`/etc/headscale/derp-maps/official-mirror.yaml`，并确保**这同一条路径**出现在 Headscale 的
`derp.paths` 里 —— 否则 Headscale 下次重载会找不到文件。这张卡片的完整判定规则见
[Headscale 设置](/features/headscale-settings)。
:::

## 从当前部署迁移

按顺序做，别跳步。全程**不要改 `server_url`**。

**1. 备份数据目录**

```bash
# 数据库、noise 私钥、配置、策略文件、DERP 地图与 DERP 私钥
cd /vol1/@appdata
tar -czf /vol1/1000/APP/headscale-migration-$(date +%F).tar.gz headscale
```

想拿到绝对一致的数据库副本，先在 fnOS 应用中心停掉 headscale 再做这份备份。

**2. 停掉原生 Headscale，确认端口空出来**

```bash
# fnOS 应用中心 → headscale → 停止
ps -ef | grep '[h]eadscale serve'      # 期望没有输出
ss -lntup | grep -E '8080|9090|3478'   # 期望没有输出（-u 才能看到 udp/3478）
```

**3. 复制数据与配置到新目录**

```bash
mkdir -p /vol1/1000/APP/headscale/data /vol1/1000/APP/headscale/etc/derp-maps

cp -a /vol1/@appdata/headscale/config.yaml       /vol1/1000/APP/headscale/etc/config.yaml
cp -a /vol1/@appdata/headscale/db.sqlite         /vol1/1000/APP/headscale/data/
cp -a /vol1/@appdata/headscale/noise_private.key /vol1/1000/APP/headscale/data/
cp -a /vol1/@appdata/headscale/derp_server_private.key \
      /vol1/1000/APP/headscale/data/ 2>/dev/null || true
cp -a /vol1/@appdata/headscale/derp-maps/.       /vol1/1000/APP/headscale/etc/derp-maps/ 2>/dev/null || true
cp -a /vol1/@appdata/headscale/extra-records.json /vol1/1000/APP/headscale/etc/ 2>/dev/null || true
# policy.mode: file 的话，按 config.yaml 里的 policy.path 把策略文件也复制过去

# 两个镜像都以 root 运行，目录归 root 即可；私钥保持 600
chown -R 0:0 /vol1/1000/APP/headscale
chmod 600 /vol1/1000/APP/headscale/data/noise_private.key
chmod 600 /vol1/1000/APP/headscale/data/derp_server_private.key 2>/dev/null || true
```

**4. 改写 `config.yaml` 里的容器路径**

按上面「Headscale」那节的表逐项替换：`noise_private_key_path`、`database.sqlite.path`、
`derp.server.private_key_path`、`derp.paths`、`dns.extra_records_path`、`policy.path`、
`unix_socket`（如果用了），以及任何指向宿主机绝对路径的证书/文件路径。同时把
`listen_addr` 改成 `0.0.0.0:8080`。**`server_url` 不动。**

**5. 起栈**

```bash
cd /vol1/1000/APP/headplane
mkdir -p data
# 先放好 config.yaml 与 docker-compose.yml
docker compose up -d
docker compose ps
```

**6. 看日志、看页面**

```bash
docker compose logs headscale | tail -n 50
# 期望：监听 8080、DERP 已启用，且没有 getting DERPMap 报错

curl -s  http://127.0.0.1:8080/health           # {"status":"pass"}
curl -si http://127.0.0.1:8080/derp | head -3   # 400/426 一类，不是 404

docker compose exec headscale headscale nodes list | head
docker compose exec headscale headscale apikeys list

docker compose logs headplane | grep -iE 'valid Headscale configuration|Found headscale serve|Agent'
# 期望：Found a valid Headscale configuration file at /etc/headscale/config.yaml
#       Found headscale serve (PID ...)
```

浏览器打开 `https://admin.<domain>:8443/admin`，进 **设置 → 系统 → 配置检查**：数据库目录、
noise 私钥、策略文件、TLS 路径等应逐项给出结论（数据目录是只读挂载，所以「无法验证写入权限」
属预期）。再去 **设置 → Headscale → DERP** 确认地图与区域筛选那张卡片里的路径已经是
`/etc/headscale/...`。

**7. 客户端不需要重新注册**

`server_url` 和对外端口（Lucky 的 `8443`、`udp/3478`）都没变，数据库、`noise_private.key`
和 DERP 私钥也原样搬过去了，所以已注册节点什么都不用做：

```bash
# 在任意一台客户端上
tailscale status        # 应该直接显示已连接，不需要 tailscale up
tailscale debug derp-map
```

不要在这时候执行 `tailscale up --login-server ...` 或重新注册 —— 那会让节点以新的身份重新
入网。

## 升级与回滚

```bash
cd /vol1/1000/APP/headplane

# 【必做】Headscale 升级前先备份：数据库迁移是单向的
docker compose stop headscale
tar -czf /vol1/1000/APP/headscale-backup-$(date +%F).tar.gz \
  -C /vol1/1000/APP headscale headplane
docker compose start headscale

# 改 compose 里的 tag（两个都可以只改一个），然后
docker compose pull
docker compose up -d

# 检查
docker compose ps
docker compose logs headscale | tail -n 30
docker compose exec headscale headscale version
```

- **HeadplaneCN 回滚**：把 `image:` 的 tag 改回旧版本，`docker compose up -d` 即可。它的数据在
  自己的 `data/` 里，与 Headscale 的版本无关。
- **Headscale 回滚**：把 tag 改回旧版本，`docker compose up -d`；**如果新版本已经跑过数据库
  迁移，光换回镜像不够** —— 先 `docker compose down`，用备份里的 `db.sqlite` 覆盖
  `headscale/data/db.sqlite`（容器停止时覆盖），再 `docker compose up -d`。
- 固定在 compose 里的 tag 就是「锁版本」；不要为了让 `latest` 自动升级而放弃它。

## 反向代理要点

对外只有一个端口 `8443`、两个主机名（外加可选的 `admin.`），Lucky 按 Host 头分流，全部回源到
这台 NAS：

| 对外主机名             | 回源                    | 承载流量                                                                                       |
| ---------------------- | ----------------------- | ---------------------------------------------------------------------------------------------- |
| `ha.<domain>:8443`     | `http://127.0.0.1:8080` | `server_url` 所在域名：客户端控制流量（`/key`、`/ts2021`、`/api/v1/*`、`/health`）以及 `/derp` |
| `derp.<domain>:8443`   | `http://127.0.0.1:8080` | `/derp` 中继流量的另一个入口（同一个容器）                                                     |
| `admin.<domain>:8443`  | `http://127.0.0.1:4100` | HeadplaneCN 管理界面（`/admin`，含浏览器 SSH 的 WebSocket）                                    |
| `udp/3478`（不经反代） | NAS 的 `udp/3478`       | STUN，必须直连                                                                                 |

### 客户端控制流量（`ha.`）

- 必须**支持 HTTP/2 并能一路透传到容器**：控制隧道 `/ts2021` 是长连接，代理降级到 HTTP/1.1 或
  做了缓冲会让节点时断时续。
- 读写超时调到 **300 秒以上**（或关闭），并**关闭响应缓冲 / gzip 改写**。
- **不要改写路径**：`/api/v1/*`、`/ts2021`、`/key`、`/health`、`/verify` 都要原样落到
  `127.0.0.1:8080`。
- 证书必须是客户端信任的、且与 `server_url` 的域名一致。

### DERP 中继流量（`/derp`）

- 客户端拿到的中继地址是 Headscale 用 `server_url` 推导出来的（域名取 `server_url` 的域名、
  端口取它的端口、路径是 `/derp`）。所以**`server_url` 那个域名必须能吃下 `/derp`**；
  `derp.<domain>` 只是同一个容器上的第二个入口，不要让它成为客户端唯一能到中继的地址。
- 保留 **Upgrade / WebSocket** 升级头，**不要缓冲**，超时 ≥300 秒；路径不要重写、不要去掉。
- 两个域名都要有有效证书；TLS 由 Lucky 终止，容器里继续是明文 HTTP。

### STUN（`udp/3478`）

HTTP 反向代理**转发不了 UDP**。DERP map 里公告的 STUN 端口是 `udp/3478`，客户端会往
`<server_url 的域名>:3478/udp` 发包，所以要在 Lucky 所在机器或路由器上直接放开：

```
udp/3478  →  <NAS 的 IP>:3478/udp
```

### 验证（三招，按顺序）

```bash
# ① 直连 Headscale：确认 /derp 路由存在（期望 400/426 一类，不是 404）
curl -si http://127.0.0.1:8080/derp | head -3

# ② 经反代：状态码应与 ① 一致
curl -si https://ha.<domain>:8443/derp | head -3

# ③ 客户端侧（决定性证据）
tailscale debug derp-map | grep -A 12 -i headscale
tailscale debug derp headscale
```

## 验收清单

```bash
cd /vol1/1000/APP/headplane

docker compose ps                                   # 两个容器都是 Up / healthy
docker compose logs headplane | grep -i 'valid Headscale configuration'
docker compose logs headplane | grep -i 'Found headscale serve'
docker compose logs headplane | grep -iE 'Agent|Tailnet'
docker compose logs headscale | grep -iE 'error|derp' | tail
curl -s http://127.0.0.1:8080/health                # {"status":"pass"}
```

- [ ] 两个容器都在跑，`docker compose restart` 后自动恢复
- [ ] `设置 → 系统 → 配置检查`整体为绿（只读数据目录的「无法验证写入权限」是预期）
- [ ] `设置 → Headscale` 能保存配置，并触发一次成功重载（日志里 `Sent SIGHUP to Headscale`）
- [ ] **已注册客户端不重新注册即可上线**（`tailscale status` 直接显示已连接）
- [ ] 内嵌中继真的被使用：`tailscale debug derp-map` 能看到区域，`tailscale debug derp
    headscale` 能连通，机器详情页的中继卡片显示该区域
- [ ] 通过 Lucky 能打开 `https://admin.<domain>:8443/admin`
- [ ] 「官方区域节点筛选」卡片的目标路径是 `/etc/headscale/derp-maps/official-mirror.yaml`，
      并且**这同一条路径**出现在 `derp.paths` 里、文件确实存在
- [ ] `udp/3478` 从公网可达（`tailscale netcheck` 里 STUN 不是「不可用」）

## 常见故障

### `getting DERPMap: open /etc/headscale/derp-maps/xxx.yaml: no such file or directory`

Headscale 启动/重载时读不到 `derp.paths` 里的某个文件，于是直接退出。两容器形态下只有三种原因：

1. **文件不存在**：先建占位文件，再把它写进配置。

   ```bash
   printf 'regions: {}\n' > /vol1/1000/APP/headscale/etc/derp-maps/official-mirror.yaml
   ```

2. **`derp.paths` 里不是容器路径**：仍然写着旧形态的宿主机路径（`/vol1/@appdata/...`）。
   改成 `/etc/headscale/derp-maps/...`。
3. **挂载没生效**：compose 里少了 `/vol1/1000/APP/headscale/etc:/etc/headscale` 这一条，或者宿主机
   上的目录名写错。`docker compose up -d` 重建容器后确认：

   ```bash
   docker compose exec headscale ls -l /etc/headscale/derp-maps/
   ```

先让它能起来：把 `derp.paths` 里那一行注释掉，或用 `设置 → 快照` 回滚到写入前的配置快照，
重启后再按「先在宿主目录建文件 → 确认挂载 → 写进 `derp.paths`」的顺序重做。

### 客户端一直不上线

按可能性从高到低排查：

| 检查                    | 命令 / 位置                                                                | 结论                                                       |
| ----------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------- |
| `server_url` 有没有被改 | `docker compose exec headscale grep server_url /etc/headscale/config.yaml` | 必须与迁移前逐字一致；改过就得把每个节点重新注册           |
| 域名与证书              | 外网机器上 `curl -sI https://ha.<domain>:8443/health`                      | 证书必须受客户端信任、域名必须与 `server_url` 一致         |
| 反代是否透传长连接      | Lucky 里看是否 HTTP/2、是否关了缓冲、超时是否 ≥300 秒                      | `/ts2021` 被缓冲或降级会让节点连不上或频繁掉线             |
| noise 私钥是否搬过来    | `docker compose exec headscale ls -l /var/lib/headscale/`                  | 私钥被重新生成时，已注册节点全部无法通信（必须从备份恢复） |
| 数据库是否搬过来        | `docker compose exec headscale headscale nodes list`                       | 列表为空说明 `db.sqlite` 没搬对或指向了别的路径            |
| 节点在册但显示离线      | `docker compose exec headscale headscale nodes list` 里的 last seen        | 说明注册正常、是网络/反代链路问题，回到上两行              |
| 服务本身是否活着        | `curl -s http://127.0.0.1:8080/health`、`docker compose logs headscale`    | 不是 `{"status":"pass"}` 就先看日志里的第一条错误          |

::: tip 一句话
客户端只认 `server_url` 和它背后的证书与链路；数据库和 noise 私钥是「它还是原来那个控制服务」
的凭据。这两样对了，客户端就不需要重新注册。

其它症状（保存报 `Unexpected Server Error`、`403 Policy is not writable` 等）见
[常见问题](/configuration/common-issues)。
:::
