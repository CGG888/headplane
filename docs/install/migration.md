---
title: 模式迁移与回退
description: 在 fnOS 原生模式与双镜像模式之间双向迁移：迁移前备份什么、每一步做什么、失败怎么退回去。
outline: [2, 3]
---

# 模式迁移与回退

这一页只讲**在两种部署形态之间搬家**：Headscale 跑原生进程、面板跑容器（[fnOS 部署](/install/fnos)）
⇄ Headscale 与面板各跑一个容器（[双镜像部署](/install/dual-image)）。两个方向都写：先写
原生 → 双镜像，再写双镜像 → 原生。**安装细节不在这里重复**（`.env`、compose 全文、两份完整配置都在
[双镜像部署](/install/dual-image)），域名与反向代理见[域名与访问方式](/install/domains)。

**什么时候要迁移**：想让 Docker 连 Headscale 一起管（升级、重启、看日志）→ 从原生搬双镜像；
想让 Headscale 回到 fnOS 应用中心托管、把 Docker 依赖降到最低 → 从双镜像搬回原生。

**迁移不会丢什么**：数据不做格式转换，只是**换个位置**。`server_url`、对外端口、`db.sqlite`、
`noise_private.key`、DERP 私钥全部保持不变，所以**已注册的客户端不用重新注册、不用再执行
`tailscale up`**。这是两个方向共同的底线。

**迁移前必须备份**：Headscale 数据库与 noise 私钥、Headscale 的 `config.yaml`、面板数据库与
`cookie_secret`、DERP 地图文件。见下一节 —— **备份没做完不要往下走**。

::: warning 三样东西全程都不能改

- **`server_url`**（域名与端口）：改了它，所有已注册节点都要重新登录注册。
- **`noise_private.key`**：丢了它，等于换了一个控制服务，节点全部连不上。
- **面板的 `cookie_secret`**：改了它，所有人被踢下线、要重新登录。
  :::

## 需要你改的值

| 占位符                    | 示例                                                                  | 说明                                            | 改不改               | 在哪里改                                                    |
| ------------------------- | --------------------------------------------------------------------- | ----------------------------------------------- | -------------------- | ----------------------------------------------------------- |
| `server_url` 的域名与端口 | `https://ha.example.com:8443`                                         | 客户端注册地址，迁移全程**逐字不变**            | **别动**             | Headscale 的 `config.yaml`                                  |
| 原生数据目录              | `/vol1/@appdata/headscale`                                            | fnOS 应用的数据目录                             | 可改                 | 按你的实际路径                                              |
| 双镜像根目录 `BASE_DIR`   | `/vol1/1000/APP/headplaneCN`                                          | 新形态的根目录，**容器内外同一路径**            | 可改                 | `.env` 的 `BASE_DIR`                                        |
| NAS 的局域网 IP           | `192.168.1.10`                                                        | 面板监听地址，反代回源也用它                    | **必须改**           | `.env` 的 `PANEL_BIND`、面板 `config.yaml` 的 `server.host` |
| Headscale 数据属主        | `965:966`                                                             | 容器以这个 uid:gid 运行，否则写不了数据库       | **必须改**           | `.env` 的 `HEADSCALE_UID/GID`（`ls -ln` 看实际值）          |
| 面板 cookie 密钥          | `openssl rand -base64 24`                                             | 加密 cookie，必须正好 32 个字符                 | **别动**（沿用旧值） | 面板 `config.yaml` 的 `server.cookie_secret`                |
| Headscale API 密钥        | `hskey-api-...`                                                       | 面板访问 Headscale API 用，要完整值而不是前缀   | **必须改**           | 面板 `config.yaml` 的 `headscale.api_key`                   |
| 镜像版本号                | `0.29.4`、`0.22.23`                                                   | 固定版本，不用 `latest`；升级只改这里           | 可改                 | `.env` 的 `HEADSCALE_VERSION` / `HEADPLANE_VERSION`         |
| DERP 地图文件路径         | `/vol1/1000/APP/headplaneCN/headscale/derp-maps/official-mirror.yaml` | `derp.paths` 与面板 DERP 卡片必须指向同一个文件 | 可改                 | Headscale 的 `config.yaml`                                  |
| STUN 端口                 | `udp/3478`                                                            | 必须由路由器单独转发，反向代理管不了 UDP        | **别动**             | 路由器 / 防火墙                                             |

