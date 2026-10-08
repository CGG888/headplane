---
title: 反向代理：Caddy（云服务器）
description: 云服务器路线：Caddy 直接监听 443、自动申请并续期证书，再按路径分流 —— /admin 给面板、其余给 Headscale，不需要 Lucky；含备案、DNS 与防火墙、Caddyfile、验收清单。
outline: [2, 3]
---

# 反向代理：Caddy（云服务器）

这一页只讲**一条路线**：在一台有公网 IP 的云服务器上，**Caddy 直接监听 `80`/`443`、自动申请并自动
续期证书**，再用路径把流量分开 —— `/admin*` 给面板，其余给 Headscale。这条路线**不需要 Lucky**：
终止 TLS 和分流都在同一台机器上，由 Caddy 一个人做完。

它和[家庭 NAS 路线](/install/reverse-proxy-lucky)的区别只是环境：家里通常开不了 `80`/`443`（运营商
封禁），也没有备案资格，所以那一路靠 Lucky 在路由器一层终止 TLS、NAS 里的 Caddy 只做**明文 HTTP
分流**；云服务器有公网 IP、能开 `80`/`443`、也能办备案，于是**一层就够**，少一个组件、也少一层排错。

选不定拓扑、要写 DNS、想知道证书该放哪一层时，先看[域名与访问方式](/install/domains)。本页**不装**
Headscale 和面板本身：容器与配置怎么写见 [Docker](/install/docker) 与[双镜像部署](/install/dual-image)。

## 需要你改的值

| 值                     | 示例                              | 说明                                                               | 在哪改                                        |
| ---------------------- | --------------------------------- | ------------------------------------------------------------------ | --------------------------------------------- |
| 域名                   | `ha.example.com`                  | 客户端要连的域名，**必须改**                                       | DNS、Caddyfile 站点名、Headscale `server_url` |
| 云服务器公网 IP        | `203.0.113.10`                    | 域名要解析到它，**必须改**                                         | DNS、云控制台的安全组                         |
| 部署目录               | `/opt/headplane`                  | `docker-compose.yml` 与 `Caddyfile` 所在目录，**按你的实际目录改** | 服务器上的命令、挂载路径                      |
| 面板回源地址           | `127.0.0.1:4100`                  | 面板就在这台机器上，**换端口时才改**                               | Caddyfile 的 `handle /admin*`                 |
| Headscale 回源地址     | `127.0.0.1:8480`                  | 客户端要连的控制服务，占**根路径**，**别动**                       | Caddyfile 的兜底 `handle`                     |
| 面板对外地址           | `https://ha.example.com/admin`    | 面板自己的地址，**必须带 `/admin`**                                | 面板 `server.base_url`                        |
| `server_url`           | `https://ha.example.com`          | 客户端要连的地址，**不能带路径**                                   | Headscale 的 `config.yaml`                    |
| `server.cookie_secure` | `true`                            | 对外是 HTTPS 就**保持 `true`**                                     | 面板 `config.yaml`                            |
| `server.cookie_secret` | 用 `openssl rand -base64 24` 生成 | 换掉会让所有人退出登录                                             | 面板 `config.yaml`                            |
| `headscale.public_url` | `https://ha.example.com`          | 必须与 `server_url` **逐字一致**                                   | 面板 `config.yaml`                            |

## 一、备案（中国大陆服务器必须先看） {#备案中国大陆服务器必须先备案}

**中国大陆**的服务器：域名必须先完成 **ICP 备案**，才能在 `80`/`443` 上对外提供服务。没备案时，
从公网访问 `80`/`443` 会被**中间层拦截** —— 表现是**连接超时**，或者被换成运营商 / 云厂商的提示页，
而**不是** Caddy 报错。所以在这条路线上，先排除备案，再看 Caddy。

备案的前提通常是三样：**域名已实名认证**（且后缀在工信部白名单内）、**域名注册商支持备案接入**
（多数情况要把域名转到国内注册商，或至少在支持备案的那家）、**你有一台中国大陆的服务器**
（备案要挂在这台服务器或同一服务商下）。各省管局审核速度不同，**通常 1–20 个工作日**。

