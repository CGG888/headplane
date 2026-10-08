---
title: DERP 与中继
description: 判断要不要自建 DERP，内嵌中继与官方区域镜像两条路线，地图文件的路径与挂载，中继地址同步与 STUN。
outline: [2, 3]
---

# DERP 与中继

Tailscale 的客户端之间**优先直连**；只有在打洞失败（双方都在 NAT 后面、防火墙太严、运营商
干扰 UDP）时，流量才会经过 **DERP 中继**转发。所以 DERP 是兜底，不是加速通道 —— 自建中继
不会让速度超过直连。

Headscale 自带 Tailscale 的**公开 DERP 地图**，所以你什么都不配也能用。这一页讲的是**部署与
文件路径**：什么时候需要自建、两种自建路线怎么选、`derp.paths` 的文件放在哪、容器要挂什么、
中继地址从哪来、STUN 怎么放行。面板上那些卡片长什么样、按钮叫什么、检查项有哪些，都在
[Headscale 设置 → DERP](/features/headscale-settings#derp) 里讲，本页不重复。

## 需要你改的值

| 占位符             | 示例                                                      | 说明                             | 在哪里改                       |
| ------------------ | --------------------------------------------------------- | -------------------------------- | ------------------------------ |
| Headscale 对外域名 | `ha.example.com`                                          | **必须改**成你自己的域名         | `server_url`                   |
| 中继端口           | `8443`                                                    | 可改（官方推荐 443）             | `server_url` 里带端口          |
| 内嵌区域 ID        | `999`                                                     | 可改，建议用 `900–999`           | `derp.server.region_id`        |
| 内嵌区域代码       | `headscale`                                               | 可改，客户端命令里用它           | `derp.server.region_code`      |
| 内嵌区域名称       | `Headscale Embedded DERP`                                 | 可改                             | `derp.server.region_name`      |
| 本地地图文件       | `/vol1/@appdata/headscale/derp-maps/home.yaml`            | **必须改**成宿主机上的绝对路径   | `derp.paths`                   |
| 官方区域镜像文件   | `/vol1/@appdata/headscale/derp-maps/official-mirror.yaml` | 可改（默认值）                   | 面板「官方区域节点筛选」卡片   |
| 双镜像数据目录     | `/vol1/1000/APP/headplaneCN/headscale`                    | 别动（compose 的 `BASE_DIR`）    | `docker-compose.yml`           |
| STUN 端口          | `udp/3478`                                                | 别动                             | `derp.server.stun_listen_addr` |
| Headscale 监听地址 | `127.0.0.1:8480`                                          | 别动（很多 fnOS 安装的历史端口） | `listen_addr`                  |

::: warning `server_url` 不能带路径，改了要重新注册
`server_url` 是客户端连接 Headscale 的地址，**必须带 `https://`、不能带路径前缀**。改动它
会让已注册节点需要重新登录一次（登录地址变了）。中继地址和端口都由它推导：域名取它的域名、
端口取它的端口、路径固定是 `/derp`。
:::

## 一、先判断你需不需要自建 DERP

**默认情况：不用管。** Headscale 会下发 Tailscale 的公开 DERP 地图，全球都有区域，客户端
自己挑最近的那个。

只有下面几种情况才值得动手：

- 公开区域在你这儿**连不上或者绕远**（常见于国内网络，延迟高、丢包多）；
- 你希望中继流量**走自己的机器**（审计、隐私、可控）；
- 你嫌公开区域**太多、名字是英文**，想只留下一小部分。

先分清两件**完全不同**的事，别混：

|                | 内嵌 DERP 中继（`derp.server`）    | 官方区域镜像（900 段编号）       |
| -------------- | ---------------------------------- | -------------------------------- |
| 你得到什么     | 一台**你自己的**中继服务器         | 一份**裁剪过的**公开区域地图文件 |
| 需要公网吗     | 需要（HTTPS + `udp/3478`）         | 不需要，只写一个本地文件         |
| 解决什么问题   | 公开区域不可用 / 想自己控流量      | 区域太多、名字看不懂             |
| 客户端看到什么 | 多一个区域（如 `headscale`）       | 官方区域，但编号是 901 起        |
| 维护成本       | 高：端口、证书、反代、防火墙都要对 | 低：面板里勾选即可               |

两条路线**可以同时用**，也可以都不用作（只加一份手写的本地地图文件）。判断标准很简单：
**先看公开区域到底通不通、延迟多少**，再决定要不要自己搭；能直连的链路永远优先于中继。

## 二、两条路线：自建内嵌 DERP / 用官方区域镜像

**路线 A：自建内嵌 DERP。** Headscale 自己就能当中继，不用另装 DERP 服务器。它和控制服务
**共用同一个 HTTPS 端点**，中继走 `/derp` 路径。你需要：

1. 一个公网能访问的地址，且**必须有有效 HTTPS 证书**（DERP 基于 TLS）；
2. 反向代理**原样转发 `/derp`**、放行 HTTP Upgrade、关闭缓冲、超时 ≥300 秒；
3. 路由器/防火墙把 `udp/3478`（STUN）**直接**放开到运行 Headscale 的机器。

配置写进 Headscale 的 `config.yaml`（见第三节），要点：

- **中继端口就是 `server_url` 里的端口**：写 `https://ha.example.com:8443`，客户端就连
  8443；不写端口就是 443。
- `private_key_path` 指向的文件**无需预先存在**：缺失时 Headscale 会自动生成，只要所在
  目录对 Headscale 可写、已存在的文件可读。
- `derp.urls: []` 之后，自建中继就是**唯一**中继：它不可达时客户端之间无法通过 DERP 互联。
  建议**先用一台客户端 `tailscale debug derp-map` 确认区域已经出现**，再清空公开地图。

**路线 B：官方区域镜像。** 不自己跑服务器，只在面板里勾选要保留的 Tailscale 公开区域，面板
把它们改号到 **900 段**写进一份本地地图文件，交给 Headscale 分发。它解决的是「区域太多、名字
是英文」，**不解决**「公开区域连不上」。细节见第六节。

两条路线都依赖同一件事：**Headscale 要能读到那份本地地图文件**，所以第三节的路径与挂载是
共同前提。

## 三、原生模式下的路径与配置

原生模式指 **Headscale 在宿主机上直接跑、HeadplaneCN 在容器里**（
[飞牛 fnOS 原生安装](/install/fnos) 就是这一种）。这时有一条铁律：

::: danger `derp.paths` 里必须写**宿主机路径**，容器挂载点要与它**完全相同**
这份清单是 **Headscale** 读的；它跑在宿主机上，只认宿主机上的绝对路径。HeadplaneCN 在容器
里，只有把**同一个宿主机目录挂到容器内的同一个绝对路径**，它才看得到、也才改得动同一个
文件。容器专用路径（比如 `/etc/headscale/derp-maps`）只能骗过 HeadplaneCN 自己 —— 宿主机上
的 Headscale 看不到它，下次重载或重启时会直接退出（见第十节）。
:::

### 1. 先在宿主机上建好目录和文件

```bash
# 权限要给运行 headscale 的用户可读写
mkdir -p /vol1/@appdata/headscale/derp-maps
printf 'regions: {}\n' > /vol1/@appdata/headscale/derp-maps/home.yaml
```

先用一份空的 `regions: {}` 占位即可，稍后可以在面板里用「用示例创建」覆盖它。关键是**文件
必须先存在**：`derp.paths` 一旦写进配置，重载或重启时 Headscale 就要能打开它。

### 2. 把目录按原路径读写挂进容器

```yaml
volumes:
  # 宿主机目录 : 容器内完全相同的绝对路径（读写，不要 :ro）
  - "/vol1/@appdata/headscale/derp-maps:/vol1/@appdata/headscale/derp-maps"
```

然后 `docker compose up -d` 重建容器。Docker 以**更具体**的挂载点为准，所以这一行会盖过整份
数据目录的只读挂载（`- "/vol1/@appdata/headscale:/vol1/@appdata/headscale:ro"`），对
`derp-maps` 以读写生效 —— 那份只读挂载**不用改**，也不要为了省事把整个数据目录改成读写。
挂成只读时「查看」仍然可用，但**保存会失败**。

### 3. 把宿主机路径写进 `derp.paths`

编辑生效的那份配置（fnOS 上是 `/vol1/@appdata/headscale/config.yaml`）：

```yaml
server_url: https://ha.example.com:8443 # ← 必须改成你的域名；必须 https，不能带路径

derp:
  server:
    enabled: true
    region_id: 999 # ← 可改（内嵌中继建议用 900–999）
    region_code: headscale # ← 可改（客户端命令里用这个名字）
    region_name: "Headscale Embedded DERP" # ← 可改
    stun_listen_addr: "0.0.0.0:3478" # ← 别动；要双栈就写 "[::]:3478"
    private_key_path: /vol1/@appdata/headscale/derp_server_private.key # ← 可改
  urls: [] # ← 可改：只用自建中继就留空；想同时保留公开区域就删掉这一行
  paths:
    - /vol1/@appdata/headscale/derp-maps/home.yaml # ← 必须改：宿主机上的绝对路径
```

只在面板里加路径也一样：DERP 卡片的新增路径输入框要填 **Headscale 主机上的绝对路径**，保存
后配置里就是上面这个样子。

### 4. 重载或重启 Headscale

Headscale 是**启动时**读取这些文件的，不重载就不会生效。用「设置 → 系统」里的重载/重启
按钮，或重启 fnOS 应用中心里的 headscale。

## 四、双镜像模式下的路径与挂载

[双镜像部署](/install/dual-image) 把 Headscale 也放进容器。它的做法是**把宿主机目录按同一个
绝对路径挂进容器**，所以 `config.yaml` 里的 `derp.paths` **一个字都不用改**：

```text
宿主机          /vol1/1000/APP/headplaneCN/headscale            ← 地图数据在这里
headscale 容器  - "${BASE_DIR}/headscale:${BASE_DIR}/headscale"
容器内          /vol1/1000/APP/headplaneCN/headscale            ← 同一个路径
配置里          derp.paths: /vol1/1000/APP/headplaneCN/headscale/derp-maps/…yaml
```

面板侧的 compose：

```yaml
volumes:
  # 面板要能改写 Headscale 配置与 DERP 地图
  - "${BASE_DIR}/headscale/config.yaml:/etc/headscale/config.yaml"
  - "${BASE_DIR}/headscale/derp-maps:${BASE_DIR}/headscale/derp-maps"
  # 数据目录按同一绝对路径挂进来（只读）：配置检查与快照能看到数据库、私钥
  - "${BASE_DIR}/headscale:${BASE_DIR}/headscale:ro"
```

与 DERP 有关的挂载，一句话一条：

| 挂载                                                    | 作用                                                                                  |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `headscale:${BASE_DIR}/headscale`（headscale 容器）     | 数据库、私钥、socket、地图的读写位置，**路径与宿主机逐字一致**                        |
| `headscale/derp-maps:${BASE_DIR}/.../derp-maps`（面板） | DERP 地图的查看/编辑/保存；官方区域镜像写出的文件也在这里，Headscale 读的是同一个文件 |
| `headscale:${BASE_DIR}/headscale:ro`（面板）            | 同一绝对路径 + 只读：配置检查与快照能看到 `db.sqlite`、私钥等；只读避免面板误写       |

双镜像里的 Headscale 配置大致是这样（片段）：

```yaml
derp:
  server:
    enabled: true
    region_id: 999
    region_code: "headscale"
    region_name: "Headscale Embedded DERP"
    verify_clients: true # 客户端要先证明属于你的 tailnet 才能用中继
    stun_listen_addr: "[::]:3478" # 双栈；只用 IPv4 就写 "0.0.0.0:3478"
    private_key_path: /vol1/1000/APP/headplaneCN/headscale/derp_server_private.key
    automatically_add_embedded_derp_region: true # 自动把内嵌区域加进下发给客户端的地图
    ipv4: 203.0.113.10 # 可选：对外公告的地址；没有公网地址就留空 ""
    ipv6: "" # 可选
  urls: [] # 只用自建中继就保持 []
  paths:
    - /vol1/1000/APP/headplaneCN/headscale/derp-maps/official-mirror.yaml
```

### 官方区域镜像的目标路径随部署形态变化

面板的**官方区域节点筛选**会把自己生成的地图写成一个文件，并把它加进 `derp.paths`。这个
文件的默认位置**由 Headscale 的实况配置推导**，不再写死：

1. `derp.paths` 里第一个绝对路径所在目录 + `official-mirror.yaml`；
2. 没有的话，用 Headscale 数据目录（由 `noise.private_key_path` → `database.sqlite.path`
   → `derp.server.private_key_path` → `unix_socket` 依次推断）+
   `derp-maps/official-mirror.yaml`；
3. 都推断不出来时，才回退到老的原生默认值
   `/vol1/@appdata/headscale/derp-maps/official-mirror.yaml`。

所以在双镜像形态里，只要 `derp.paths` 里那份文件存在，卡片就会自动指向
`/vol1/1000/APP/headplaneCN/headscale/derp-maps/official-mirror.yaml`。**你手动改过路径就以
你的为准**；只有还停留在老默认值时才按上面的规则重新推导。

从原生部署迁过来后，如果卡片仍提示「无法读取 `/vol1/@appdata/...`」，说明面板数据文件里保存
的还是老路径（双镜像下容器**没有挂载** `/vol1/@appdata`）。两种改法任选：

- 在卡片里把路径改成新路径并保存；
- 或直接改面板数据文件（**改前先备份**，然后重启面板）：

  ```bash
  cd /vol1/1000/APP/headplaneCN/data
  cp -a derp-region-mirror.json derp-region-mirror.json.bak-$(date +%Y%m%d-%H%M%S)
  sed -i "s#/vol1/@appdata/headscale/derp-maps/official-mirror.yaml#/vol1/1000/APP/headplaneCN/headscale/derp-maps/official-mirror.yaml#g" \
    derp-region-mirror.json
  cd .. && docker compose restart headplaneCN
  ```

页面上的「DERP 地图文件的挂载提示」也会跟着 `derp.paths` 推导（`- "<目录>:<目录>"`），不会再
显示写死的 `/vol1/@appdata/...`。

### 端口：中继与控制服务同一个端口

`network_mode: host` 下对外端口完全由容器里监听什么决定，DERP 相关的是这两个：

| 端口       | 谁在听             | 怎么对外                                                           |
| ---------- | ------------------ | ------------------------------------------------------------------ |
| `tcp/8480` | Headscale 控制服务 | 反代回源到 `127.0.0.1:8480`；**控制路径与 `/derp` 都在这个端口上** |
| `udp/3478` | 内嵌 DERP 的 STUN  | 在路由器/防火墙上直接放开到这台机器，**不能**走 HTTP 反代          |

## 五、在线编辑与校验 DERP 地图

**设置 → Headscale → DERP** 会把 `derp.paths` 里的每个路径列出来，并支持**查看 / 编辑 /
保存 / 回滚**，还能用「用示例创建」生成一份带中文注释的模板（一个区域一个节点、两个区域其中
一个仅提供 STUN、以及一份注释骨架）。**「用示例创建」在你点保存之前不会写入任何东西。**

每一行都会给出该路径的逐项检查：文件是否存在、是否可读、是否可写、YAML 能否解析、是不是
有效的 DERP 地图、区域 ID 与区域代码是否唯一。容器**既看不到也写不了**的路径会显示为
「无法检查」，而不是把保存失败悄悄咽下去。

保存前 HeadplaneCN 会在服务端再校验一次：必须是合法的 YAML、必须是一份 `regions` 映射、区域
必须有 `regionid`/`regioncode`/`regionname`/`nodes`、区域 ID 与代码不能重复、节点必须有
`name`/`regionid`/`hostname`，端口与地址也要合法。

- **快照**：每次写入前都会先留一份快照，在 `/settings/snapshots` 里能看到并恢复（快照里会有
  `DERP map file: …` 这样的条目）。
- **只读挂载时不允许保存**：目录挂成 `:ro` 时「查看」仍可用，但保存会提示容器无法写入 ——
  先把第三节/第四节那份读写挂载补上。
- **手工修改会被覆盖**：官方区域镜像写出的那份文件由后台任务维护，请专门给它一个文件，
  不要指向你手动维护的地图。
- **保存后要重载才生效**：Headscale 是启动时加载这些文件的，面板会提示你重载或重启。

界面细节（每个按钮做什么、检查项怎么显示）见
[Headscale 设置 → 在线编辑本地 DERP 地图文件](/features/headscale-settings#在线编辑本地-derp-地图文件)。

::: tip 官方地图是「wire 格式」，两种写法都认
Tailscale 下发的官方地图用大写字段（`Regions`、`RegionID`、`HostName`、`IPv4`…），而
Headscale 的本地文件用小写（`regions`、`regionid`、`hostname`、`ipv4`）。同一个读取器两种都
接受并归一化。远程抓取有 **10 秒**超时；连接本身失败（超时、被拒）会**重试一次**，而返回
错误状态码或根本不是 DERP 地图时不重试。
:::

## 六、官方区域镜像与 900 段编号

不想自己维护地图文件、又嫌 Tailscale 官方区域太多而且名字是英文时，用**设置 → Headscale →
DERP** 里「自动同步」正下方的**官方区域节点筛选**卡片（默认折叠，摘要形如「N 个官方区域 ·
已选 M 个 · 文件路径」）。

它镜像的是 **Tailscale 官方的公开 DERP 区域**（不是你自己的节点），只保留你勾选的区域，统一
改号到 **900 段**，写进一份本地地图文件交给 Headscale 分发：

- 勾选的区域统一从 **901** 起按**实测延迟升序**编号；延迟相同则官方 ID 小的在前。**没有固定
  区域，两个勾选框都可以取消，默认一个都不勾选。**
- 编号是**粘性的**：一旦定下来，后续运行不会因为某次延迟波动就换号，客户端选路因此稳定；
  只有点「重新编号」才会全部重排（对话框会提示客户端可能短暂重选中继）。
- 设置项：启用开关（**默认关**）、目标文件路径（默认
  `/vol1/@appdata/headscale/derp-maps/official-mirror.yaml`，**必须是宿主机上的绝对路径**，
  且该目录要以读写方式挂进容器）、刷新间隔（6 / 12 / 24 小时，默认 24）、写入后自动重载
  （默认开；重载会短暂中断在线客户端）。
- 四个按钮：**保存**写设置；**检查**只抓取、过滤、比较，**什么都不写**（不留快照、不重载、
  不发通知、也不改动已存编号）；**立即更新**写入真正变化的内容；**重新编号**丢弃已存编号
  后按当前测量重排一次。
- 写不进去时**不会**动磁盘上原有的文件，卡片会说明原因（没有勾选区域、官方地图取不到、目标
  路径不是绝对路径或含 `..`、不可写、生成的地图没通过校验、重载失败等）；失败会通过
  「DERP 地址同步失败」这一通知事件推出去。

## 七、中继地址同步

`derp.server.ipv4` / `ipv6` 是 Headscale **公布给客户端**的中继地址。留空时由自动同步探测并
写入。两个地址族的取法**不一样**：

- **IPv4**：取 `server_url` 主机名的 **A 记录**（私有、CGNAT、回环与链路本地答复会被拒绝）。
  在 NAT 后面的机器本来也看不到自己的公网地址，DNS 的答案就是对的。
- **IPv6**：取**宿主机自己的全局单播地址** —— IPv6 没有 NAT，公网地址就在机器自己身上；
  稳定地址优先于会轮换的隐私地址，域名 AAAA 指到的那个优先。可选的**仅 IPv6 回显**在路由器
  转发或转换 IPv6 时是权威答案。DNS 的答案只在对照不上时作为**兜底**显示，并标为「未验证」，
  因为域名上的 AAAA 可能是临时隐私地址、换过前缀的旧记录，甚至是另一台机器。

同步的规则：

- **「检查」只预演、不写入**：跑完两个地址族的探测与比对后什么都不改。**「立即运行」**跑同一
  套检查，**只写入真正变化的键**（哪个族变了就只写那个键），写入前先留配置快照并记一条审计。
- **自动重载默认开启**：写入要让客户端看到就得重载，而重载会**短暂中断已连接的客户端**；
  什么都没变的运行不会重载。
- **探测结果就是权威值**：与手工写死的值不一致时会直接覆盖；探测失败（某个族取不到可用地址、
  写入失败或重载失败）会通过通知系统告警，没有变化的运行不会告警。
- **解析结果缓存五分钟**（包括「没有记录」这类否定结果）：改完 DNS 后点中继设置里的
  **「重新解析」**可以立刻清缓存重查，不必等满五分钟，也不必重启 HeadplaneCN。

完整的判定规则见
[Headscale 设置 → 地址自动同步](/features/headscale-settings#地址自动同步) 与
[中继地址是从哪里来的](/features/headscale-settings#中继地址是从哪里来的)。

## 八、STUN：`udp/3478` 必须单独放行

HTTP 反向代理**转发不了 UDP**。DERP 地图里公告的 STUN 端口是 `udp/3478`，客户端会往
`<server_url 的域名>:3478/udp` 发包，所以要在**路由器或防火墙上单独做端口转发**：

```text
udp/3478  →  192.168.1.10:3478/udp        # 指向运行 Headscale 的那台机器
```

（若公网入口在路由器上，就是：公网 `udp/3478` → 那台机器 `udp/3478`。）

要让中继**同时支持 IPv6**，还得确认监听是双栈的：

```yaml
listen_addr: "::" # 或 0.0.0.0 只跑 IPv4
derp:
  server:
    stun_listen_addr: "[::]:3478" # 或 "0.0.0.0:3478" 只跑 IPv4
```

否则即使域名解析到了 IPv6 地址，中继与 STUN 仍然只监听 IPv4。

## 九、验收与自检

```bash
# ① 直连 Headscale：确认 /derp 路由存在
#    预期是「需要升级协议」类的 4xx（例如 400/426），**不是 404**
curl -si http://127.0.0.1:8480/derp | head -3

# ② 经反代：状态码应与 ① 一致
#    若这里 404 而 ① 正常 → 就是路径没被转发（见第十节）
curl -si https://ha.example.com:8443/derp | head -3

# ③ 本机在听哪些端口（-u 才能看到 udp/3478）
ss -lntup | grep -E '8480|3478'

# ④ 服务日志里看 DERP 有没有起来
docker compose logs headscale | grep -iE 'error|derp' | tail
```

对照 Headscale 启动日志里应出现 `DERP region 999`、`stun server started` 一类字样。

客户端侧（任一已加入 Tailnet 的机器，**决定性证据**）：

```bash
tailscale debug derp-map | grep -A 12 -i headscale   # 确认区域已下发
tailscale debug derp headscale                       # 观察该区域实际能不能连通
tailscale netcheck                                   # STUN 一项不应是「不可用」
```

逐项打勾：

- [ ] 系统自检里**内嵌中继**一项为绿；没有公网 IPv6 时 IPv6 那栏为空是正常的
- [ ] `curl -si http://127.0.0.1:8480/derp` 返回 426 一类，**不是 404**
- [ ] 经反代 `/derp` 的状态码与直连一致，证书有效
- [ ] 客户端 `tailscale debug derp-map` 能看到你的区域，`hostname:port` 与 `server_url` 一致
- [ ] `tailscale debug derp <区域代码>` 能连通
- [ ] DERP 页的目标文件路径与 `derp.paths` 一致，文件存在、可读，行内检查不是「无法检查」
- [ ] 保存一次地图后 `/settings/snapshots` 里出现 `DERP map file: …` 快照
- [ ] 客户端 `tailscale netcheck` 里 STUN 可用；`ss -lntup | grep 3478` 有输出

## 十、常见问题

### 内嵌 DERP 区域一直没人用

**症状**：客户端地图里能看到你的区域，但没有机器走它。

**原因**：端口、防火墙、证书任一环节不通。

**解决**：按顺序排查 —— `server_url` 是不是 `https`；客户端能不能到 `server_url` 指示的端口
（写了端口就用那个端口，不写就是 443）；`udp/3478` 有没有被防火墙挡掉；反向代理有没有转发
`/derp` 并放行 Upgrade。先用 `tailscale debug derp-map` 确认区域已下发，再逐项对照第二、三、
八节。

### 客户端显示「IPv6: 否」，或中继解析不到 IPv6 地址

**症状**：机器详情页的「客户端连通性 → IPv6」是「否」，或者中继卡片里 IPv6 一栏一直空着。

**原因**：这是**两件不同的事**。

- 机器详情页那个值来自**该机器自己**的 Tailscale 连通性自检（`WorkingIPv6`），说的是那台机器
  所在网络能不能用 IPv6，**与 Headscale 无关**，在 Headscale 侧怎么改都不会变。要处理就在那台
  机器的网络上处理：ISP/路由器有没有下发 IPv6 前缀（PD）、光猫是否桥接、系统网卡是否启用
  IPv6（`ip -6 addr` 能看到全局地址）、防火墙/安全组是否放行 IPv6。如果该网络本来就只有
  IPv4，保持「否」完全正常：tailnet 内部给设备分配的 `fd7a:…` 地址照常可用。
- 中继卡片里 IPv6 那一栏为空，说明宿主机没有公网 IPv6，**并且** `server_url` 的主机名也没有
  AAAA 记录 —— 两者都没有，客户端完全无法通过 IPv6 连接自建中继，不是「慢」，而是根本用不了。

**解决**：**两边都要查**：

```bash
dig +short AAAA ha.example.com            # 本机解析器：无输出 = 它认为没有 AAAA
dig @1.1.1.1 +short AAAA ha.example.com   # 公共解析器：有输出 = 记录其实存在
```

本机解析器可能在名称确有 AAAA 记录时仍返回空结果（不响应 AAAA 查询、上游只转发 A、或有 DNS
过滤）。公共解析器查得到而本机查不到，问题在 DNS 而不在 Headscale：可以改宿主机/路由器的
DNS，也可以在面板里设置用于解析的 DNS 服务器（留空 = 跟随宿主）并点「重新解析」，这样不必改
宿主的 DNS（该项只用于中继解析，不影响其他解析）。

确认之后再二选一：

- **要 IPv6**：给该主机名补一条 AAAA 记录，指向运行 Headscale / 中继的那台机器（也就是反代
  回源的地址）；这条记录要与**宿主机自己的全局 IPv6 地址**一致（不一致时 DERP 页会给出黄色
  警告），只是给别处的地址打掩护没有意义；同时确认 `listen_addr` 与
  `derp.server.stun_listen_addr` 是双栈（见第八节）。
- **只跑 IPv4**：接受 IPv4-only，并清空 `derp.server.ipv6`，这个提示就不会再出现。

另外：`设置 → 系统` 里的「内嵌中继 IPv4 / IPv6」检查项给出同样的判定；`derp.server.ipv4`
对应的告警通常意味着机器 IP 变过、声明的是旧地址。

### 保存本地 DERP 地图时报「看不到该路径 / 无法写入」

**原因**：只挂了 `config.yaml`，没有把 `derp.paths` 指向的目录挂进容器；或者容器内的挂载点
写成了 `/etc/headscale/derp-maps` 这类**容器专用路径**；又或者这个目录挂成了只读。根子在于
`derp.paths` 由**宿主机上的 Headscale** 读取，写的必须是宿主机路径。

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

重建容器（`docker compose up -d`）后，DERP 页的该行会从「无法检查」变成真实的检查结果。
宿主机上注意权限：文件要对运行 headscale 的用户和容器都可读写。双镜像部署把整个数据目录按
同一绝对路径挂进容器，因此没有这个错位。

### `getting DERPMap: open /etc/headscale/derp-maps/derp.yaml: no such file or directory`

**症状**：Headscale 启动/重载失败并退出（HeadplaneCN 与 Headscale 是分开的，面板容器不受
影响）：

```text
Error: headscale ran into an error and had to shut down:
getting DERPMap: open /etc/headscale/derp-maps/derp.yaml: no such file or directory
```

**原因**：`derp.paths` 里写的是**容器专用路径**（例如 `/etc/headscale/derp-maps/derp.yaml`），
或者宿主机上根本没有那个文件。这份清单由**宿主机上的 Headscale** 读取，容器里存在的路径对它
没有意义。

**解决（先让它起来，再重做）**，两条路二选一：

1. **把 `paths:` 那一条注释掉**，让 Headscale 先能起来。编辑
   `/vol1/@appdata/headscale/config.yaml`：

   ```yaml
   derp:
     # paths:
     #   - /etc/headscale/derp-maps/derp.yaml
   ```

   也可以在面板的 DERP 卡片里把这条路径「移除」，保存后会写回同一份配置；改完重启 headscale。

2. **回滚到写入前的配置快照**：HeadplaneCN 每次写 Headscale 配置前都会自动留一份快照，在
   `/settings/snapshots` 里挑写入之前的那份点「恢复」，再重启 headscale。

起来之后按第三节重做一遍，顺序别反：**先在宿主机上建目录和文件 → 按相同绝对路径读写挂进
容器 → 再把宿主机路径写进 `derp.paths` → 保存后重载/重启**。清单里的路径必须是宿主机上真实
存在的绝对路径。

双镜像形态另外两种常见原因：`derp.paths` 与面板卡片里的路径**不一致**（两处必须是同一个
文件）；或者挂载没生效（compose 里少了 `"${BASE_DIR}/headscale:${BASE_DIR}/headscale"` 或
路径写错），可以用这条命令确认：

```bash
docker compose exec headscale ls -l /vol1/1000/APP/headplaneCN/headscale/derp-maps/
```

### 官方区域筛选提示「无法读取 /vol1/@appdata/headscale/derp-maps/...」

**原因**：面板数据文件里保存的还是老的原生路径，而双镜像形态下容器**没有挂载**
`/vol1/@appdata`。

**解决**：按第四节把路径改成新路径（在卡片里改，或改 `data/derp-region-mirror.json` 后重启
面板）。

### 经反代打开 `/derp` 的行为不对

| 症状                              | 原因                                     | 处理                                                                   |
| --------------------------------- | ---------------------------------------- | ---------------------------------------------------------------------- |
| 经反代 `/derp` 返回 404，直连正常 | 只转发了 `/api`、`/ts2021` 等白名单路径  | 匹配路径改留空或 `/*`，别只填具体路径                                  |
| `/derp` 路径被改写或去掉          | 开启了「URL 替换 / 前缀重写」            | 关闭路径重写                                                           |
| DERP 偶发失败、延迟高             | 反代开启了缓冲，或超时太短，升级连接被断 | 关闭缓冲、超时 ≥300 秒                                                 |
| 客户端地图里地址/端口不对         | `server_url` 与实际对外端口不一致        | 把 `server_url` 写成带端口的完整地址，如 `https://ha.example.com:8443` |
| STUN 一直不通                     | 忘了单独转发 `udp/3478`                  | 做 UDP 端口转发（第八节）                                              |
| 内嵌区域已在地图里但没人用        | 端口 / 防火墙 / 证书任一环节不通         | 按第九节排查；必要时先保留公开 DERP 兜底                               |

一句话要点：**`server_url` 那个域名必须能吃下 `/derp`** —— Headscale 这条反代等于**透明管道**，不改路径、不缓冲、放行长连接。想再挂一个 `derp.example.com` 之类的域名当第二个入口也可以，它转发到同一个容器、同一个 `127.0.0.1:8480` 即可，但客户端用的是 `server_url`，多出来的入口只是备用（
[设置 → DERP → 位于反向代理之后](/features/headscale-settings#位于反向代理之后)）。

## 十一、命令速查

```bash
# ---- 宿主机上（原生模式：Headscale 是原生进程）----
CFG=/vol1/@appdata/headscale/config.yaml
ls -l /vol1/@appdata/headscale/derp-maps/
ss -lntup | grep -E '8480|3478'        # -u 才能看到内嵌 DERP 的 udp/3478
ip -6 addr show scope global          # 宿主机有没有公网 IPv6
dig +short AAAA ha.example.com        # 本机解析器看到了什么
dig @1.1.1.1 +short AAAA ha.example.com

# ---- 双镜像模式：进 headscale 容器看同一份文件 ----
docker compose exec headscale ls -l /vol1/1000/APP/headplaneCN/headscale/derp-maps/
docker compose logs headscale | grep -iE 'error|derp' | tail

# ---- 反代与路由自检 ----
curl -si http://127.0.0.1:8480/derp | head -3          # 预期 400/426，不是 404
curl -si https://ha.example.com:8443/derp | head -3    # 应与上一条一致

# ---- 客户端侧 ----
tailscale debug derp-map | grep -A 12 -i headscale
tailscale debug derp headscale
tailscale netcheck
```

改完 Headscale 配置后记得**重载或重启**（面板「设置 → 系统」的按钮，或重启 fnOS 应用中心里的
headscale），否则地图文件的改动不会生效。