## 一、迁移前：备份这几样

要备份的是四样东西，缺一样都可能回不去：

1. **Headscale 数据库与 noise 私钥** —— `/vol1/@appdata/headscale/` 整个目录，重点是 `db.sqlite`、
   `noise_private.key`、`derp_server_private.key`；
2. **Headscale 的 `config.yaml`** —— `server_url`、`derp.paths` 这些键都在里面，同一个目录里一起打包；
3. **面板数据库与 `cookie_secret`** —— 面板的 `data/` 目录（会话、内部库、快照、Agent 状态）与它自己的
   `config.yaml`（`server.cookie_secret` 在里面）；
4. **DERP 地图文件** —— `derp-maps/`，包括「官方区域筛选」写出的 `official-mirror.yaml`。

```bash
# ① Headscale 数据。想要绝对一致的数据库副本，先在 fnOS 应用中心停掉 headscale 再打包
sudo mkdir -p /vol1/1000/APP/headplaneCN/backup
sudo tar -czf /vol1/1000/APP/headplaneCN/backup/native-headscale-$(date +%Y%m%d-%H%M%S).tar.gz \
  --exclude=headscale/headscale.log \
  -C /vol1/@appdata headscale

# ② 面板自己的数据与配置（cookie_secret 在里面，务必一起备份）
sudo tar -czf /vol1/1000/APP/headplaneCN/backup/headplane-$(date +%Y%m%d-%H%M%S).tar.gz \
  -C /vol1/1000/APP/headplaneCN data config.yaml
```

原生安装的 `headscale.log` 可能有几百 MB，上面的 `--exclude` 就是为它加的。

**备份做完先确认**，别怕慢：

```bash
tar -tzf /vol1/1000/APP/headplaneCN/backup/native-headscale-*.tar.gz \
  | grep -E 'db.sqlite|noise_private.key|config.yaml'
tar -tzf /vol1/1000/APP/headplaneCN/backup/headplane-*.tar.gz | head
```

如果目录里已经有「面板单容器 + 原生 headscale」的 compose，再留一份：

```bash
cp /vol1/1000/APP/headplaneCN/docker-compose.yml \
   /vol1/1000/APP/headplaneCN/docker-compose.yml.bak-native-$(date +%Y%m%d-%H%M%S)
```

**放在哪、怎么放**：

- 两份都放 `${BASE_DIR}/backup/`，文件名带日期时间，`ls -lh backup/` 就能对上每次操作；
- 备份里有 `noise_private.key` 和 `cookie_secret`，等同于控制服务的凭据：权限保持 `600`，
  别放进公开网盘或同步盘；
- 只在本机放一份不算备份，再 `scp` 一份到另一块盘或另一台机器；
- 迁移完成后**不要**马上删 `/vol1/@appdata/headscale`，留几周再说。

## 二、停掉旧形态（顺序很重要）

```bash
# 1) 先在 fnOS 应用中心停掉 headscale（不要先停面板）
# 2) 确认进程真的没了
ps -ef | grep '[h]eadscale serve'             # 期望：没有输出

# 3) 确认端口空出来（-u 才能看到 udp/3478）
ss -lntup | grep -E '8480|8481|3478|50443'    # 期望：没有输出

# 4) 再停掉面板容器
cd /vol1/1000/APP/headplaneCN
docker compose down
```

为什么是这个顺序：

- **先停 Headscale**：SQLite 落盘、`-wal` 合并，之后打包出来的数据库才是干净的一份；
- **先确认端口空了**：`8480` 还挂着原生进程时，容器里的 Headscale 起不来，日志只报
  `address already in use`，看起来像配置写错；
- **最后停面板容器**：先 `down` 很容易忘记去停原生 headscale，于是「端口被占」这个问题直到启动
  新形态时才暴露。

反方向（双镜像 → 原生）先停的是容器那一侧：`docker compose down` 会按依赖顺序停掉栈里的容器
（用 Lucky 路径分流时是三个：`headscale`、`headplaneCN`、`caddy`），再回到第四节搬数据。