**境外服务器（含香港、澳门、台湾）不需要备案**，可以直接用 `80`/`443` 加自动证书，这是最省事的
一种，代价是到国内的延迟高一些。

**家庭宽带没有备案资格**（个人宽带通常无法备案，运营商也普遍封禁 `80`/`443`），所以家庭路线走
**非标端口 + 自备证书**，见[家庭 NAS 路线](/install/reverse-proxy-lucky)。

未备案的国内服务器**临时**改用非标端口（例如 `8443`）通常能访问，但那只是过渡：非标端口不受
`80`/`443` 那道拦截，却随时可能因为服务商策略变化而不可用。**该办的备案仍然要办完**，本页
**不提供**任何绕过备案的办法。

## 二、域名解析与防火墙

先让域名指向这台服务器。Caddy 申请证书时会核对解析结果，所以**解析必须先生效**：

| 记录类型 | 主机记录 | 值             | 说明                                                         |
| -------- | -------- | -------------- | ------------------------------------------------------------ |
| `A`      | `ha`     | `203.0.113.10` | 指向这台云服务器的公网 IPv4，**必须改**                      |
| `AAAA`   | `ha`     | `2001:db8::1`  | 可选：只有服务器有公网 IPv6 时才加，没有就**不要留**这条记录 |

端口这边有两层，**都要放行**：云厂商控制台的**安全组 / 防火墙**，以及服务器系统里的 `ufw` /
`firewalld`。只放行一层是最常见的"证书一直申请失败"的原因。

| 端口   | 协议 | 是否对外开放 | 用途                                              |
| ------ | ---- | ------------ | ------------------------------------------------- |
| `80`   | TCP  | **必须**     | ACME 的 HTTP-01 验证 + HTTP → HTTPS 跳转          |
| `443`  | TCP  | **必须**     | 对外 HTTPS（面板和 Headscale 都从这里进）         |
| `443`  | UDP  | 可选         | HTTP/3；不放行只影响速度，不影响可用性            |
| `3478` | UDP  | **必须**     | 客户端 `netcheck` 的 STUN，漏放行会一直显示不可用 |
| `8480` | TCP  | **不要开放** | Headscale 本身，只在机器内部给 Caddy 访问         |
| `4100` | TCP  | **不要开放** | 面板本身，只在机器内部给 Caddy 访问               |

以 `ufw` 为例（系统不同命令不同，按你的发行版调整）：

```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw allow 3478/udp
sudo ufw status
```

`8480` 和 `4100` **不要**出现在安全组里：Caddy 和它们在**同一台机器**上，走 `127.0.0.1` 就够了，
把面板直接暴露到公网只会平白多一个入口。

## 三、目录与 compose

服务器上只需要一个目录，下面所有命令都假设你在这个目录里：

```text
/opt/headplane/
├── docker-compose.yml     # 面板 + Headscale + Caddy（前两个的细节见 /install/dual-image）
├── config.yaml            # 面板配置（见 /install/docker）
├── Caddyfile              # 本页的核心，见下一节
├── caddy-data/            # ← 别删：证书与 ACME 账户都在这里
└── caddy-config/          # Caddy 的运行时配置
```

面板和 Headscale 两个容器的镜像、环境变量、健康检查都在[双镜像部署](/install/dual-image)里，
本页**不重复**，只给 `docker-compose.yml` 里的 **Caddy 这一段**：

```yaml
services:
  caddy:
    image: caddy:2-alpine # ← 可改：拉不动时换成你的镜像加速地址前缀
    container_name: caddy
    restart: unless-stopped
    network_mode: host # ← 别动：host 网络下 127.0.0.1 才是「宿主机」
    volumes:
      - "./Caddyfile:/etc/caddy/Caddyfile:ro"
      - "./caddy-data:/data" # ← 别动：证书和 ACME 账户都在这里
      - "./caddy-config:/config"
```

