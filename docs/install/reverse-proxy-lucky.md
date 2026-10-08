---
title: 反向代理：Lucky + Caddy（家庭 NAS）
description: 中国家庭 NAS 的主推路线：Lucky 在路由器一层终止 TLS，NAS 里的 Caddy 只做明文 HTTP 分流，/admin 给面板、其余给 Headscale。
outline: [2, 3]
---

# 反向代理：Lucky + Caddy（家庭 NAS）

这一页只讲**一条路线**：域名解析指向家里的公网 IP（或走内网穿透），**TLS 证书在路由器 / 内网的
Lucky 上终止**，NAS 里跑一个**只做明文 HTTP 分流**的 Caddy 容器 —— `/admin*` 给面板，其余给
Headscale。命令都能直接照抄，每一步都给出「应该看到什么」。

选不定路线时先看[域名与访问方式](/install/domains)（路径 / 端口 / 域名三种方案、DNS、证书、备案）；
云服务器上让 Caddy 自动申请证书看[云服务器 Caddy](/install/reverse-proxy-caddy)。
本页**不装** Headscale 和面板本身，它们怎么部署见 [fnOS（飞牛）](/install/fnos)。

## 先认清拓扑：为什么中间必须有 Caddy

| 谁              | 在哪             | 负责什么                                                   |
| --------------- | ---------------- | ---------------------------------------------------------- |
| **Lucky**       | 路由器 / 内网    | 对外监听 `8443`、**终止 TLS**（证书在这一层）、DDNS        |
| **Caddy**       | NAS 的容器里     | **只做明文 HTTP 分流**：`/admin*` → 面板，其余 → Headscale |
| **Headscale**   | NAS 上的原生进程 | 客户端要连的控制服务，监听 `127.0.0.1:8480`，占**根路径**  |
| **HeadplaneCN** | NAS 的容器里     | 人看的网页界面，监听 `192.168.1.10:4100`，占 `/admin`      |

一次请求的走向：浏览器 / 客户端 → `https://ha.example.com:8443` → **Lucky**（在这里解密 TLS）→
`http://192.168.1.10:8444` → **Caddy**（只看路径）→ `/admin*` 给面板，其它全给 Headscale。

**为什么中间必须有 Caddy？** 因为 Lucky 换不了后端：它的自定义参数只支持 `proxy_set_header` /
`proxy_hide_header` / `add_header` / `proxy_redirect` 四类指令和 `location` / `path` 分组，
**没有 `proxy_pass`**，一条规则只能指向一个后端。而 Headscale 必须占根路径（客户端只会访问
`server_url + /ts2021`、`/key`、`/derp` …），面板又必须有自己的位置 —— 所以「一个域名 + `/admin`
分流」只能靠 NAS 里的 Caddy 来做。

::: warning `server_url` 不能带路径前缀，改了已注册的机器要重新登录
Headscale 的 `server_url` 只能是根地址：✅ `https://ha.example.com:8443`；❌ `https://ha.example.com:8443/headscale`。
本页拓扑里面板靠 `/admin` 前缀分开，所以面板的 `server.base_url` 必须写成
`https://ha.example.com:8443/admin`（含 `/admin`，结尾不带 `/`）。
:::

## 需要你改的值

| 占位符                 | 示例                                                   | 说明                                                             | 在哪里改                                      |
| ---------------------- | ------------------------------------------------------ | ---------------------------------------------------------------- | --------------------------------------------- |
| 域名                   | `ha.example.com`                                       | 客户端与面板共用这一个域名，**必须改**                           | DNS、Lucky 的前端域名、Headscale `server_url` |
| 对外端口               | `8443`                                                 | 公网访问用的非标端口，**可改**（家用宽带拿不到备案，别用 `443`） | Lucky 的监听端口、`server_url`、`base_url`    |
| NAS 局域网 IP          | `192.168.1.10`                                         | 跑 Headscale 和面板的那台 NAS，**必须改**                        | Caddyfile 的回源地址、Lucky 的后端地址        |
| Caddy 监听端口         | `8444`                                                 | 只在内网与容器之间用，**可改**（别和 `8443` 撞）                 | `.env` 里的 `CADDY_PORT`                      |
| Caddy 镜像地址         | `v6.gh-proxy.org/docker/caddy:2-alpine`                | 国内拉镜像用的代理前缀，**可改**（换代理只改这一行）             | `.env` 里的 `CADDY_IMAGE`                     |
| Headscale `server_url` | `https://ha.example.com:8443`                          | 客户端连接的地址，**不能带路径前缀**                             | Headscale 的 `config.yaml`                    |
| 面板 `server.base_url` | `https://ha.example.com:8443/admin`                    | 面板自己的地址，**必须含 `/admin`**                              | 面板的 `config.yaml`                          |
| 证书 / 私钥路径        | `/etc/ssl/ha/fullchain.pem`、`/etc/ssl/ha/privkey.pem` | **只在 Lucky 上用**，NAS 里的 Caddy 不碰证书                     | Lucky 的证书配置                              |