## 三、原生 → 双镜像

### 3.1 目录布局：三个容器、一个目录

| 宿主机路径                                           | 放什么                                                                                                                             |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `${BASE_DIR}/headscale/`                             | Headscale 的数据与配置：`db.sqlite`、`noise_private.key`、`derp_server_private.key`、`config.yaml`、`derp-maps/`、`headscale.sock` |
| `${BASE_DIR}/data/`                                  | 面板自己的数据：会话、内部库、快照、Agent 状态                                                                                     |
| `${BASE_DIR}/config.yaml`                            | 面板自己的配置                                                                                                                     |
| `${BASE_DIR}/backup/`                                | 迁移与升级前的 `tar.gz`（第一节两条命令的产物）                                                                                    |
| `${BASE_DIR}/.env`、`${BASE_DIR}/docker-compose.yml` | 版本号、运行用户、三个容器的定义（含 `caddy`，不用 Lucky 路径分流时删掉那一段）                                                    |

`BASE_DIR` 就是这份目录的绝对路径，示例 `/vol1/1000/APP/headplaneCN`，按你的实际存储位置替换。
**容器内外用的是同一个路径**，这是下面「绝对路径不用改」的前提。

```bash
mkdir -p /vol1/1000/APP/headplaneCN/{data,backup} \
         /vol1/1000/APP/headplaneCN/headscale/derp-maps \
         /vol1/1000/APP/headplaneCN/caddy/{data,config}   # 只有 Lucky 方案需要
```

### 3.2 把数据复制到新目录

```bash
sudo cp -a /vol1/@appdata/headscale/. /vol1/1000/APP/headplaneCN/headscale/

# 只删运行期残留：日志、pid、旧 socket（容器会重建 socket）
sudo rm -f /vol1/1000/APP/headplaneCN/headscale/headscale.log \
           /vol1/1000/APP/headplaneCN/headscale/headscale.pid \
           /vol1/1000/APP/headplaneCN/headscale/headscale.sock

# 私钥保持 600；顺便记下属主，下一步要填进 .env
sudo chmod 600 /vol1/1000/APP/headplaneCN/headscale/noise_private.key
sudo chmod 600 /vol1/1000/APP/headplaneCN/headscale/derp_server_private.key
ls -ln /vol1/1000/APP/headplaneCN/headscale | head
```

这一条是 **`cp`（复制）不是 `mv`**：`/vol1/@appdata/headscale` 原样留着，刚迁完就发现不对可以直接
切回去（见第六节）。

### 3.3 `.env`：只有这几个键要动

`.env` 与 `docker-compose.yml` 的全文在[双镜像部署](/install/dual-image)，这里只列迁移时会碰到的键：

```ini
# /vol1/1000/APP/headplaneCN/.env
HEADSCALE_VERSION=0.29.4              # ← 可改：固定版本，升级就改这一行
HEADPLANE_VERSION=0.22.23             # ← 可改：同上

HEADSCALE_UID=965                     # ← 必须改：3.2 里 ls -ln 看到的属主 uid
HEADSCALE_GID=966                     # ← 必须改：同上的 gid（填 0 表示以 root 运行）

BASE_DIR=/vol1/1000/APP/headplaneCN   # ← 可改：必须是绝对路径，容器内外都用它
PANEL_BIND=192.168.1.10               # ← 必须改：你 NAS 的 IP
PANEL_PORT=4100                       # ← 可改（默认 4100）
TZ=Asia/Shanghai                      # ← 可改

CADDY_IMAGE=v6.gh-proxy.org/docker/caddy:2-alpine   # ← 可改：只有 Lucky 方案需要
CADDY_PORT=8444                                     # ← 可改（同上）
```

::: warning 绑定具体 IP 时，两处要一起改
面板的监听地址和它自己的健康检查探针用的是同一个地址。compose 里两者都引用
`${PANEL_BIND}:${PANEL_PORT}`，所以改 `.env` 一处就够；手工改 compose 时只改一处，容器会一直显示
`unhealthy`。
:::

### 3.4 compose：三条挂载 + 两个环境变量

