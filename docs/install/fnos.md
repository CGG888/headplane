---
title: fnOS（飞牛）
description: 在飞牛 fnOS 上用第三方应用源安装 headscale，再用 Docker 部署 HeadplaneCN。
outline: [2, 3]
---

# fnOS（飞牛）部署指南

这份指南按「**headscale 用第三方应用源的 fpk 包原生运行 + HeadplaneCN 用 Docker 运行 + Lucky 反向代理**」
这套部署方式编写，包含两份可直接使用的设置文件（HeadplaneCN 的 `config.yaml` 与
`docker-compose.yml`），以及全部常见问题的排查方法。

::: tip 环境对应关系

- Headscale：fnOS 应用中心（**第三方源**）安装的 fpk 包，**原生进程**（不是 Docker 容器）
- HeadplaneCN：Docker 容器，本指南用 host 网络、监听 `4100`
- 反向代理：Lucky（可以和 HeadplaneCN 不在同一台机器上）
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
- HeadplaneCN 镜像：`ghcr.io/cgg888/headplanecn`（本仓库），国内可用加速前缀，例如
  `v6.gh-proxy.org/docker/ghcr.io/cgg888/headplanecn:latest`
- 建议版本 **0.16.0 或更高**：设置页已是「分段式 Tab + 展开/折叠卡片」，并包含 DERP 面板、
  操作审计、配置快照与配置检查；**0.8.4 是反代环境的最低要求**（它修复了「保存/切换时报
  `Unexpected Server Error`」这一关键问题，见文末常见问题）
- 需要进容器排查时，用带 shell 的调试标签 `:<版本>-shell`（官方镜像是 distroless，见第七节）

## 一、先认清三个路径（最容易搞混）

| 路径                          | 角色                | 里面有什么                                                                                                          |
| ----------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `/vol1/@appcenter/headscale/` | **程序目录**        | `headscale`（可执行文件/CLI）、`bin/headscale-server`（启动脚本）、`config/config.yaml`（**种子模板**）、`ui/`      |
| `/vol1/@appdata/headscale/`   | **配置 + 数据目录** | `config.yaml`（**真正生效**）、`db.sqlite`、`noise_private.key`、`headscale.sock`、`headscale.pid`、`headscale.log` |
| `/vol1/1000/APP/headplane/`   | **HeadplaneCN 目录**  | `docker-compose.yml`、`config.yaml`、`data/`（本指南使用这个目录）                                                  |

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

## 三、生成 Headscale API Key（HeadplaneCN 服务端用）

```bash
cd /vol1/@appcenter/headscale
# 若提示权限不足，请以 root 执行（fnOS 的应用目录属于 root）
./headscale --config /vol1/@appdata/headscale/config.yaml apikeys create --expiration 3650d
```

- 输出形如 `hskey-api-xxxxxxxx...`，**只显示一次**，请立刻记录；
- `3650d` ≈ 10 年（Headscale 不支持"永不过期"，传 `0` 会得到立即过期的废 key）；
- 旧 key 泄漏后用 `apikeys list` 查前缀、`apikeys expire --prefix <前缀>` 撤销；
- 这把 key 要写进 HeadplaneCN 的 `headscale.api_key`，是**服务端**凭据：Agent 同步、OIDC 会话、
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

::: danger 单独使用 `headscale.dns_records_path` 会让 HeadplaneCN 退出
HeadplaneCN 只有在 Headscale 配置里存在 `dns.extra_records_path` 时才允许你指定
`headscale.dns_records_path`。只配了后者、没配前者，启动日志会打印
`Using separate DNS config file but dns.extra_records_path is not set in Headscale config` 并直接退出。
两处要么都配，要么只让 HeadplaneCN 从 Headscale 配置自动读取。
:::

::: warning 关于 `policy.mode`

- `file`（默认）：ACL 由文件提供，Headscale 的策略 API **只读** → HeadplaneCN 保存时报
  `403 Policy is not writable`（HeadplaneCN 0.8.5 起会给出中文说明）
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

要点（与 HeadplaneCN 的 DERP 页提示一致）：

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