## 一、先确认端口没被占用

装之前先扫一眼端口，两个真实事故都是这么撞出来的：NAS 上的 `8443` 曾经被**别的容器**占着；
路由器上装 Nginx 会抢走 `80/443`、把 OpenWrt 的 LuCI（`uhttpd`）顶掉，管理页直接打不开。

```bash
ss -lntp                      # 或 netstat -ltnp
# 期望：能看到 8480（Headscale）与 4100（面板）
#       但看不到 8443、8444 —— 有输出就说明被占了

ss -lntp | grep -E ':8443|:8444'
# 期望：没有输出（两个端口都空着）
```

- `8443` 被占用 → 换一个对外端口，并同步改 `server_url` 与 `base_url`（`8443` 只是本页的示例）。
- `8444` 被占用 → 只改 `.env` 里的 `CADDY_PORT`，Lucky 那边不用动。
- **路由器与 NAS 的端口是两回事**：Lucky 在路由器上听 `8443`，Caddy 在 NAS 上听 `8444`，互不冲突。

## 二、在 NAS 上装 Caddy

::: tip 不想再装一个容器？
那就别用路径分流，改用[域名与访问方式](/install/domains)里的**方案 B（一个域名 + 两个端口）**
或**方案 C（多域名）**：只用 Lucky 的**两条子规则**，不需要 Caddy。代价是面板不再藏在 `/admin`
下，方案 C 还要多一张证书。
:::

```bash
mkdir -p /vol1/1000/APP/caddy
cd /vol1/1000/APP/caddy
```

**① `.env`**（`/vol1/1000/APP/caddy/.env`）—— 只放两个值，换代理 / 换端口都只改这里：

```bash
# 国内直连 registry-1.docker.io 通常不通，这一行是镜像代理前缀
CADDY_IMAGE=v6.gh-proxy.org/docker/caddy:2-alpine   # ← 可改（换成你能用的代理前缀）
CADDY_PORT=8444                                       # ← 可改（上一节确认过没被占用）
```

**② `docker-compose.yml`**（`/vol1/1000/APP/caddy/docker-compose.yml`）：

```yaml
services:
  caddy:
    image: ${CADDY_IMAGE} # ← 可改（走 .env 的代理前缀，换代理只改那一行）
    container_name: caddy
    restart: unless-stopped

    # host 网络：容器与 NAS 共用网络命名空间
    # 8444 因此直接监听在 NAS 上，也才能用 127.0.0.1 找到原生运行的 Headscale
    # host 模式下不要再写 ports
    network_mode: host

    environment:
      # Caddyfile 里 {$CADDY_PORT:8444} 读的就是它 —— 端口只有一个来源
      - "CADDY_PORT=${CADDY_PORT}"

    volumes:
      - "./Caddyfile:/etc/caddy/Caddyfile:ro" # 分流规则（第三节）
      - "./caddy-data:/data" # Caddy 自己的运行数据
```

::: warning 别把 `docker.sock` 挂给 Caddy
它不需要，挂了等于把 NAS 的 root 权限交出去。这一页的 Caddy 只做反向代理。
:::

## 三、Caddyfile {#路径分流}