```yaml
# 片段；完整文件见 /install/dual-image
services:
  headscale:
    network_mode: host
    labels:
      me.tale.headplane.target: "headscale" # ← 面板靠这个标签找到容器
    volumes:
      - "${BASE_DIR}/headscale/config.yaml:/etc/headscale/config.yaml:ro"
      - "${BASE_DIR}/headscale:${BASE_DIR}/headscale" # ← 关键：同一个绝对路径
  headplaneCN:
    network_mode: host
    volumes:
      - "${BASE_DIR}/headscale/config.yaml:/etc/headscale/config.yaml"
      - "${BASE_DIR}/headscale/derp-maps:${BASE_DIR}/headscale/derp-maps"
      - "${BASE_DIR}/headscale:${BASE_DIR}/headscale:ro"
      - "/var/run/docker.sock:/var/run/docker.sock" # ← Docker 集成靠它重启 headscale 容器
    environment:
      - "HEADPLANE_INTEGRATION__DOCKER__ENABLED=true" # ← 换成 Docker 集成
      - "HEADPLANE_INTEGRATION__PROC__ENABLED=false" # ← 关掉原生的 SIGHUP 集成
```

::: tip 双镜像不需要的两项，回退时会用到
`pid: host` 在双镜像里是**可选**的（只为让 Agent 看到宿主机进程），
`security_opt: ["apparmor=unconfined"]` 则完全不需要 —— 那是 proc 集成要的，见第四节。
:::

### 3.5 两侧配置要改的键

| 改哪里                  | 键                                                                                                            | 改成什么                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 面板 `config.yaml`      | `server.host` / `server.port`                                                                                 | 与 `.env` 的 `PANEL_BIND` / `PANEL_PORT` 一致                                                |
| 面板 `config.yaml`      | `server.base_url`                                                                                             | 浏览器访问**面板**的完整地址，结尾不带 `/admin`                                              |
| 面板 `config.yaml`      | `server.cookie_secret`                                                                                        | 沿用迁移前那一串（32 个字符）                                                                |
| 面板 `config.yaml`      | `headscale.url`                                                                                               | `http://127.0.0.1:8480`（host 网络下容器里的 `127.0.0.1` 就是宿主机）                        |
| 面板 `config.yaml`      | `headscale.public_url`                                                                                        | 浏览器访问 Headscale 的对外地址，与 `server_url` 一致                                        |
| 面板 `config.yaml`      | `headscale.api_key`                                                                                           | 完整的 `hskey-api-...`                                                                       |
| 面板 `config.yaml`      | `headscale.config_path`                                                                                       | `/etc/headscale/config.yaml`，与挂载点逐字一致                                               |
| 面板 `config.yaml`      | `integration.docker.enabled`                                                                                  | `true`；同时把 `integration.proc.enabled` 改成 `false`                                       |
| Headscale `config.yaml` | `noise.private_key_path`、`database.sqlite.path`、`derp.server.private_key_path`、`derp.paths`、`unix_socket` | **只有当它们还写着 `/vol1/@appdata/headscale/...` 时才改**，改到 `${BASE_DIR}/headscale/...` |
| Headscale `config.yaml` | `server_url`                                                                                                  | **不动**                                                                                     |

::: tip compose 里已经用环境变量写了这些
`HEADPLANE_SERVER__HOST/PORT`、`HEADPLANE_HEADSCALE__CONFIG_PATH`、
`HEADPLANE_INTEGRATION__DOCKER__*` 与配置文件里的键一一对应，而且**环境变量优先级更高**。两种写法
二选一即可：写进 compose 就不用动 `config.yaml`；写进配置文件就可以删掉那些环境变量。
:::

::: tip 让安装脚本帮你改路径（可选）
[双镜像部署](/install/dual-image) 里的 `scripts/dual-image-install.sh` 会问「是否从原生部署迁移」，
并把 `/vol1/@appdata/headscale/...` 这些旧路径自动改写到 `${BASE_DIR}/headscale/...`
（只改到那里，绝不会改成 `/etc/headscale` 或 `/var/lib/headscale`）。手工迁移就按上表自己改。
:::

### 3.6 挂载路径规则：为什么这次不用改绝对路径

