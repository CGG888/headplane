---
title: fnOS（飞牛）
description: 在飞牛 fnOS 上用 Docker 部署 Headplane，headscale 以 fpk 原生方式运行。
outline: [2, 3]
---

# fnOS（飞牛）部署指南

这份指南按「**headscale 用 fpk 应用原生运行 + Headplane 用 Docker 运行 + Lucky 反向代理**」
这套部署方式编写，包含两份可直接使用的设置文件（Headplane 的 `config.yaml` 与
`docker-compose.yml`），以及全部常见问题的排查方法。

::: tip 环境对应关系

- Headscale：fnOS 应用中心安装的 fpk 包，**原生进程**（不是 Docker 容器）
- Headplane：Docker 容器，本指南用 host 网络、监听 `4100`
- 反向代理：Lucky（可以和 Headplane 不在同一台机器上）
  :::

## 先决条件

- fnOS 已安装并运行 headscale（应用中心里的 fpk 包），版本建议 **0.29.2 或更高**
  （0.29.0 beta ~ 0.29.1 的浏览器 SSH 有 WebSocket 回归）
- 已安装 Docker / Docker Compose（fnOS 自带）
- Headplane 镜像：`ghcr.io/cgg888/headplane`（本仓库），国内可用加速前缀，例如
  `v6.gh-proxy.org/docker/ghcr.io/cgg888/headplane:latest`
- 建议版本 **0.8.4 或更高**：它修复了「保存/切换时报 `Unexpected Server Error`」
  这一反代环境下的关键问题（见文末常见问题）

## 一、先认清三个路径（最容易搞混）

| 路径                          | 角色                | 里面有什么                                                                                                    |
| ----------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------- |
| `/vol1/@appcenter/headscale/` | **程序目录**        | `headscale`（可执行文件）、`bin/headscale-server`（启动脚本）、`config/config.yaml`（**种子模板**）、`ui/`    |
| `/vol1/@appdata/headscale/`   | **配置 + 数据目录** | `config.yaml`（**真正生效**）、`db.sqlite(+ -shm/-wal)`、`noise_private.key`、`private.key`、`headscale.sock` |
| `/vol1/1000/APP/headplane/`   | **Headplane 目录**  | `docker-compose.yml`、`config.yaml`、`data/`（本指南使用这个目录）                                            |

**为什么生效的是 `@appdata` 那份？** fnOS 的启动脚本 `@appcenter/headscale/bin/headscale-server` 是这样写的：

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
- ⚠️ 在 `@appdata/headscale` 下执行 `./headscale` 会报 `No such file or directory` —— 二进制在 `@appcenter`

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

## 三、生成 Headscale API Key（Headplane 登录用）

```bash
cd /vol1/@appcenter/headscale
./headscale --config /vol1/@appdata/headscale/config.yaml apikeys create --expiration 3650d
```

- 输出形如 `hskey-api-xxxxxxxx...`，**只显示一次**，请立刻记录；
- `3650d` ≈ 10 年（Headscale 不支持"永不过期"，传 `0` 会得到立即过期的废 key）；
- 旧 key 泄漏后用 `apikeys list` 查前缀、`apikeys expire --prefix <前缀>` 撤销。

## 四、按需要调整 headscale 配置

编辑**生效的那份**：`/vol1/@appdata/headscale/config.yaml`