两点说明：

- **用 host 网络**，所以 Caddyfile 里的回源地址写 `127.0.0.1:4100` / `127.0.0.1:8480` 就是面板和
  Headscale。host 网络下**不需要写 `ports:`**，Caddy 会直接占用宿主机的 `80`/`443`。如果你偏要走
  bridge 网络，回源地址得改成宿主机在 bridge 里的地址（`host.docker.internal` 需要额外加
  `extra_hosts: ["host.docker.internal:host-gateway"]`）。
- 机器上**不要再跑** Nginx / Apache / 别的占用 `80`/`443` 的服务：Caddy 起不来时会报
  `bind: address already in use`。

## 四、Caddyfile

`Caddyfile` 与 `docker-compose.yml` 放同一个目录，照抄即可：

```caddyfile
{
	# email you@example.com            # ← 可选：证书快到期时 Let's Encrypt 会发提醒到这个邮箱
}

ha.example.com {
	# 浏览器打开根路径时进面板；客户端从不用 GET /
	@browserRoot {
		path /
		header Accept *text/html*
	}
	redir @browserRoot /admin/ 302

	handle /admin* {
		# 原样交给面板：面板自己就跑在 /admin 下，不要在这里改写路径
		reverse_proxy 127.0.0.1:4100 {
			header_up X-Forwarded-Proto https
		}
	}

	handle {
		# 其余全部给 Headscale：/ts2021、/key、/register、/verify、/api/v1/*、/health、/derp
		reverse_proxy 127.0.0.1:8480 {
			flush_interval -1
			header_up X-Forwarded-Proto https
		}
	}
}
```

这份规则在做四件事：

- **自动 HTTPS**：站点名就是域名本身，Caddy 看到它就会**自动申请证书**，不需要写 `tls`。它通过
  **HTTP-01**（走 `80` 端口）或 **TLS-ALPN-01**（走 `443`）向 Let's Encrypt 证明域名归你所有，
  并在到期前自动续期。证书和 ACME 账户都存在 `/data` 里 —— 也就是挂出来的 `caddy-data/`，
  **这个目录删掉就要重新签发**。所以：`80` 端口必须能通，`caddy-data/` 必须留着。
- **路径分流**：`/admin*` 比兜底的 `handle` 更具体，所以面板优先命中，其余（`/ts2021`、`/key`、
  `/register`、`/verify`、`/api/v1/*`、`/health`、`/derp`）全部落到兜底 `handle` 给 Headscale。
- **`flush_interval -1`**：关掉响应缓冲、立即下发，长连接和日志流不会被卡住。
- **`header_up X-Forwarded-Proto https`**：告诉上游「外面是 HTTPS」，否则面板在
  `cookie_secure: true` 下会出问题（登录跳转、回调地址）。
- **`Host` 不用动**：Caddy 默认**原样透传**客户端的 `Host`（这点和 Nginx 正相反），面板的
  CSRF / 跨站校验依赖它。**不要**在这里加 `header_up Host ...`。
- 根路径的 `302` 只是给人看的：`tailscale` 客户端只请求上面那些路径，从来不 `GET /`，所以这段对
  客户端零影响；不想要可以直接删掉。

## 五、两侧配置要对齐

面板、Headscale、Caddy 三个地方必须对得上，否则会出现「面板能打开但一登录就 403」「注册链接指向
`localhost`」「客户端连不上」这类问题：

| 在哪                       | 键                     | 值                             | 说明                                          |
| -------------------------- | ---------------------- | ------------------------------ | --------------------------------------------- |
| Headscale 的 `config.yaml` | `server_url`           | `https://ha.example.com`       | 客户端要连的地址，**不能带路径**              |
| 面板的 `config.yaml`       | `server.base_url`      | `https://ha.example.com/admin` | 面板自己的地址，**必须带 `/admin`**           |
| 面板的 `config.yaml`       | `server.cookie_secure` | `true`                         | 对外 HTTPS 时必须为 `true`                    |
| 面板的 `config.yaml`       | `headscale.public_url` | `https://ha.example.com`       | 必须与 Headscale 的 `server_url` **逐字一致** |
| 面板的 `config.yaml`       | `headscale.url`        | `http://127.0.0.1:8480`        | 机器内部的 API 地址，不走公网、不用 HTTPS     |