```text
宿主机           /vol1/1000/APP/headplaneCN/headscale   ← 数据在这里
headscale 容器   - "${BASE_DIR}/headscale:${BASE_DIR}/headscale"
容器内           /vol1/1000/APP/headplaneCN/headscale   ← 同一个路径
配置里           private_key_path: /vol1/1000/APP/headplaneCN/headscale/noise_private.key
```

于是「配置里写谁」和「文件在哪」永远一致，备份、快照、面板的路径检查也都指向同一处。唯一的例外是
**配置文件本身的挂载点**：Headscale 默认从 `/etc/headscale/config.yaml` 读配置，所以那一份仍然挂到
`/etc/headscale/config.yaml`。

::: warning 不要凭记忆手写 Headscale 配置
键名写错时 Headscale 会直接拒绝启动（日志里是 `unknown key` / `cannot unmarshal`）。改完先校验：

```bash
cd /vol1/1000/APP/headplaneCN
docker compose exec headscale headscale configtest   # 只校验，不启动
```

:::

### 3.7 启动与自检

```bash
cd /vol1/1000/APP/headplaneCN
docker compose config --quiet        # 语法与变量都齐了吗
docker compose up -d
docker compose ps                    # 期望：三个服务都 Up (healthy)（不用 Caddy 时是两个）
```

```bash
docker compose logs headscale | tail -n 50
# 期望：version=v0.29.4、DB opened at …/headscale/db.sqlite、DERP region 999、
#       stun server started、listening and serving HTTP on 0.0.0.0:8480

docker compose logs headplaneCN | tail -n 50
# 期望：Connected to Headscale 0.29.4、
#       Found a valid Headscale configuration file at /etc/headscale/config.yaml、
#       Using Docker integration、Listening on http://<PANEL_BIND>:4100
```

然后打开面板（`https://ha.example.com:8443/admin`）：**设置 → 系统**里集成应显示 **Docker**，
保存配置后 Headscale 容器会重启；**设置 → Headscale → DERP** 里地图卡片显示的应是新路径。

## 四、双镜像 → 原生

数据不用转换，只是搬回原位、再换回进程集成。

### 4.1 停栈并备份

```bash
cd /vol1/1000/APP/headplaneCN
docker compose down
sudo tar -czf backup/dual-image-headscale-$(date +%Y%m%d-%H%M%S).tar.gz -C . headscale
```

### 4.2 数据搬回原生目录

```bash
sudo cp -a /vol1/1000/APP/headplaneCN/headscale/. /vol1/@appdata/headscale/
sudo rm -f /vol1/@appdata/headscale/headscale.sock      # 让原生进程重建
# 属主改回 fnOS 的 headscale 用户（用 `id headscale` 看实际 uid:gid）
sudo chown -R "$(id -u headscale):$(id -g headscale)" /vol1/@appdata/headscale
```

`config.yaml` 里的绝对路径要改回**原生数据目录**：双镜像形态下它们指向 `${BASE_DIR}/headscale/...`
（例如 `/vol1/1000/APP/headplaneCN/headscale/...`），而 fnOS 原生进程读的是
`/vol1/@appdata/headscale/...`。把 `noise.private_key_path`、`database.sqlite.path`、
`derp.server.private_key_path`、`derp.paths`、`unix_socket`（填了才改）逐一改回去。

正向迁移时安装脚本会自动把旧路径改写到新目录；**反向这一步要手动改**。

### 4.3 起原生 Headscale

fnOS 应用中心 → headscale → 启动（并恢复「开机自启」）。

```bash
ps -ef | grep '[h]eadscale serve'
curl -s http://127.0.0.1:8480/health        # 期望 {"status":"pass"}
```

### 4.4 面板改回进程集成

面板不再有 Headscale 容器可重启，所以集成从 Docker 换成 proc，并按原生模式的要求改 compose：