路径：`/vol1/1000/APP/caddy/Caddyfile`。这就是**只做明文 HTTP 分流**的那份，照抄即可：

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
		reverse_proxy 192.168.1.10:4100 {        # ← 必须改成你 NAS 的局域网 IP（面板端口 4100 一般别动）
			header_up X-Forwarded-Proto https
		}
	}

	handle {
		reverse_proxy 127.0.0.1:8480 {           # ← 别动（Headscale 就在同一台 NAS 上监听 8480）
			flush_interval -1
			header_up X-Forwarded-Proto https
		}
	}
}
```

这份规则在做三件事：`auto_https off` 表示**不要让 Caddy 申请证书**（证书在 Lucky 那层）；`/admin*`
**不改写路径**原样转给面板，并告诉它「外面是 HTTPS」（否则 `cookie_secure: true` 会出问题）；
兜底的 `handle` 把 `/ts2021`、`/key`、`/register`、`/verify`、`/api/v1/*`、`/health`、`/derp`
原样透传给 Headscale，`flush_interval -1` 关掉缓冲，长连接才不会被切断。

## 四、启动与自检

```bash
cd /vol1/1000/APP/caddy
docker compose up -d

docker compose ps                     # 期望：caddy 是 running / Up
docker compose logs caddy --tail=30   # 期望：有 serving ... on :8444，没有 error
ss -lntp | grep 8444                  # 期望：*:8444（v4 与 v6 都在听）
```

本机四条 curl，对照状态码：

```bash
# ① 浏览器那样打开根路径 → 进面板
curl -si -H 'Accept: text/html' http://192.168.1.10:8444/ | head -5
#    期望：302，Location: /admin/

# ② 客户端（不带 Accept: text/html）打开根路径 → Headscale
curl -si http://192.168.1.10:8444/ | head -5
#    期望：200（Headscale 的空白页，不是 404）

# ③ 面板的存活检查
curl -s http://192.168.1.10:8444/admin/healthz
#    期望：{"status":"OK"}

# ④ 客户端用的路径必须通
curl -si http://192.168.1.10:8444/derp | head -3
#    期望：426（需要升级协议）—— 是 404 就说明路径被吃掉了
```

## 五、在 Lucky 上添加规则

Lucky 各版本界面略有差别（界面是中文的），按下面的**字段**对照着填：

| 字段                        | 填什么                              | 为什么 / 注意                                               |
| --------------------------- | ----------------------------------- | ----------------------------------------------------------- |
| 前端域名                    | `ha.example.com`                    | 域名已经解析到你家的公网 IP（或穿透入口）                   |
| 监听端口 + TLS              | `8443`，**勾上 TLS**                | **证书在 Lucky 这一层**；不用 `443` 是因为家宽没有备案资格  |
| IPv4 / IPv6                 | **两个都勾**                        | 只监听 IPv4 时，纯 IPv6 网络（部分移动网络）连不上          |
| 子规则类型                  | `反向代理`                          | 分流交给 Caddy，这条规则只负责转发到 `8444`                 |
| 后端地址                    | `http://192.168.1.10:8444`          | **只写 `主机:端口`**，不带路径、不带结尾 `/`，协议写 `http` |
| 匹配 / 路径                 | 留空或 `/*`                         | 留空就是全收；不要只白名单 `/api`、`/ts2021`                |
| 路径改写 / URL 替换         | **全部关闭**                        | 一旦改写，`/admin`、`/ts2021`、`/derp` 会被改掉或去掉       |
| 保留原始 Host               | **打开**（保留浏览器请求的域名）    | 面板的 CSRF / 跨站校验依赖它                                |
| 自定义参数（Host 被改写时） | `proxy_set_header Host $http_host;` | 只有 Lucky 把 `Host` 改成内网 IP、面板报 403 时才需要加     |
| 放行 Upgrade                | **打开**                            | 浏览器 SSH 的 WebSocket 与 `/derp` 的长连接都要它           |
| 关闭响应缓冲                | **打开（关闭缓冲）**                | 缓冲会把长连接切断，DERP 会时通时断                         |
| 超时                        | **≥ 300 秒**                        | 客户端与 DERP 都是长连接，超时太短会被反复断开              |

::: warning 改完必须点「重启规则」
Lucky 改完字段**不会自动生效**：一定要点一次**「重启规则」**。证书换了、加了规则、换了后端，
都要重启这条规则才看得到效果 —— 这是「明明改对了却还是老样子」最常见的原因。
:::

## 六、验收清单

按顺序做，每条都给出「应该看到什么」：

```bash
# 1) NAS 本机、双栈都通
curl -s http://[::1]:8444/health
#    期望：200，{"status":"pass"}

# 2) 公网这一层通（换成你的域名与端口）
curl -si https://ha.example.com:8443/health
#    期望：200，{"status":"pass"}；有证书告警说明证书没生效
curl -si https://ha.example.com:8443/ | head -5
#    期望：200（Headscale 的空白页，不是 404）

# 3) 客户端用的路径不能 404
curl -si -X POST https://ha.example.com:8443/ts2021 | head -3
#    期望：不是 404（协议不对的 4xx/5xx 都算正常，唯独 404 说明路径没转发）
curl -si https://ha.example.com:8443/derp | head -3
#    期望：426（需要升级协议），不是 404

# 4) 面板在它该在的位置
curl -si https://ha.example.com:8443/admin | head -3     # 期望：302，Location: /admin/
curl -s  https://ha.example.com:8443/admin/healthz       # 期望：{"status":"OK"}
```

浏览器打开 `https://ha.example.com:8443` 应自动进 `/admin/`，用 API Key 能登录；顺手改一个设置
并保存，不应报 `Unexpected Server Error`。最后在任意一台装了 Tailscale 的机器上确认能注册：

```bash
tailscale up --login-server https://ha.example.com:8443
# 期望：给出登录链接，浏览器打开后能确认这台机器
```

## 七、常见问题

### 1. 打开域名看到的是 Headscale，不是面板

Lucky 的后端**直接指向了 Headscale 的 `8480`**（或把 `/admin` 也归到了那一支）。后端必须写
**Caddy 的 `http://192.168.1.10:8444`**、匹配留空或 `/*`，并确认 Caddy 容器在跑。

### 2. 502 Bad Gateway

Lucky 找不到后端。依次查三样：`docker compose ps` 里 Caddy 是否在跑、`ss -lntp | grep 8444` 端口
是否在听、后端地址是否误写成 `https://` 或多带了 `/`。`8444` 被别的容器占用时 Caddy 起不来，
日志里会是 `bind: address already in use`。

### 3. 面板能打开，一登录就 403 / 保存报 `Unexpected Server Error`

Lucky 把 `Host` 改写成了内网 IP，面板的 CSRF / 跨站校验不认：打开**保留原始 Host**，或在
**自定义参数**里加 `proxy_set_header Host $http_host;`；再核对 `server.base_url` 与浏览器地址
**逐字一致**（协议 + 域名 + 端口 + `/admin`）。

### 4. `/ts2021`、`/derp` 返回 404

路径被吃掉了：匹配只白名单了 `/api`、`/ts2021`，或开了「路径改写 / URL 替换」，或后端地址多写了 `/`。
改成匹配留空或 `/*`、关闭所有路径改写、后端只写 `http://192.168.1.10:8444`，改完点**「重启规则」**。

### 5. 证书还是旧的 / 新规则像没生效

Lucky 的规则改完**必须点「重启规则」**；换了证书文件后还要确认规则里选的就是新那份。
浏览器缓存太顽固时用隐私窗口再验一次。

### 6. IPv6 连不上

依次排除：规则里**只勾了 IPv4**（把 IPv6 也勾上，`ss -lntp` 应看到双栈的 `*:8444`）；域名没有
AAAA 记录；路由器防火墙没放行 `8443` 入站（IPv6 **没有 NAT、也不存在端口转发**，只能单独放行）；
NAS 上根本没有全局 IPv6 地址（`ip -6 addr show scope global` 确认，没有就先找运营商开）。

## 八、命令速查

| 目的                | 命令                                                                       |
| ------------------- | -------------------------------------------------------------------------- |
| 看端口有没有被占用  | `ss -lntp \| grep -E ':8443\|:8444'`                                       |
| 启动 / 重建 Caddy   | `cd /vol1/1000/APP/caddy && docker compose up -d`                          |
| 看状态 / 看日志     | `docker compose ps` / `docker compose logs caddy --tail=30`                |
| 改完 Caddyfile 生效 | `docker compose restart caddy`                                             |
| 本机验分流          | `curl -si http://192.168.1.10:8444/derp \| head -3`（期望 `426`）          |
| 面板存活            | `curl -s http://192.168.1.10:8444/admin/healthz`（期望 `{"status":"OK"}`） |
| 双栈（IPv6）        | `curl -s http://[::1]:8444/health`                                         |
| 公网整链            | `curl -si https://ha.example.com:8443/health`                              |

## 接下来

- 三种访问方式的取舍与 DNS / 证书 / 备案：[域名与访问方式](/install/domains)
- 云服务器上让 Caddy 自动申请证书：[云服务器 Caddy](/install/reverse-proxy-caddy)
- Headscale 与面板本身怎么装：[fnOS（飞牛）](/install/fnos)
