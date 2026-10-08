---
title: fnOS（飞牛）· 原生模式
description: 在飞牛 fnOS 上把 headscale 装成原生应用、用 Docker 跑 HeadplaneCN，含两份可直接使用的设置文件与自检清单。
outline: [2, 3]
---

# fnOS（飞牛）· 原生模式安装

这一页只讲**安装与自检**：**headscale** 用 fnOS 第三方应用源的 fpk 包**原生运行**（宿主机进程，数据
在 `/vol1/@appdata/headscale`），**HeadplaneCN** 用 **Docker** 运行（host 网络，监听 `4100`），再由反向
代理把两者发布出去。中继 → [DERP 配置](/configuration/derp)；域名与证书 →
[域名与证书](/install/domains)；反代怎么填、STUN 怎么放行 →
[Lucky 反向代理](/install/reverse-proxy-lucky)；换部署形态 → [迁移](/install/migration)；界面各页提供
什么 → [功能总览](/features/overview)；想让 Docker 连 headscale 一起管 →
[双镜像部署](/install/dual-image)。

::: warning 装 headscale 前必须先添加第三方应用源
fnOS **官方应用中心不提供 headscale**：在「应用中心 → 设置 → 第三方市场 → 添加源」里添加
[github.com/conversun/fnos-store](https://github.com/conversun/fnos-store)，刷新后安装 `headscale`
（依赖会一并装上）。版本建议 **0.29.2 或更高**（0.29.0 beta ~ 0.29.1 的浏览器 SSH 有 WebSocket 回归）；
面板镜像用 `ghcr.io/cgg888/headplanecn:0.22.27`，国内拉不动就加加速前缀。
:::

## 需要你改的值

| 占位符             | 示例                             | 说明                                                                | 在哪里改                                                   |
| ------------------ | -------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------- |
| Headscale 域名     | `ha.example.com`                 | **必须改**：你自己的域名，后面所有 `server_url` / `base_url` 都用它 | headscale 的 `server_url`；面板的 `base_url`、`public_url` |
| 对外端口           | `8443`                           | **可改**：反代对外监听的端口，三处必须写一致                        | `server_url`、`public_url`、反代规则                       |
| NAS 局域网 IP      | `192.168.1.10`                   | **必须改**：反代回源要打这个地址，写 `127.0.0.1` 连不上             | compose 的 `HEADPLANE_SERVER__HOST`、反代的「后端地址」    |
| API Key            | `hskey-api-...`                  | **必须改**：第二节生成，只显示一次                                  | 面板的 `headscale.api_key`                                 |
| cookie 密钥        | `openssl rand -base64 24` 的输出 | **必须改**：正好 32 字符，手写必错                                  | 面板的 `server.cookie_secret`                              |
| 面板目录           | `/vol1/1000/APP/headplaneCN`     | **可改**：本文所有面板路径都以它为准                                | 第四节起的命令与 compose 挂载                              |
| 面板端口           | `4100`                           | **可改**（默认 4100）                                               | compose 的 `HEADPLANE_SERVER__PORT`                        |
| Headscale 控制端口 | `127.0.0.1:8480`                 | **别动**：面板靠它连 headscale                                      | headscale 的 `listen_addr`、面板的 `headscale.url`         |

## 先认清三个路径（最容易搞混）

| 路径                          | 角色                 | 里面有什么                                                                             |
| ----------------------------- | -------------------- | -------------------------------------------------------------------------------------- |
| `/vol1/@appcenter/headscale/` | **程序目录**         | `headscale`（可执行文件 / CLI）、启动脚本、**种子模板** `config/config.yaml`           |
| `/vol1/@appdata/headscale/`   | **配置 + 数据目录**  | **真正生效**的 `config.yaml`、`db.sqlite`、`noise_private.key`、`headscale.sock`、日志 |
| `/vol1/1000/APP/headplaneCN/` | **HeadplaneCN 目录** | `docker-compose.yml`、面板自己的 `config.yaml`、`data/`                                |

fnOS 的启动脚本**只在第一次**把种子模板写进 `@appdata`，之后永远读那一份：

- ✅ 要改配置 → 改 `/vol1/@appdata/headscale/config.yaml`，改完在**应用中心重启 headscale**
- ❌ 改 `@appcenter/headscale/config/config.yaml` 没有效果（升级还会被覆盖）
- ⚠️ 二进制在 `@appcenter`、数据在 `@appdata`，在 `@appdata` 下执行 `./headscale` 会报 `No such file or directory`

核对进程（期望结尾是 `./headscale serve --config /vol1/@appdata/headscale/config.yaml`）：

```bash
ps -ef | grep '[h]eadscale serve'
```

## 一、确认 Headscale 正在运行

```bash
curl -s http://127.0.0.1:8480/health      # 期望 {"status":"pass"}
ss -lntp | grep -E '8480|8481|50443'      # 8480 控制端口；8481 metrics、50443 gRPC 只在本地
```

装之前先扫一遍端口（`ss -lntp`，或 `netstat -ltnp`）：真实事故里 NAS 的 `8443` 曾被别的容器占用，把
反代端口规划和 `server_url` 一起打乱。

## 二、生成 API 密钥

```bash
cd /vol1/@appcenter/headscale
./headscale --config /vol1/@appdata/headscale/config.yaml apikeys create --expiration 90d
# 输出形如 hskey-api-xxxxxxxx...，只显示一次，立刻记下来
```

权限不足请用 root 执行（fnOS 的应用目录属于 root）。这把 key 要写进面板的 `headscale.api_key`，是
**服务端**凭据：Agent 同步、OIDC 会话、代理认证都由它发起，与你以后在登录框里输入的那把是两件事。
旧 key 泄漏：`apikeys list` 查前缀 → `apikeys expire --prefix <前缀>` 撤销。

## 三、要改的 headscale 配置（只列必须项）

编辑**生效的那份**：`/vol1/@appdata/headscale/config.yaml`

```yaml
server_url: https://ha.example.com:8443 # ← 必须改（客户端实际连的地址；不能带路径前缀）
listen_addr: 0.0.0.0:8480 # ← 别动（面板靠 127.0.0.1:8480 连它）
policy:
  mode: database # ← 必须改（想用网页改 ACL 就必须 database）
  path: "" # ← 别动
dns:
  magic_dns: true
  base_domain: headscale.internal # ← 可改
  extra_records_path: /vol1/@appdata/headscale/extra-records.json # ← 可改（推荐，见下）
unix_socket: /vol1/@appdata/headscale/headscale.sock # ← 别动
```

改完重启：在 **fnOS 应用中心把 headscale 停止 → 启动**。若启用了 `extra_records_path`，先创建文件
（`printf '[]\n' > /vol1/@appdata/headscale/extra-records.json`），否则 headscale 启动会报错。

::: warning `server_url` 与 `policy.mode` 的两个坑

- `server_url` **不能带路径前缀**，且它决定客户端登录地址 —— **改动它，已注册节点需要重新注册**。
- `policy.mode` 默认 `file`，策略 API 只读 → 保存 ACL 报 `403 Policy is not writable`；改成
  `database` 后网页才能编辑，切换不影响现有连通性。
  :::

想用中继（内嵌 DERP 服务器、`derp.paths` 本地地图、官方区域筛选）就在这里加 `derp:` 段 —— 完整写法、
UDP/STUN 与 `derp.paths` 的路径要求都在 [DERP 配置](/configuration/derp)。

## 四、准备目录

```bash
mkdir -p /vol1/1000/APP/headplaneCN/data
cd /vol1/1000/APP/headplaneCN
openssl rand -base64 24        # 生成 cookie_secret，记下来（正好 32 字符）
```

## 五、设置文件 ①：`config.yaml`

路径：`/vol1/1000/APP/headplaneCN/config.yaml`

```yaml
server:
  host: "192.168.1.10" # ← 必须改（NAS 局域网 IP；别写 0.0.0.0，反代按它回源）
  port: 3000 # ← 别动（对外端口由 compose 环境变量覆盖成 4100）
  base_url: "https://ha.example.com:8443" # ← 必须改（浏览器地址，不能带 /admin）
  cookie_secret: "请用上面的命令生成" # ← 必须改（正好 32 字符，多了少了容器起不来）
  cookie_secure: true # ← 必须改（HTTPS 反代 true；纯 HTTP 访问 false）
  data_path: "/var/lib/headplane" # ← 别动（compose 已持久化到 ./data）
headscale:
  url: "http://127.0.0.1:8480" # ← 别动（host 网络下容器里的 127.0.0.1 就是宿主机）
  public_url: "https://ha.example.com:8443" # ← 必须改（展示与浏览器 SSH 用；不填回退 url）
  api_key: "hskey-api-..." # ← 必须改（第二节那把完整 key，不是列表里的前缀）
  config_path: "/etc/headscale/config.yaml" # ← 别动（必须与 compose 挂载点一致）
  # dns_records_path: "/etc/headscale/extra-records.json"   # ← 可改（headscale 侧必须先有 extra_records_path）
integration:
  proc: { enabled: true } # ← 别动（headscale 是原生进程，保存后靠它发 SIGHUP）
  agent: { enabled: true } # ← 别动（版本 / OS / 中继列靠它同步）
# 可选：单点登录（浏览器 SSH 必须先启用）→ /features/sso；代理认证（反代已认证再开）→ /features/proxy-auth
# oidc: { issuer: "https://你的IdP/realms/xxx", client_id: "headplane", client_secret: "******" }
# proxy_auth: { enabled: true, user_header: "Remote-User", trusted_proxy_cidrs: ["127.0.0.1/32"] }
```

::: tip 想要一份「全字段」模板？
仓库根目录就有 [`config.example.yaml`](https://github.com/CGG888/headplaneCN/blob/main/config.example.yaml)
（`pnpm run dev:app` 用的就是它，每个键都带注释，含 OIDC、Kubernetes、`proxy_auth` 等本文没展开的键）。
上面这段只是为了跑起来的最小子集，没写的键一律走默认值。
:::

::: danger `cookie_secret` 必须正好 32 个字符
长度校验写死了 32；多了少了容器都会带着 `The configuration is missing required fields or has
invalid values` 退出。`openssl rand -base64 24` 正好生成 32 字符，别手写、别截断。
:::

::: warning 单独配 `dns_records_path` 会让面板退出
只有 headscale 配置里存在 `dns.extra_records_path` 时才允许指定 `headscale.dns_records_path`；只配后
者会打印 `Using separate DNS config file but dns.extra_records_path is not set in Headscale config` 并
直接退出。两处要么都配，要么都别配。
:::

## 六、设置文件 ②：`docker-compose.yml`

路径：`/vol1/1000/APP/headplaneCN/docker-compose.yml`

路径：`/vol1/1000/APP/headplaneCN/caddy/Caddyfile`（只做明文路径分流，**只有 Lucky 方案需要**，见
[Lucky 反向代理](/install/reverse-proxy-lucky)）

```yaml
services:
  headplane:
    image: "${IMAGE_PROXY-}ghcr.io/cgg888/headplanecn:0.22.27" # ← 可改（代理前缀在 .env 的 IMAGE_PROXY；排查时换 :<版本>-shell）
    container_name: headplane
    restart: unless-stopped
    network_mode: host # ← 别动（host 模式不能再写 ports / extra_hosts）
    pid: host # ← 别动（integration.proc 要读 /proc 找 headscale serve）
    security_opt: ["apparmor=unconfined"] # ← 别动（否则发信号报 kill EACCES）
    volumes:
      - "/vol1/1000/APP/headplaneCN/config.yaml:/etc/headplane/config.yaml:ro" # ← 可改：面板配置，只读
      - "/vol1/1000/APP/headplaneCN/data:/var/lib/headplane" # ← 可改：会话、库、Agent 状态
      - "/vol1/@appdata/headscale/config.yaml:/etc/headscale/config.yaml" # ← 必须改：要读写，不能 :ro
      - "/vol1/@appdata/headscale:/vol1/@appdata/headscale:ro" # ← 必须改：只读，容器内同路径
    environment:
      - "TZ=Asia/Shanghai" # ← 可改
      - "HEADPLANE_SERVER__HOST=192.168.1.10" # ← 必须改（NAS 局域网 IP）
      - "HEADPLANE_SERVER__PORT=4100" # ← 可改（默认 4100）
      - "HEADPLANE_HEADSCALE__CONFIG_PATH=/etc/headscale/config.yaml" # ← 别动
      - "HEADPLANE_INTEGRATION__PROC__ENABLED=true" # ← 别动
      - "HEADPLANE_INTEGRATION__AGENT__ENABLED=true" # ← 别动
    # 镜像自带的 /bin/hp_healthcheck 固定探 127.0.0.1，面板绑了具体 IP 时必然连接被拒（容器一直 unhealthy）；
    # 这里直接探真实地址（/admin/healthz 无需鉴权，返回 {"status":"OK"}）——换 IP / 端口时这一行要跟着改。
    healthcheck:
      {
        test:
          [
            "CMD",
            "/nodejs/bin/node",
            "-e",
            "fetch('http://192.168.1.10:4100/admin/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",
          ],
        interval: 30s,
        timeout: 5s,
        retries: 3,
      }
    logging: { driver: "json-file", options: { max-size: "10m", max-file: "3" } }

  # ---------------------------------------------------------------------------
  # Caddy：NAS 内的路径分流（只有 Lucky 方案需要）
  # ---------------------------------------------------------------------------
  # 跟面板在同一个 compose 文件里，不需要第二个目录、第二个栈；用端口方案或多域名方案时整段删掉。
  caddy:
    image: "${IMAGE_PROXY-}caddy:2-alpine" # 代理前缀在 .env 的 IMAGE_PROXY
    container_name: caddy
    restart: unless-stopped
    network_mode: host # ← 别动（host 模式不能再写 ports；容器内用 127.0.0.1 回源头原生 Headscale）
    environment:
      - "TZ=Asia/Shanghai" # ← 可改
      - "CADDY_PORT=8444" # ← 可改（Caddyfile 里的 {$CADDY_PORT:8444} 读的就是它）
    volumes:
      - "/vol1/1000/APP/headplaneCN/caddy/Caddyfile:/etc/caddy/Caddyfile:ro" # ← 可改：分流规则
      - "/vol1/1000/APP/headplaneCN/caddy/data:/data"
      - "/vol1/1000/APP/headplaneCN/caddy/config:/config"
    logging: { driver: "json-file", options: { max-size: "10m", max-file: "3" } }
```

::: tip 镜像拉不动？把代理前缀写进 `.env`
在 `/vol1/1000/APP/headplaneCN/.env` 里加一行 `IMAGE_PROXY=v6.gh-proxy.org/docker/`（没有 IPv6 就用
`v4.gh-proxy.org/docker/`），compose 里两个镜像会自动带上它；留空或删掉这一行就是直连
ghcr.io / Docker Hub。
:::

本形态不挂 `/var/run/docker.sock`（headscale 是原生进程，面板从不重启容器）。`HEADPLANE_*` 环境变量会
覆盖 `config.yaml`，两处写同样的值不会冲突；但数组型配置项（如 `allowed_action_origins`）**不支持**
环境变量，只能写在 `config.yaml` 里。

### `caddy/Caddyfile`（路径分流规则）

Caddy 只监听明文 HTTP，证书在路由器那层。`/admin` 开头的请求原样转给面板，其余全部转给原生
Headscale（`127.0.0.1:8480`）。照抄即可，只需把面板地址改成你的 NAS 局域网 IP：

```caddyfile
{
	# 这个容器不签发也不加载证书（证书在路由器那一层）
	auto_https off
}

:{$CADDY_PORT:8444} {
	# 浏览器打开根路径时进面板；客户端从不用 GET /
	@browserRoot {
		path /
		header Accept *text/html*
	}
	redir @browserRoot /admin/ 302

	handle /admin* {
		reverse_proxy 192.168.1.10:4100 {        # ← 改成 NAS 的局域网 IP（面板端口 4100 一般别动）
			header_up X-Forwarded-Proto https
		}
	}

	handle {
		reverse_proxy 127.0.0.1:8480 {           # ← 别动（原生 Headscale 就监听在同一台机器的 8480）
			flush_interval -1
			header_up X-Forwarded-Proto https
		}
	}
}
```

改完 Caddyfile 要 `docker compose restart caddy` 才生效。

::: warning 官方镜像没有 shell
`docker compose exec headplane sh` 会失败：镜像是 distroless，`/bin/sh` 是个假 shell（退出码 127，提示
`Headplane containers do not contain a shell by default.`）。要进容器排查就把 `image:` 临时换成
`ghcr.io/cgg888/headplanecn:0.22.27-shell`；宿主机侧的 `ls`、`ss`、`curl` 不需要进容器。
:::

## 七、启动与自检

```bash
cd /vol1/1000/APP/headplaneCN
docker compose up -d
docker compose ps                                     # 容器与健康状态
docker compose logs headplane | grep -i 'Headscale configuration'
#    期望：Found a valid Headscale configuration file at /etc/headscale/config.yaml
docker compose logs headplane | grep -i 'Found headscale serve'   # 期望 Found headscale serve (PID ...)
docker compose logs headplane | grep -iE 'Agent|Tailnet'
#    期望：Connecting to Tailnet at http://127.0.0.1:8480 as headplane-agent
curl -I http://192.168.1.10:4100/admin                # 本地面板能应答
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8444/admin/   # 302（Caddy 已起，端口按 compose）
```

浏览器打开 `http://192.168.1.10:4100/admin`，用第二节的 API Key 登录。登录后导航栏应有
**机器 / 用户 / 访问控制 / DNS / 设置** —— 这就是本页的全部目标；各页具体提供什么见
[功能总览](/features/overview)。

## 八、常见问题（症状 → 原因 → 解决）

### 1. 保存 / 切换时出现 `Unexpected Server Error`

**原因**：反代改写了 `Host` 头，表单提交被跨站校验拦下。
**解决**：让反代**保留原始 Host**，并确认 `server.base_url` 就是浏览器地址（不带 `/admin`）；必要时升级到 **0.8.4+**。填法见 [Lucky 反向代理](/install/reverse-proxy-lucky)。

### 2. 表单保存报错 / 点「退出登录」报错

**原因**：表单报错是反代剥掉了 `POST` 的 `Content-Type`；退出报错是旧版本的问题。
**解决**：升级到 **0.8.3+**（表单）与 **0.8.2+**（退出）；反代侧不要改写请求头。

### 3. 导航栏里根本没有 DNS / 设置

**原因**：面板读不到 headscale 的配置文件（`config_path` 缺失，或挂载写成了 `:ro`）。
**解决**：按第五、六节设 `headscale.config_path` 并**读写**挂载它；用 `docker compose logs headplane | grep -i 'Headscale configuration'` 定位，宿主机侧核对 `ls -l /vol1/@appdata/headscale/config.yaml`。

### 4. 保存 ACL 报 `403 Policy is not writable`

**原因**：headscale 的 `policy.mode` 还是 `file`，策略 API 只读。
**解决**：改成 `database` 并重启 fnOS 里的 headscale 应用（第三节）。

### 5. 容器访问不到 headscale

**原因**：面板没有用 host 网络，或 headscale 只监听 `127.0.0.1`。
**解决**：保持 `network_mode: host` + `headscale.url: http://127.0.0.1:8480`；只有改用 bridge 网络时才需要 `extra_hosts: ["host.docker.internal:host-gateway"]`，同时 `listen_addr` 不能只绑本地。

### 6. 登录后立刻被踢回登录页

**原因**：`cookie_secure` 与实际访问协议不符，或 `base_url` 和浏览器地址对不上。
**解决**：HTTPS 反代 → `cookie_secure: true`；纯 HTTP → `false`；`base_url` 的协议、域名、端口逐字一致。

### 7. 容器起不来，日志说配置无效

**原因**：最常见的是 `cookie_secret` 不是正好 32 字符，其次是 URL 不合法。
**解决**：用 `openssl rand -base64 24` 重新生成，别手写、别截断；URL 必须是带协议的完整地址。

### 8. 配置检查显示「无法验证」或提示只读

**原因**：数据目录按第六节以 `:ro` 挂载是**刻意**的 —— 面板的权限不是 Headscale 的权限。
**解决**：保持现状，这是预期结果而不是故障；只有 Headscale 自己报写不进去时才需要处理。

### 9. Agent 页提示 API Key 被拒绝（401）

**原因**：Agent 用的是**配置文件里**的 `headscale.api_key`，不是你登录时输入的那把。
**解决**：重新生成一把完整 key 写进 `config.yaml` 后重启容器；只填列表里显示的前缀一样会 401。

### 10. 浏览器 SSH 按钮点了报错

**原因**：Agent 没开、不是用 OIDC 登录，或 OIDC 用户没关联 Headscale 用户（提示会写明是哪一种）。
**解决**：打开 `integration.agent.enabled` + 用 OIDC 登录 + 在用户页关联账号；细节见 [浏览器 SSH](/features/ssh)。

### 11. 中继（DERP）相关的问题

内嵌中继区域没人用、`derp.paths` 报「看不到该路径 / 无法写入」、headscale 启动报 `getting DERPMap: open … no such file or directory`、中继解析不到 IPv6 地址 —— 全部在 [DERP 配置](/configuration/derp) 里按同样格式写成「症状 → 原因 → 解决」。

## 九、验收清单

```bash
cd /vol1/1000/APP/headplaneCN
docker compose ps                                          # 容器 Up (healthy)
curl -sI http://192.168.1.10:4100/admin | head -n 1         # 面板应答
curl -s http://127.0.0.1:8480/health                        # {"status":"pass"}
```

浏览器侧逐项打勾：

- [ ] 登录后导航栏有 **机器 / 用户 / 访问控制 / DNS / 设置**
- [ ] `/settings/system` 显示 Headscale 版本，**配置检查**有输出（只读挂载导致的「无法验证」属正常）
- [ ] `/settings/headscale` 能保存并生效（例如切换 `policy.mode` 后点重载）
- [ ] DNS 页面新增一条记录并保存成功；`cat /vol1/@appdata/headscale/extra-records.json` 能看到它
- [ ] `/settings/agent` 显示「上次同步」时间与节点数；`/settings/api-keys`、`/settings/audit`、`/settings/snapshots` 都能打开

## 十、命令速查

```bash
# ---- headscale（宿主机上的原生进程）----
cd /vol1/@appcenter/headscale
CFG=/vol1/@appdata/headscale/config.yaml
./headscale --config $CFG nodes list
./headscale --config $CFG apikeys create --expiration 90d
./headscale --config $CFG apikeys expire --prefix <前缀>

# ---- HeadplaneCN（容器）与现场核对 ----
cd /vol1/1000/APP/headplaneCN
docker compose ps && docker compose logs -f headplane
ps -ef | grep '[h]eadscale serve'
curl -s http://127.0.0.1:8480/health
```

## 十一、升级、备份与卸载

```bash
# ---- 升级 HeadplaneCN（面板容器）----
cd /vol1/1000/APP/headplaneCN
cp docker-compose.yml docker-compose.yml.bak-$(date +%F)
# 改 .env 里的 HEADPLANE_VERSION 之后：
docker compose pull && docker compose up -d
docker compose logs --tail=30 headplane    # 期望：Found a valid Headscale configuration

# ---- 升级 headscale（由 fnOS 应用中心管理，不要用 Docker 动它）----
# fnOS 应用中心 → headscale → 停止 → 更新 → 启动
# 升级前先做下面的备份；Headscale 要求逐个小版本升（0.26 → 0.27 → 0.28 → 0.29）

# ---- 备份：四样东西，缺一样都可能回不去 ----
tar -czf /vol1/1000/APP/headplaneCN-backup-$(date +%F).tar.gz \
  -C /vol1/1000/APP headplane \
  -C /vol1/@appdata headscale
```

- **最重要的是** `/vol1/@appdata/headscale/` 里的 `db.sqlite`、`noise_private.key`、`derp_server_private_key`，以及 HeadplaneCN 的 `data/` 与 `config.yaml`（`cookie_secret` 在里面）。想要绝对一致的数据库副本，**先在应用中心停掉 headscale 再打包**。
- **配置快照 ≠ 数据库备份**：`/settings/snapshots` 只保存 Headscale 的配置文件（文件模式下还有策略文件），`db.sqlite` 必须单独备份。
- **卸载**：面板只是容器，`docker compose down` 就停了；Headscale 归 fnOS 应用中心管，在应用中心停止或卸载。**先备份再卸载** —— `db.sqlite` 或 noise 私钥一旦删掉，所有已注册节点都得重新注册。
- **版本回滚**：Headscale 回滚前必须先 `down`，用备份里的 `db.sqlite` 覆盖（连同 `-wal` / `-shm` 一起删掉）。数据库迁移是单向的，只换镜像不够。

::: tip 想连 Headscale 也用 Docker 管？
升级、重启、看日志都统一起来 → 见[模式迁移与回退](/install/migration)。
:::