```yaml
services:
  headplaneCN:
    image: ghcr.io/cgg888/headplanecn:<版本>
    container_name: headplaneCN
    restart: unless-stopped
    network_mode: host
    pid: host # ← 必须：proc 集成要读 /proc 找 headscale serve
    security_opt:
      - "apparmor=unconfined" # ← 必须：否则发 SIGHUP 报 kill EACCES
    volumes:
      - "/vol1/1000/APP/headplaneCN/config.yaml:/etc/headplane/config.yaml:ro"
      - "/vol1/1000/APP/headplaneCN/data:/var/lib/headplane"
      # 原生配置目录按同一绝对路径挂进来，面板才能改写它
      - "/vol1/@appdata/headscale:/vol1/@appdata/headscale"
      # 不再需要 /var/run/docker.sock
    environment:
      - "TZ=Asia/Shanghai"
      - "HEADPLANE_SERVER__HOST=192.168.1.10"
      - "HEADPLANE_SERVER__PORT=4100"
      - "HEADPLANE_HEADSCALE__CONFIG_PATH=/vol1/@appdata/headscale/config.yaml"
      - "HEADPLANE_INTEGRATION__DOCKER__ENABLED=false"
      - "HEADPLANE_INTEGRATION__PROC__ENABLED=true"
      - "HEADPLANE_INTEGRATION__PROC__ALLOW_RESTART=false"
```

为什么要 `pid: host` 和 `apparmor=unconfined`：proc 集成靠读 `/proc` 找到 `headscale serve` 这个
进程，再给它发 SIGHUP 重载 ACL。而 Docker 默认的 AppArmor 配置只允许向**同一配置**的进程发信号，
给原生进程（unconfined）发信号会被拒绝：

```text
Failed to send SIGHUP to PID ...: Error: kill EACCES
```

::: warning 「重启 Headscale」按钮要有监管进程才安全
`HEADPLANE_INTEGRATION__PROC__ALLOW_RESTART` 控制界面上的「重启 Headscale」按钮，只有在 Headscale
由**监管进程**托管时才安全：fnOS 应用中心（这条路就是）、systemd、s6 等 —— 进程被停掉后监管者会把它
拉起来。自己用 `./headscale serve &` 起的进程没有监管者，按一次就再也起不来；这种情况保持
`ALLOW_RESTART=false`，只重启面板本身。
:::

完整细节（原生模式的权限与监管要求）见 [fnOS 部署](/install/fnos) 与
[原生模式](/install/native-mode)。

### 4.5 验证

```bash
docker compose up -d
docker compose logs headplaneCN | grep -iE 'valid Headscale configuration|Found headscale serve'
# 期望：Found headscale serve (PID ...)
```

面板 **设置 → 系统**里集成显示 **原生进程**；保存配置后日志出现 `Sent SIGHUP to Headscale`。

## 五、迁移后验证

两个方向的验收是同一套：

```bash
cd /vol1/1000/APP/headplaneCN

# 1) 服务在跑：双镜像应是三个容器（不用 Caddy 时两个）；原生形态是一个容器 + 宿主机上的原生进程
docker compose ps
ps -ef | grep '[h]eadscale serve'

# 2) Headscale 活着
curl -s http://127.0.0.1:8480/health        # 期望 {"status":"pass"}

# 3) 数据真的搬过来了：能列出节点和用户
docker compose exec headscale headscale nodes list | head
docker compose exec headscale headscale users list

# 4) 面板认得配置（集成方式按形态不同）
docker compose logs headplaneCN | grep -iE 'valid Headscale configuration|Found headscale serve|Using Docker integration'

# 5) DERP 地图文件在容器里读得到，路径与 derp.paths 一致
docker compose exec headscale ls -l /vol1/1000/APP/headplaneCN/headscale/derp-maps/
```

- **面板能登录**：打开 `https://ha.example.com:8443/admin`，用原来的账号登录（`cookie_secret` 没换，
  会话通常还在）；**设置 → 系统**里的集成显示 **Docker**（双镜像）或 **原生进程**（原生）。
- **节点仍在线**：在任意一台客户端上执行 `tailscale status`，应直接显示已连接 ——
  **不需要** `tailscale up`，也不要重新注册。
- **`headscale nodes list`** 里有迁移前的全部节点（列表为空说明 `db.sqlite` 没搬对）。
- **`/health`** 返回 `{"status":"pass"}`。
- **DERP 地图可读**：面板 **设置 → Headscale → DERP** 的卡片路径与 `derp.paths` 指向同一个文件；
  客户端侧的决定性证据是 `tailscale debug derp-map | grep -A 12 -i <你的 region_code>`。