Headscale 侧叫 `server_url`，面板侧对应的字段是 `headscale.public_url`：**两个值必须逐字一样**
（协议 + 域名 + 端口，且都没有路径），注册链接就是用它们拼出来的。面板在容器里时 `headscale.url`
要按网络写：host 网络用 `http://127.0.0.1:8480`，bridge 网络用容器名（如 `http://headscale:8080`）。

::: warning 改 `server_url` 会让已注册节点需要重新注册
`server_url` 会被写进**客户端本地状态**。改完域名、协议或端口以后，已经 `tailscale up` 过的机器
连的还是旧地址，会一直重试失败 —— 要么在客户端执行 `tailscale logout` 再
`tailscale up --login-server https://ha.example.com`，要么把节点在面板里删掉重新注册。
:::

## 六、启动与自检

```bash
cd /opt/headplane
docker compose up -d                 # 起 Headscale、面板和 Caddy
docker compose ps                    # 期望：三个容器都是 running / healthy
docker compose logs caddy --tail=50  # 期望：certificate obtained / serving，没有 error
```

再看三件事，从上到下逐层确认：

```bash
# 1) 域名解析是否已经指向这台服务器（应回显 203.0.113.10）
dig +short ha.example.com            # 没装 dig 就用 getent hosts ha.example.com

# 2) 绕过 Caddy，先确认两个后端本身是活的
curl -s http://127.0.0.1:8480/health         # 期望 {"status":"pass"}
curl -s http://127.0.0.1:4100/admin/healthz  # 期望 {"status":"OK"}

# 3) 再走公网域名（证书由 Caddy 自动签发）
curl -sI  https://ha.example.com/health      # 期望 HTTP/2 200，且证书无警告
curl -si  https://ha.example.com/admin | head -3   # 期望 302 → /admin/
```

第 3 步能通，说明「DNS → 安全组 → Caddy → 证书 → 面板」整条链都对了。第一次申请证书可能要等
十几秒到一分钟，日志里没有 `error` 就先别急着重启。

## 七、验收清单

- [ ] `dig +short ha.example.com` 回显 `203.0.113.10`
- [ ] 用手机流量（不走内网）能打开 `https://ha.example.com/admin`，浏览器**没有**证书警告
- [ ] `curl -sI https://ha.example.com/health` 返回 `200`
- [ ] `https://ha.example.com/derp` **不是** `404`（返回 `426` 之类都正常）
- [ ] 面板能正常登录，看不到 403
- [ ] `tailscale up --login-server https://ha.example.com` 能注册成功
- [ ] `tailscale netcheck` 里 STUN 可用（安全组放行了 `udp/3478`）
- [ ] `docker compose logs caddy` 里没有任何验证失败 / 续期错误

## 八、常见问题

### 1. 证书申请失败 / `80` 不通

日志里出现 `could not get certificate`、`challenge failed`、`timeout`，浏览器提示证书无效。按顺序查：

- **解析没生效**：`dig +short ha.example.com` 必须回显这台服务器的公网 IP。刚改的记录可能要等
  几分钟到几小时，解析还没生效时会被拒绝签发。
- **`80` 被挡**：在外面执行 `curl -I http://ha.example.com`，应该看到 Caddy 的 `301`/`308` 跳转；
  超时就是安全组或系统防火墙没放行。**用手机流量验一次**最准，别在自己机器上自测。