::: tip 中继地址集中在「设置 → Headscale → DERP → 自动同步」
`derp.server.ipv4` / `ipv6` 的同步计划、要同步哪个地址族、自动重载、外部 IPv6 回显，以及
探测面板（候选地址、来源、为什么选中或跳过）都在这个卡片里；「概览」页的中继卡片是**只读**的，
只显示结果地址（带复制按钮）、STUN、解析器与一行上次检查状态，并链接回设置卡片。

- **「检查」只预演、不写入**：跑完两个地址族的探测与比对后什么都不改；**「立即运行」**跑同一套
  检查，只写入真正变化的键（哪个族变了就只写那个键），写入前先留配置快照并记一条审计。
- **自动重载默认开启**：写入要让客户端看到就得重载，而重载会**短暂中断已连接的客户端**；
  什么都没变的运行不会重载。
- **探测结果就是权威值**：与 `derp.server.ipv4` / `ipv6` 不一致时同步会直接写入（手工指定也可以，
  但下次探测到别的值就会被覆盖）；探测失败（某个族取不到可用地址、写入失败或重载失败）会通过
  通知系统告警，没有变化的运行不会告警。
- **两个地址族取法不同**：**IPv4 取 `server_url` 主机名的 A 记录**（私有、CGNAT、回环与链路本地
  答复会被拒绝）；**IPv6 取宿主机自己的全局单播地址**（稳定地址优先于会轮换的隐私地址，域名
  AAAA 指到的那个优先；可选的**仅 IPv6 回显**在路由器转发或转换 IPv6 时是权威答案）。
:::

::: tip 中继地址：IPv4 看 DNS，IPv6 要看**宿主机自己**
`derp.server.ipv4` / `ipv6` 是 Headscale 公布给客户端的地址，两个地址族的取法不一样
（留空时由自动同步探测并写入，来源与判定见上面的自动同步卡片）：

- **IPv4**：留空时取 `server_url` 主机名的 **A 记录** —— 在 NAT 后面的机器本来也看不到自己的
  公网地址，DNS 的答案就是对的。
- **IPv6**：留空时优先取**宿主机自己的全局单播 IPv6 地址**（`network_mode: host` 下容器与
  宿主机共用网络命名空间，所以读得到），再与域名的 AAAA 对照；只有对照不上时才把 DNS 的答案
  作为**兜底**显示，并标为「未验证」。IPv6 没有 NAT，公网地址就在机器自己身上；而域名上的
  AAAA 可能是临时隐私地址、换过前缀的旧记录，甚至是另一台机器 —— 公布错了客户端会时通时断。

先用 `ip -6 addr show scope global` 看一眼宿主机有没有公网 IPv6：

- **有**：自建中继的 IPv6 就该是它；域名 AAAA 与它不一致时设置卡片会给出黄色警告，卡片上的
  复制按钮可以把这个地址直接粘进 `derp.server.ipv6`。
- **没有**：不要指望解析出地址 —— 要么在 `derp.server.ipv6` 里自己声明一个，要么修 DNS。
  判断地址能不能算「宿主机的」看的是**有没有一块真实网卡（device）持有全局地址**；运行 Docker
  的宿主机必然有 `docker0`、`br-*`、`veth*`，它们**不**代表容器有自己的网络命名空间。找不到
  这样的网卡时，页面会把候选连同原因列出来，并把 DNS 的答案标成「未验证」，不会当成宿主机地址。