## 六、回退与排障

### 6.1 迁移失败：怎么退回去

**刚迁完就发现不对（还没在新形态里改过数据）**：原生目录本来就没动过，直接切回旧形态即可。

```bash
cd /vol1/1000/APP/headplaneCN
docker compose down
# 把 compose 换回备份的那份，再起栈
mv docker-compose.yml docker-compose.yml.failed-$(date +%Y%m%d-%H%M%S)
cp docker-compose.yml.bak-native-* docker-compose.yml
docker compose up -d
# 然后在 fnOS 应用中心启动 headscale（并恢复开机自启）
```

**已经在新形态里跑了一段时间**：旧目录里的数据已经过期，不要直接用 —— 先按第四节（4.1 → 4.3）
把**当前**数据搬回原生目录，再改面板集成。

反向迁移失败同理：双镜像的 `headscale/` 目录还在（4.2 也是复制），把双镜像那份 compose 换回来
`docker compose up -d`，再去 fnOS 应用中心停掉 headscale 并关掉开机自启。

### 6.2 升级后想退版本（与形态无关）

```bash
cd /vol1/1000/APP/headplaneCN

# 【必做】动 Headscale 之前先备份：数据库迁移是单向的
docker compose stop headscale
tar -czf backup/before-upgrade-$(date +%F-%H%M%S).tar.gz \
  --exclude=backup -C . headscale data config.yaml docker-compose.yml .env
docker compose start headscale

# 改 .env 里的版本号（两个可以只改一个），然后
docker compose pull
docker compose up -d
docker compose ps
docker compose exec headscale headscale version
```

- **HeadplaneCN 回滚**：把 `HEADPLANE_VERSION` 改回旧版本，`docker compose up -d` 即可。它的数据在
  自己的 `data/` 里，与 Headscale 版本无关。
- **Headscale 回滚**：把 `HEADSCALE_VERSION` 改回旧版本再 `up -d`；**如果新版本已经跑过数据库迁移，
  光换回镜像不够** —— 先 `docker compose down`，用备份里的 `db.sqlite` 覆盖 `headscale/db.sqlite`
  （连同 `-wal` / `-shm` 一起删掉再覆盖），再 `up -d`。
- 官方升级规则：**逐个次版本**升（0.26 → 0.27 → 0.28 → 0.29），不能跳版本；0.29 起要求客户端
  ≥ v1.80.0。
- 固定在 `.env` 里的版本号就是「锁版本」：不要为了让 `latest` 自动升级而放弃它。

### 6.3 常见症状 → 原因 → 解决

| 症状                                                                                                      | 原因                                                                                | 解决                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 面板容器一直 `unhealthy`，日志 `dial tcp 127.0.0.1:4100: connect: connection refused`                     | 面板自带的探针固定探 `127.0.0.1`，而 `server.host` 绑的是具体 IP（`192.168.1.10`）  | 用镜像里的 node 探真实地址：`fetch('http://192.168.1.10:4100/admin/healthz')`，改完 `docker compose up -d`                           |
| 保存配置报 `Failed to send SIGHUP to PID ...: Error: kill EACCES`                                         | 回退到原生后漏了 `security_opt: ["apparmor=unconfined"]`（或漏了 `pid: host`）      | 按 4.4 补上这两项，再 `docker compose up -d`                                                                                         |
| Headscale 启动或重载时直接退出：`getting DERPMap: open .../derp-maps/xxx.yaml: no such file or directory` | `derp.paths` 里的文件不存在，或与面板 DERP 卡片里的路径不一致，或那个目录没挂进容器 | 先让它能起来：把 `derp.paths` 那一行注释掉，或用 **设置 → 快照** 回滚；再按「先在宿主目录建文件 → 确认挂载 → 写进 `derp.paths`」重做 |
| 「官方区域筛选」提示「无法读取 `/vol1/@appdata/headscale/derp-maps/...`」                                 | 面板数据文件里存的还是老的原生路径，而双镜像容器没有挂 `/vol1/@appdata`             | 在卡片里改成新路径并保存；或改 `data/derp-region-mirror.json` 后 `docker compose restart headplaneCN`                                |
| 容器里执行 `sh` 失败：`Headplane containers do not contain a shell by default.`                           | 发布镜像没有 shell                                                                  | 用镜像里的 node 排查：`docker compose exec headplaneCN /nodejs/bin/node -e "..."`；或临时换 `:<版本>-shell` 变体镜像                 |
| 改完配置 Headscale 拒绝启动，日志 `unknown key` / `cannot unmarshal`                                      | YAML 里的键名写错了                                                                 | `docker compose exec headscale headscale configtest`（只校验不启动），再逐字对照[双镜像部署](/install/dual-image)里的完整配置        |
| 客户端一直不上线                                                                                          | 见下面的排查表                                                                      |                                                                                                                                      |