- **备案**：中国大陆服务器先看[第一节](#备案中国大陆服务器必须先备案)，未备案时 `80`/`443` 会被
  中间层拦掉，Caddy 这边只看到超时，看不出别的原因。
- **端口被别的服务占用**：`sudo ss -lntp | grep -E ':80|:443'`，只应该看到 `caddy`。
- **别反复重启试**：Let's Encrypt 有签发频率限制，短时间内反复失败会被限流。改完配置等 1–2 分钟
  再看一次日志。
- **少数环境根本不给 `80`**：那只能用 **DNS-01** 验证，但标准 `caddy:2-alpine` 镜像**不带**任何
  DNS 服务商的插件，需要自己构建带插件的镜像 —— 属于进阶用法，本页只用 HTTP-01 / TLS-ALPN-01。

### 2. 备案还没办完

现象是 `80`/`443` 访问超时，或者被换成云厂商 / 运营商的提示页，Caddy 日志里只有超时、没有配置
错误。这不是 Caddy 的问题：去服务商控制台确认备案进度。临时改用非标端口通常能访问，但请把它当作
过渡方案，**备案要办完**，本页不提供绕过办法。

### 3. 面板 403（`Host` 不对）

面板会做 CSRF / 跨站校验，用**和 `server.base_url` 不一样**的地址访问就会 403。逐条核对：

- 浏览器地址要与 `server.base_url` **逐字一致**：协议 + 域名 + `/admin`，不要用 IP、不要用别的
  子域名、不要多带端口。
- Caddyfile 的站点名必须是同一个域名；**不要改写 `Host`**（Caddy 默认原样透传，别加
  `header_up Host ...`）。
- 如果域名前面还套了 CDN 或另一层反代，确认它把**原始 `Host`** 传了下来。

### 4. `/ts2021`、`/derp` 返回 404

说明请求没走到 Headscale。检查：Caddyfile 里兜底的 `handle` 是否还在（别把 `handle /admin*` 写成
了 `handle /*`，那会把所有路径都交给面板）；回源地址是否误写成 `https://` 或多了个 `/`；改完记得
重载 Caddy（见命令速查）。

### 5. `udp/3478` 漏放行

客户端 `tailscale netcheck` 一直显示 STUN 不可用、打洞失败。`3478/udp` 要在**安全组和系统防火墙
两层**都放行；它和 `443` 的放行是两回事，只开 TCP 不算。

### 6. 改完 `server_url` 后节点全掉线

正常现象，不是故障：`server_url` 写进了客户端本地状态。已经注册过的机器需要**重新注册** ——
`tailscale logout` 再 `tailscale up --login-server https://ha.example.com`，或者在面板里删掉旧节点
重新注册。换域名、换协议（`http` → `https`）、换端口都算。

## 九、命令速查

| 目的                  | 命令                                                                     |
| --------------------- | ------------------------------------------------------------------------ |
| 启动 / 重建           | `cd /opt/headplane && docker compose up -d`                              |
| 看状态 / 看日志       | `docker compose ps` / `docker compose logs caddy --tail=50`              |
| 改完 Caddyfile 只重载 | `docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile`   |
| 校验 Caddyfile 语法   | `docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile` |
| 域名解析              | `dig +short ha.example.com`                                              |
| 后端直连（Headscale） | `curl -s http://127.0.0.1:8480/health`                                   |
| 后端直连（面板）      | `curl -s http://127.0.0.1:4100/admin/healthz`                            |
| 公网整链              | `curl -sI https://ha.example.com/health`                                 |
| 端口占用              | `sudo ss -lntp \| grep -E ':80\|:443'`                                   |
| 看已签发的证书        | `docker compose exec caddy ls /data/caddy/certificates`                  |
| 生成 `cookie_secret`  | `openssl rand -base64 24`                                                |
| 客户端重新注册        | `tailscale logout && tailscale up --login-server https://ha.example.com` |

## 接下来

- 三种访问方式的取舍与 DNS / 证书 / 备案：[域名与访问方式](/install/domains)
- 家里没有公网 `80`/`443` 时怎么走：[反向代理：Lucky + Caddy（家庭 NAS）](/install/reverse-proxy-lucky)
- Headscale 与面板本身怎么装：[Docker](/install/docker) / [双镜像部署](/install/dual-image)