完整判定规则见 [地址自动同步](/features/headscale-settings#地址自动同步) 与
[中继地址是从哪里来的](/features/headscale-settings#中继地址是从哪里来的)。
:::

### 可选：在线编辑本地 DERP 地图（`derp.paths`）

除了内嵌服务器，Headscale 还能把磁盘上的 DERP 地图文件合并进它下发给客户端的地图。

::: danger `derp.paths` 里必须写**宿主机路径**，容器挂载点要与它**完全相同**
这份清单是 **Headscale** 读的；fnOS 上的 Headscale 是**宿主机原生进程**（不是容器），
它只认宿主机上的绝对路径。HeadplaneCN 在容器里，只有把**同一个宿主机目录挂到容器内的同一个
绝对路径**，它才看得到、也才改得动同一个文件：

```yaml
# ① headscale 的配置（/vol1/@appdata/headscale/config.yaml）：写宿主机路径
derp:
  paths:
    - /vol1/@appdata/headscale/derp-maps/home.yaml
```

```yaml
# ② Headplane 的 compose：宿主目录 : 容器内完全相同的路径（读写）
volumes:
  - "/vol1/@appdata/headscale/derp-maps:/vol1/@appdata/headscale/derp-maps"
```

把容器内的挂载点写成 `/etc/headscale/derp-maps` 这类**容器专用路径**时，HeadplaneCN 自己仍然
能编辑（它改的是容器里那一份），但**宿主机上的 Headscale 看不到这个路径**，它下次重载或
重启时会直接退出：

```
Error: headscale ran into an error and had to shut down:
getting DERPMap: open /etc/headscale/derp-maps/derp.yaml: no such file or directory
```

恢复办法见第十三节第 17 条。
:::

正确顺序一共四步，别跳：

1. **先在宿主机上建好目录和文件**（权限要给运行 headscale 的用户可读写）：

   ```bash
   mkdir -p /vol1/@appdata/headscale/derp-maps
   printf 'regions: {}\n' > /vol1/@appdata/headscale/derp-maps/home.yaml
   ```

   先用一份空的 `regions: {}` 占位即可，稍后可以在 HeadplaneCN 里用「用示例创建」覆盖它；
   关键是**文件必须先存在**：`derp.paths` 一旦写进配置，重载或重启时 Headscale 就要能打开它。

2. **把这个目录按原路径读写挂进容器**（第七节 compose 的 `volumes`，容器内路径与宿主机逐字相同）：

   ```yaml
     - "/vol1/@appdata/headscale/derp-maps:/vol1/@appdata/headscale/derp-maps"
   ```

   然后 `docker compose up -d` 重建容器。Docker 以**更具体**的挂载点为准，所以这份挂载会
   盖过第七节那份整目录的 `:ro`，对 `derp-maps` 以读写生效；如果保存仍提示无法写入，先确认
   这一行确实加到 `volumes` 里了。挂成只读时「查看」仍可用，但保存会失败。

3. **在 HeadplaneCN 里把宿主机路径加进 `derp.paths`**：DERP 卡片的新增路径输入框要填
   **Headscale 主机上的绝对路径**（也可以直接编辑 `/vol1/@appdata/headscale/config.yaml`），
   保存后配置里就是上面 ① 的样子。填成容器专用路径，就是上面那个启动失败。

4. **重载或重启 Headscale**（`/settings/system` 的按钮，或重启 fnOS 应用中心的 headscale）。
   它是**启动时**读取这些文件的，不重载就不会生效。

DERP 页会把 `derp.paths` 里的每个路径列出来，并支持**查看 / 编辑 / 保存 / 回滚**，
还能用「用示例创建」生成一份带中文注释的模板（一个区域一个节点、两个区域其中一个仅
提供 STUN、以及一份注释骨架）。每一行都会给出该路径的逐项检查：文件是否存在、是否可读、
是否可写、YAML 能否解析、是不是有效的 DERP 地图、区域 ID 与区域代码是否唯一。容器
**既看不到也写不了**的路径显示为「无法检查」，而不是把保存失败悄悄咽下去。

保存前 HeadplaneCN 会在服务端再校验一次：必须是合法的 YAML、必须是一份 `regions` 映射、
区域必须有 `regionid`/`regioncode`/`regionname`/`nodes`、区域 ID 与代码不能重复、节点必须有
`name`/`regionid`/`hostname`，端口与地址也要合法。每次写入前都会先留一份快照，可在
`/settings/snapshots` 里看到并恢复。

### 可选：只保留官方区域（「官方区域节点筛选」卡片）

不想自己维护地图文件、又嫌 Tailscale 官方区域太多而且名字是英文时，用**设置 → Headscale →
DERP** 里「自动同步」正下方的**官方区域节点筛选**卡片（默认折叠，摘要形如
「N 个官方区域 · 已选 M 个 · 文件路径」）。

它镜像的是 **Tailscale 官方的公开 DERP 区域**（不是你自己的节点），只保留你勾选的区域，
统一改号到 900 段，写进一份本地地图文件交给 Headscale 分发给客户端：

- **901 永远是香港、902 永远是新加坡**（这两个勾选框不能取消），其余勾选的区域从 **903**
  起按实测延迟升序编号；延迟相同则官方 id 小的在前。
- 编号是**粘性的**：一旦定下来，后续运行不会因为某次延迟波动就换号，客户端选路因此稳定；
  只有点「重新编号」才会全部重排（对话框会提示客户端可能短暂重选中继）。
- 设置项：启用开关（默认关）、目标文件路径（默认
  `/vol1/@appdata/headscale/derp-maps/official-mirror.yaml`，**必须是宿主机上的绝对路径**，
  且该目录要以读写方式挂进容器）、刷新间隔（6 / 12 / 24 小时，默认 24）、写入后自动重载
  （默认开；重载会短暂中断在线客户端）。
- 四个按钮：**保存**写设置；**检查**只抓取、过滤、比较，**什么都不写**（不留快照、不重载、
  不发通知、也不改动已存编号）；**立即更新**写入真正变化的内容；**重新编号**丢弃已存编号
  后按当前测量重排一次。
- 这份文件由该任务维护，**手工修改会被覆盖**，请专门给它一个文件（不要指向手动维护的地图）。
- 写不进去时**不会**动磁盘上原有的文件，卡片会说明原因（没有勾选区域、官方地图取不到、
  目标路径不是绝对路径或含 `..`、不可写、生成的地图没通过校验、重载失败等）；失败会通过
  「DERP 地址同步失败」这一通知事件推出去。

::: tip 官方地图是「wire 格式」，HeadplaneCN 现在两种写法都认
Tailscale 下发的官方地图用大写字段（`Regions`、`RegionID`、`HostName`、`IPv4`…），而
Headscale 的本地文件用小写（`regions`、`regionid`、`hostname`、`ipv4`）。同一个读取器两种都
接受并归一化，所以官方区域现在能正确解析出代码和名称；远程抓取有 **10 秒**超时，连接本身
失败（超时、被拒）会**重试一次**，而返回错误状态码或根本不是 DERP 地图时不重试。
:::

## 五、准备 HeadplaneCN 目录

```bash
mkdir -p /vol1/1000/APP/headplane/data
cd /vol1/1000/APP/headplane
openssl rand -base64 24        # 生成 32 字符 cookie_secret，记下来
```

## 六、设置文件 ①：HeadplaneCN 的 `config.yaml`

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
    # 国内可用加速前缀，例如 v6.gh-proxy.org/docker/ghcr.io/cgg888/headplanecn:latest
    # 需要进容器排查时，临时换成带 shell 的调试标签：ghcr.io/cgg888/headplanecn:0.16.0-shell
    image: ghcr.io/cgg888/headplanecn:latest
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

      # 【可选】本地 DERP 地图目录（配合 headscale 的 derp.paths）
      # 【关键】容器内路径必须与宿主机逐字相同：derp.paths 里写的是宿主机路径，
      # 只有挂到同一个绝对路径，容器里的 Headplane 才看得到、也才改得动 Headscale 读的那份文件
      # 以读写方式挂（不要 :ro）；它比上面那份数据目录的只读挂载更具体，因此对 derp-maps 生效
      # 只挂这个目录就好，不要为了省事把整个数据目录改成读写
      # - "/vol1/@appdata/headscale/derp-maps:/vol1/@appdata/headscale/derp-maps"

      # 【不需要】docker.sock：headscale 是原生进程而非容器，docker 集成用不上；
      # 而且挂载它等于把宿主机 root 权限交给容器
      # - "/var/run/docker.sock:/var/run/docker.sock:ro"

    environment:
      - "TZ=Asia/Shanghai"
      # 监听地址用本机局域网 IP（Lucky 在另一台机器也能访问）；只想本机访问就改 127.0.0.1
      - "HEADPLANE_SERVER__HOST=192.0.2.10"
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
要进容器排查，请把 `image:` 临时换成调试标签 `ghcr.io/cgg888/headplanecn:0.16.0-shell`
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
curl -I http://192.0.2.10:4100/admin
```

浏览器打开 `http://192.0.2.10:4100/admin`，用第三节的 API Key 登录。
登录后导航栏应包含：**机器 / 用户 / 访问控制 / DNS / 设置**。

## 九、Lucky 反向代理要点

这里有**两条**反代链路，要求完全不同，别混在一起：

| 链路          | 前端                                                          | 后端                       | 关注点                                            |
| ------------- | ------------------------------------------------------------- | -------------------------- | ------------------------------------------------- |
| **HeadplaneCN** | `https://headplane.example.com`                               | `http://192.0.2.10:4100` | `base_url`、跨站校验、WebSocket（浏览器 SSH）     |
| **Headscale** | `https://headscale.example.com`（自建 DERP 时通常带 `:8443`） | `http://192.0.2.10:8480` | **原样透传路径**、放行 HTTP Upgrade、关闭响应缓冲 |

### 9.1 HeadplaneCN 的反代

| 项目                        | 要求                                                                                      |
| --------------------------- | ----------------------------------------------------------------------------------------- |
| **保留原始 Host**           | 建议让后端看到的 `Host` 就是浏览器访问的域名；若 Lucky 改写成内网 IP，就会出现下面问题 1  |
| **`server.base_url`**       | 必须与浏览器地址完全一致（协议 + 域名 + 端口），否则保存类操作会被判定为跨站              |
| **WebSocket**（浏览器 SSH） | 转发 `Upgrade: websocket`、`Connection: Upgrade`，`Sec-WebSocket-Protocol` 原样透传       |
| **CORS**（浏览器 SSH）      | HeadplaneCN 与 Headscale 不同源时，Headscale 侧需返回 `Access-Control-Allow-Origin`（见下） |

Headscale 侧（不同源时）需要补充的响应头：

```
Access-Control-Allow-Origin:  https://headplane.example.com
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type, Upgrade, Sec-WebSocket-Protocol
```

### 9.2 Headscale 的反代（启用自建内嵌 DERP 时必需）

内嵌 DERP 与 Headscale 的控制服务**共用同一个 HTTPS 端点**，走的是 `/derp` 路径上的**长连接升级**。所以这一步的目标**不是"新增一条 `/derp` 规则"**，而是**别把路径吃掉**：

1. **前端**：`headscale.example.com`，监听你实际对外的端口（如 8443），挂上证书
2. **后端**：`http://192.0.2.10:8480`
   - ⚠️ 只填 `主机:端口`，**不要**在后面补 `/` 或任何路径
3. **匹配路径 / 子规则**：**留空**，或 `/*`
   - ❌ 不要只填 `/api`、`/ts2021`、`/health` —— 这正是"只转发了 API 和控制路径"的典型症状，`/derp` 会 404
4. **路径替换 / URL 重写 / 前缀重写**：全部**关闭**（一旦重写，`/derp` 会被改写或去掉）
5. **WebSocket / Upgrade**：有开关就打开；Lucky 一般会自动透传 `Connection: Upgrade`
6. **超时与缓冲**：读/写超时调大到 **300 秒以上**，并**关闭响应缓冲/压缩改写**（DERP 是长连接，缓冲会把它切断）
7. **Host 头**：无所谓 —— Headscale 不做来源校验（这点和 HeadplaneCN 相反，只有 HeadplaneCN 需要 `base_url` 正确）
8. 若这条规则还兼着代理别的应用，用**子规则按域名/路径分流**，但必须保证 `/derp` 落在 Headscale 这一支

::: tip 一句话记法
Headscale 这条反代 = **透明管道**：不改路径、不缓冲、放行长连接。
:::

### 9.3 STUN 的 UDP 3478 必须单独转发

HTTP 反向代理**转发不了 UDP**。DERP map 里公告的 STUN 端口是 `udp/3478`，客户端会往 `headscale.example.com:3478/udp` 发包，所以要在 **Lucky 所在机器（或路由器）**上做端口转发：

```
udp/3478  →  192.0.2.10:3478/udp        # 指向运行 headscale 的那台 fnOS
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
| `/settings/headscale` | OIDC 全量配置、可信代理、策略模式（file/database）、节点有效期 / 临时节点回收 / 日志级别与格式 / Taildrop / 自动更新 / logtail / 更新检查，以及 **DERP**（自定义 map、内嵌服务器预设、区域名称映射、连通性提示、由 `server_url` 推导的公开中继端口、**地址自动同步**（计划、地址族、自动重载、外部 IPv6 回显、探测面板，「检查」预演 / 「立即运行」写入）、以及 `derp.paths` 本地地图的**在线查看 / 编辑 / 保存 / 回滚 / 用示例创建**（路径按宿主机绝对路径填写，容器要按同一路径挂载；每行给出存在 / 可读 / 可写 / YAML / 结构 / 唯一性检查） |
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
| **DNS 记录即时生效**   | headscale 用 `dns.extra_records_path` + 把该文件挂给 HeadplaneCN                                                      |
| **在线编辑 DERP 地图** | headscale 的 `derp.paths` 里写**宿主机路径** + 把该目录按**相同绝对路径读写**挂给 HeadplaneCN（见第四节）；保存后需重载/重启 headscale 才生效 |
| **版本 / OS / 中继列** | `integration.agent.enabled: true`（本指南已开）+ 有效 `headscale.api_key`；机器详情页的中继（DERP）面板也来自它     |
| **配置快照 / 审计**    | 默认可用（`config_path` 可读后可写快照；快照与审计数据存在 `data_path` 里，务必持久化）                             |
| **浏览器 SSH**         | Agent + 目标节点 `tailscale up --ssh` + **HeadplaneCN 用 OIDC 登录**（API Key 登录不支持）                            |
| VNC / RDP              | ❌ HeadplaneCN 不含此功能；可另配 [headscale-console](https://github.com/rickli-cloud/headscale-console) 或 Guacamole |

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

**原因**：HeadplaneCN 读不到 headscale 的配置文件（`readable()` 为 false）。
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

**原因**：HeadplaneCN 只挂了 `config.yaml`，没挂它指向的目录；或者按第七节用了只读挂载。
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

### 15. 客户端连通性显示「IPv6: 否」，或中继解析不到 IPv6 地址

这是两件不同的事，先分清再动手。

**一、机器详情页的「客户端连通性 → IPv6: 否」**

这个值来自**该机器自身**的 Tailscale 连通性自检（`WorkingIPv6`），说的是这台机器
所在网络能不能用 IPv6，与 Headscale 无关 —— 在 Headscale 侧怎么改都不会变。要处理
就在那台机器的网络上处理：

- ISP / 路由器是否下发 IPv6 前缀（PD）、光猫是否桥接；
- 系统网卡是否启用 IPv6（`ip -6 addr` 能看到全局地址）；
- 防火墙 / 安全组是否放行 IPv6。

如果该网络本来就只有 IPv4，保持「否」完全正常：tailnet 内部给设备分配的 Tailscale
IPv6 地址（`fd7a:…`）照常可用，机器之间仍能用 IPv6 互访。

**二、中继卡片里 IPv6 一栏解析不出地址**

IPv6 一栏优先显示**宿主机自己的全局地址**（见第四节自建内嵌 DERP 中继里的提示），所以这一栏为空，通常说明
宿主机没有公网 IPv6（`ip -6 addr show scope global` 没有输出），**并且** `server_url` 里的
主机名也没有 AAAA 记录 —— 两者都没有，客户端完全无法通过 IPv6 连接自建中继，不是「慢」，
而是根本用不了。先确认：

```bash
dig +short AAAA headscale.example.com            # 本机解析器：无输出 = 它认为没有 AAAA
dig @1.1.1.1 +short AAAA headscale.example.com   # 公共解析器：有输出 = 记录其实存在
```

**两边都要查**。本机解析器可能在名称确有 AAAA 记录时仍返回空结果（不响应 AAAA 查询、
上游只转发 A、或有 DNS 过滤）。如果公共解析器查得到而本机查不到，问题在 DNS 而不在
Headscale：可以改宿主机／路由器的 DNS，也可以直接在 HeadplaneCN 里设置用于解析的 DNS
服务器（留空=跟随宿主）并点「重新解析」，这样不必改宿主的 DNS —— 该项只用于中继解析，
不影响 HeadplaneCN 的其他解析。

确认之后再二选一：

- **要 IPv6**：给该主机名补一条 AAAA 记录（或用上面的办法让本机解析器能查到它），指向
  运行 Headscale／中继的那台机器（也就是 Lucky 回源的地址）；这条记录要与**宿主机自己的
  全局 IPv6 地址**一致（不一致时 DERP 页会给出黄色警告），只是给别处的地址打掩护没有意义；
  同时确认 `listen_addr` 与 `derp.server.stun_listen_addr` 是双栈（例如 `listen_addr: "::"`、
  `stun_listen_addr: "[::]:3478"`），否则即使解析到了地址，中继与 STUN 仍然只监听
  IPv4。
- **只跑 IPv4**：接受 IPv4-only，并清空 `derp.server.ipv6`，这个提示就不会再出现。

HeadplaneCN 的解析结果（包括「没有记录」这类否定结果）**会缓存五分钟**：改完 DNS 后如果
中继卡片仍显示没有记录，点中继设置里的「重新解析」即可立刻清掉缓存并重新查询，不必等
满五分钟，也不必重启 HeadplaneCN。`设置 → 系统` 里的「内嵌中继 IPv4 / IPv6」检查项给出
同样的判定，中继卡片上的提示也会写出对应的 `dig` 命令。`derp.server.ipv4` 对应的告警通常
意味着机器 IP 变过、声明的是旧地址。

### 16. 保存本地 DERP 地图时报「看不到该路径 / 无法写入」

**原因**：只挂了 `config.yaml`，没有把 `derp.paths` 指向的目录挂进容器；或者容器内的挂载点
写成了 `/etc/headscale/derp-maps` 这类**容器专用路径**；又或者这个目录挂成了只读。

**解决**：把**宿主机上的那个目录**按**同一个绝对路径**读写挂进容器，并在 `derp.paths` 里写
**宿主机路径**：

```yaml
# compose：宿主目录 : 容器内同一个绝对路径
volumes:
  - "/vol1/@appdata/headscale/derp-maps:/vol1/@appdata/headscale/derp-maps"
```

```yaml
# headscale 配置：路径与宿主机完全一致
derp:
  paths:
    - /vol1/@appdata/headscale/derp-maps/home.yaml
```

重建容器（`docker compose up -d`）后，DERP 页的该行会从「无法检查」变成真实的检查
结果。宿主机上注意权限：文件要对运行 headscale 的用户和容器都可读写。保存成功后
Headscale 需要**重载或重启**才会重新读取地图（它是启动时加载的），`/settings/system`
的重载按钮可用时直接点它即可。

### 17. Headscale 启动失败：`getting DERPMap: open /etc/headscale/derp-maps/derp.yaml: no such file or directory`

**原因**：`derp.paths` 里写的是**容器专用路径**（例如 `/etc/headscale/derp-maps/derp.yaml`），
或者宿主机上根本没有那个文件。这份清单由**宿主机上的 Headscale 原生进程**读取，容器里
存在的路径对它没有意义 —— 于是它在重载/重启时加载 DERP 地图失败并退出（HeadplaneCN 与
Headscale 是分开的，HeadplaneCN 容器不受影响）：

```
Error: headscale ran into an error and had to shut down:
getting DERPMap: open /etc/headscale/derp-maps/derp.yaml: no such file or directory
```

**恢复（两条路，二选一）**：

1. **把 `paths:` 那一条注释掉**，让 Headscale 先能起来。在宿主机上编辑
   `/vol1/@appdata/headscale/config.yaml`：

   ```yaml
   derp:
     # paths:
     #   - /etc/headscale/derp-maps/derp.yaml
   ```

   也可以在 HeadplaneCN 的 DERP 卡片里把这条路径「移除」，保存后会写回同一份配置；改完重启
   fnOS 应用中心的 headscale。

2. **回滚到写入前的配置快照**：HeadplaneCN 每次写 Headscale 配置前都会自动留一份快照，
   在 `/settings/snapshots` 里挑写入之前的那份点「恢复」，它会把 `config.yaml`（文件模式下
   还有策略文件）写回去，再重启 headscale 即可。

起来之后按第四节重做一遍，顺序别反：**先在宿主机上建目录和文件 → 按相同绝对路径读写挂进
容器 → 再把宿主机路径写进 `derp.paths` → 保存后重载/重启**。清单里的路径必须是宿主机上真实
存在的绝对路径，容器专用路径只能骗过 HeadplaneCN 自己。

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
curl -sI http://192.0.2.10:4100/admin | head -n 1
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
- [ ] 按宿主机的**相同绝对路径**挂好 DERP 地图目录（读写）后，`/settings/headscale` 的本地地图行
      不再是「无法检查」，能「查看 / 编辑」，保存成功并提示「重载或重启后生效」，且
      `/settings/snapshots` 里出现一份 `DERP map file: …` 快照，点「回滚」能恢复上一份内容

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