客户端一直不上线，按可能性从高到低查：

| 检查                    | 命令 / 位置                                                                | 结论                                                                                      |
| ----------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `server_url` 有没有被改 | `docker compose exec headscale grep server_url /etc/headscale/config.yaml` | 必须与迁移前逐字一致；改过就得把每个节点重新注册                                          |
| noise 私钥是否搬过来    | `docker compose exec headscale ls -l ${BASE_DIR}/headscale/`               | 私钥被重新生成时已注册节点全部无法通信，必须从备份恢复                                    |
| 数据库是否搬对          | `docker compose exec headscale headscale nodes list`                       | 列表为空说明 `db.sqlite` 没搬对或指向了别的路径                                           |
| 端口被原生进程占用      | `ss -lntup \| grep 8480`                                                   | 应用中心里的 headscale 还在跑：停掉它并关掉开机自启                                       |
| 域名与证书、反代行为    | 外网机器上 `curl -sI https://ha.example.com:8443/health`                   | 证书必须受客户端信任、域名必须与 `server_url` 一致；`/ts2021` 不能被缓冲或降级到 HTTP/1.1 |

其它症状（保存报 `Unexpected Server Error`、`403 Policy is not writable` 等）见
[常见问题](/configuration/common-issues)。

## 七、命令速查

```bash
# ---- 备份（两个方向都先做这个）----
cd /vol1/1000/APP/headplaneCN
sudo tar -czf backup/native-headscale-$(date +%Y%m%d-%H%M%S).tar.gz \
  --exclude=headscale/headscale.log -C /vol1/@appdata headscale
sudo tar -czf backup/headplane-$(date +%Y%m%d-%H%M%S).tar.gz -C . data config.yaml

# ---- 原生 → 双镜像 ----
cd /vol1/1000/APP/headplaneCN
mkdir -p data backup headscale/derp-maps caddy/{data,config}
sudo cp -a /vol1/@appdata/headscale/. headscale/
ls -ln headscale | head                  # 属主 → .env 的 HEADSCALE_UID/GID
docker compose config --quiet
docker compose up -d
docker compose ps                        # 期望：三个服务都 Up (healthy)（不用 Caddy 时是两个）

# ---- 双镜像 → 原生 ----
cd /vol1/1000/APP/headplaneCN
docker compose down
sudo cp -a headscale/. /vol1/@appdata/headscale/
sudo chown -R "$(id -u headscale):$(id -g headscale)" /vol1/@appdata/headscale
# 再把 config.yaml 里的绝对路径改回 /vol1/@appdata/headscale/...，然后：
# fnOS 应用中心 → headscale → 启动

# ---- 验证 ----
docker compose exec headscale headscale nodes list | head
docker compose exec headscale headscale users list
curl -s http://127.0.0.1:8480/health      # 期望 {"status":"pass"}
docker compose logs headplaneCN | grep -iE 'valid Headscale configuration|Found headscale serve|Using Docker integration'

# ---- 升级与版本回滚 ----
docker compose stop headscale
tar -czf backup/before-upgrade-$(date +%F-%H%M%S).tar.gz \
  --exclude=backup -C . headscale data config.yaml docker-compose.yml .env
docker compose start headscale
# 改 .env 里的 HEADSCALE_VERSION / HEADPLANE_VERSION，然后：
docker compose pull && docker compose up -d
```