```yaml
# 客户端实际连接的地址（Lucky 对外暴露的地址或局域网地址）
server_url: https://headscale.example.com

listen_addr: 0.0.0.0:8480

# 让 Headplane 能在网页里保存 ACL（必须重启 headscale 才生效）
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

::: warning 关于 `policy.mode`

- `file`（默认）：ACL 由文件提供，Headscale 的策略 API **只读** → Headplane 保存时报
  `403 Policy is not writable`（Headplane 0.8.5 起会给出中文说明）
- `database`：策略存进 Headscale 数据库，**Web 界面可以编辑** —— 想用网页改 ACL 就必须选它
- 切换不会影响现有连通性：原文件模式下 `policy.path: ""` 相当于没有策略，数据库初始也是空策略（默认允许全部）
  :::

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

  # 【必改】32 字符随机串：openssl rand -base64 24
  cookie_secret: "请替换为你的32位随机串"

  # 走 HTTPS 反代 → true；纯 HTTP 访问 → false
  cookie_secure: true
  cookie_max_age: 86400

  # Headplane 自身数据目录（已在 compose 中持久化到 ./data）
  data_path: "/var/lib/headplane"

headscale:
  # host 网络下，容器内的 127.0.0.1 就是宿主机
  url: "http://127.0.0.1:8480"

  # 【必改】第三步生成的 API Key
  api_key: "hskey-api-..."

  # 【必填】容器内 headscale 生效配置的路径（与 compose 挂载点一致）
  #   这是 DNS / 设置 两个页面能否出现的唯一条件
  config_path: "/etc/headscale/config.yaml"

  # 可选：与 headscale 的 dns.extra_records_path 指向同一个文件（改 DNS 记录无需重启）
  # dns_records_path: "/etc/headscale/extra-records.json"

integration:
  # headscale 是 fpk 原生进程 → 用"原生进程"集成：
  # 保存配置后 Headplane 会向 headscale serve 发送 SIGHUP
  # 前置：容器必须 pid: host（见 compose）
  proc:
    enabled: true

  # Headplane Agent：同步节点版本/OS 等详情，也是"浏览器 SSH"的基础
  # 要求 headscale ≥ 0.28（0.29.x 满足）；agent 状态持久化在 /var/lib/headplane/agent
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

## 七、设置文件 ②：`docker-compose.yml`

路径：`/vol1/1000/APP/headplane/docker-compose.yml`

```yaml
services:
  headplane:
    # 国内可用加速前缀，例如 v6.gh-proxy.org/docker/ghcr.io/cgg888/headplane:latest
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

      # Headplane 持久化数据（会话、内部数据库、agent 状态）
      - "/vol1/1000/APP/headplane/data:/var/lib/headplane"

      # 【关键】headscale 的生效配置 —— 必须读写，不能 :ro
      # 有它才会出现 DNS / 设置 入口，并且能保存
      - "/vol1/@appdata/headscale/config.yaml:/etc/headscale/config.yaml"

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
      # 同步节点详情 / 浏览器 SSH 的基础
      - "HEADPLANE_INTEGRATION__AGENT__ENABLED=true"
      # 与 extra-records 挂载配套
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
`HEADPLANE_*` 环境变量会覆盖（或补充）`config.yaml`，所以集成开关可以集中在 compose 里；
`config.yaml` 里同时写也不会冲突（值相同）。数组型配置项（如 `allowed_action_origins`）
**不支持**环境变量，只能写在 `config.yaml` 里。
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
# 3) agent 是否连上 Tailnet
docker compose logs headplane | grep -iE 'Agent|Tailnet'
#    期望：Connecting to Tailnet at http://127.0.0.1:8480 as headplane-agent
# 4) 本地访问
curl -I http://192.168.1.10:4100/admin
```

浏览器打开 `http://192.168.1.10:4100/admin`，用第三步的 API Key 登录。
登录后导航栏应包含：**机器 / 用户 / 访问控制 / DNS / 设置**。

## 九、Lucky 反向代理要点

Lucky 与 Headplane 不在同一台机器时，反代目标填 `http://<NAS_IP>:4100`。

| 项目                        | 要求                                                                                      |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| **保留原始 Host**           | 建议让后端看到的 `Host` 就是浏览器访问的域名；若 Lucky 改写成内网 IP，就会出现下面问题 5  |
| **`server.base_url`**       | 必须与浏览器地址完全一致（协议 + 域名 + 端口），否则保存类操作会被判定为跨站              |
| **WebSocket**（浏览器 SSH） | 转发 `Upgrade: websocket`、`Connection: Upgrade`，`Sec-WebSocket-Protocol` 原样透传       |
| **CORS**（浏览器 SSH）      | Headplane 与 Headscale 不同源时，Headscale 侧需返回 `Access-Control-Allow-Origin`（见下） |

Headscale 侧（不同源时）需要补充的响应头：

```
Access-Control-Allow-Origin:  https://headplane.example.com
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, Upgrade, Sec-WebSocket-Protocol
```

## 十、功能开启清单

| 功能                   | 怎么开                                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------- |
| 中英繁切换             | 默认可用：登录后右上角**头像菜单**；登录页右上角地球按钮                                                            |
| 机器 / 用户管理        | 默认可用                                                                                                            |
| **ACL 编辑**           | headscale 配置 `policy.mode: database` 后**重启 headscale 应用**                                                    |
| **DNS / 设置可编辑**   | 本指南第六、七节（`config_path` + 读写挂载）；保存后由 `integration.proc` 发 SIGHUP 使其重载                        |
| **DNS 记录即时生效**   | headscale 用 `dns.extra_records_path` + 把该文件挂给 Headplane                                                      |
| **节点版本 / OS 详情** | `integration.agent.enabled: true`（本指南已开）                                                                     |
| **浏览器 SSH**         | Agent + 目标节点 `tailscale up --ssh` + **Headplane 用 OIDC 登录**（API Key 登录不支持）                            |
| VNC / RDP              | ❌ Headplane 不含此功能；可另配 [headscale-console](https://github.com/rickli-cloud/headscale-console) 或 Guacamole |

## 十一、升级、备份与卸载

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

## 十二、常见问题

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
docker compose exec headplane ls -l /etc/headscale/config.yaml
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

### 9. 浏览器 SSH 按钮点了报错

| 界面提示                                                          | 解决                                               |
| ----------------------------------------------------------------- | -------------------------------------------------- |
| `…only available when the Headplane agent integration is enabled` | 打开 `integration.agent.enabled`                   |
| `…only available when OIDC authentication is enabled.`            | 用 OIDC 登录（API Key 登录不支持浏览器 SSH）       |
| `You'll need to link your user account to a Headscale user`       | 在 Users 页面把 OIDC 用户关联到某个 Headscale 用户 |
| `No node found with hostname …`                                   | 目标节点执行 `tailscale up --ssh`，并确认主机名    |

## 十三、命令速查

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
docker compose exec headplane ls -l /etc/headscale/config.yaml

# ---- 现场核对 ----
ps -ef | grep '[h]eadscale serve'
curl -s http://127.0.0.1:8480/health
ss -lntp | grep -E '4100|8480'
```
