---
title: 域名与访问方式
description: 单域名与多域名两种教程，讲清哪种方案适合你、DNS 怎么填、证书放在哪一层，以及中国大陆的备案要求。
outline: [2, 3]
---

# 域名与访问方式

这一页只讲**一件事**：怎么让 Headscale 客户端和 HeadplaneCN 面板同时被访问到，包含三种方案的
完整填法、DNS 记录、证书放在哪一层，以及中国大陆的备案要求。具体怎么配反向代理不在这一页：
Lucky 的子规则字段看[家庭 NAS：Lucky + Caddy](/install/reverse-proxy-lucky)，云服务器的
Caddyfile 看[云服务器 Caddy](/install/reverse-proxy-caddy)。下文域名、IP、证书路径全是占位符。

## 需要你改的值

| 占位符                 | 示例                           | 说明                                              | 在哪里改                               |
| ---------------------- | ------------------------------ | ------------------------------------------------- | -------------------------------------- |
| 域名                   | `ha.example.com`               | Headscale 客户端连接的域名，**必须改**            | Headscale 的 `server_url`、DNS、Lucky  |
| 面板域名（方案 C）     | `panel.example.com`            | 只给面板用的子域，**必须改**                      | 面板 `server.base_url`、DNS、Lucky     |
| NAS 局域网 IP          | `192.168.1.10`                 | 运行 Headscale 的 NAS 地址，**必须改**            | 反代回源地址                           |
| 云服务器公网 IP        | `203.0.113.10`                 | 云服务器地址，**必须改**                          | 反代回源地址（一般就是本机）           |
| 对外端口               | `8443`                         | 方案 A / B 的公开端口，**可改**（默认 `443`）     | 反代监听端口、`server_url`、`base_url` |
| `server_url`           | `https://ha.example.com`       | 客户端连接的地址，**不能带路径前缀**              | Headscale 配置                         |
| `server.base_url`      | `https://ha.example.com/admin` | 面板自己的地址，方案 A **必须含 `/admin`**        | 面板 `config.yaml`                     |
| `server.cookie_secure` | `true`                         | 对外是 HTTPS 就写 `true`，**别动**                | 面板 `config.yaml`                     |
| `server.cookie_secret` | `请用上面的命令生成`           | `openssl rand -base64 24`，正好 32 字符，**别动** | 面板 `config.yaml`                     |
| 证书 / 私钥路径        | `/etc/ssl/ha/fullchain.pem`    | 反代那一层读的证书文件，**按你的环境调整**        | Lucky / Caddy 的证书配置               |

::: warning `server_url` 不能带路径前缀
Headscale 会把 `server_url` 当**根地址**用，客户端拼出来的是 `server_url + /ts2021`、`+ /key`、
`+ /register`、`+ /verify`、`+ /api/v1/*`、`+ /health`、`+ /derp`。所以：

- ✅ `https://ha.example.com`、`https://ha.example.com:8443`
- ❌ `https://ha.example.com/headscale`、`https://ha.example.com/ha/`
- 写了路径前缀，客户端会去连 `https://ha.example.com/headscale/ts2021`，**所有节点都上不了线**。
- 改 `server_url` 之后，**已注册的节点必须重新登录**（控制地址变了），改之前先想清楚。
  :::

## 一、先理解一个硬约束

Headscale 的客户端（`tailscaled`）只认 `server_url` 这一个地址，而且**永远访问域名根路径**；
面板是给人看的网页，得有它自己的位置。两者只能靠下面三种办法分开：

| 分开的办法 | 靠什么区分   | 需要一个能按路径分流的反代吗 |
| ---------- | ------------ | ---------------------------- |
| 路径       | `/admin`     | **需要**（Caddy / Nginx）    |
| 端口       | `8443`       | 不需要                       |
| 域名       | 不同的子域名 | 不需要                       |

**为什么路径方案非得有 Caddy / Nginx？** Lucky 的自定义参数只支持 `proxy_set_header`、
`proxy_hide_header`、`add_header`、`proxy_redirect` 四类指令和 `location` / `path` 分组，
**没有 `proxy_pass`** —— 它换不了后端。所以「一个域名 + 路径分流」在 NAS 上必须另跑一个
Caddy 或 Nginx 来分流；端口方案和多域名方案只用 Lucky 的**两条子规则**就够了。

## 二、三种方案怎么选

三种方案都**只监听一个对外端口**（下面以 `8443` 为例，你也可以直接用 `443`）。

| 对比项            | 方案 A：单域名 + 路径分流            | 方案 B：单域名 + 两个端口     | 方案 C：多域名                 |
| ----------------- | ------------------------------------ | ----------------------------- | ------------------------------ |
| 对外地址          | `https://ha.example.com:8443/`       | 同左，端口 `443`              | 同左，端口 `443`               |
| 面板地址          | `https://ha.example.com:8443/admin`  | `https://ha.example.com:8443` | `https://panel.example.com`    |
| `server_url`      | `https://ha.example.com:8443`        | `https://ha.example.com`      | `https://ha.example.com`       |
| `server.base_url` | `https://ha.example.com:8443/admin`  | `https://ha.example.com:8443` | `https://panel.example.com`    |
| 要几张证书        | 1 张，含 `ha.example.com`            | 1 张，同一张证书两个端口都用  | 2 张，或 1 张 `*.example.com`  |
| 要几条反代规则    | 根路径 → Headscale，`/admin*` → 面板 | 两条子规则，按**端口**分开    | 两条子规则，按**域名**分开     |
| NAS 里要有 Caddy  | **要**                               | 不要                          | 不要                           |
| 适合谁            | 想让面板藏在 `/admin`、只开一个口    | 只有一台 NAS、不想再装东西    | 想域名清清爽爽、两边各一个名字 |

::: tip 最省事的选择
家用 NAS + Lucky：**方案 B**（一个域名，靠端口分开，Lucky 两条子规则）。
云服务器 + Caddy：**方案 A**（Caddy 本来就在，顺手分流，只开一个口）。
:::

## 三、方案 A：单域名 + 路径分流

**地址长什么样**：客户端连 `https://ha.example.com:8443`，面板在
`https://ha.example.com:8443/admin`。

```yaml
# Headscale 配置：客户端的地址，根路径，不带 /admin
server_url: https://ha.example.com:8443 # ← 必须改成你的域名 + 对外端口
```

```yaml
# HeadplaneCN 的 config.yaml：面板自己的地址，必须带 /admin
server:
  base_url: "https://ha.example.com:8443/admin" # ← 必须改（注意结尾的 /admin）
  cookie_secure: true # ← 对外 HTTPS 时不能改
  cookie_secret: "请用上面的命令生成" # ← 用 openssl rand -base64 24
```

**反代要几条**：两条，在**同一条路径分流规则**里，而且是在 NAS 里的另一个反代进程
（Caddy 或 Nginx）上 —— Lucky 自己做不到：

| 匹配      | 后端（回源）               | 关键要求                        |
| --------- | -------------------------- | ------------------------------- |
| `/admin*` | `http://192.168.1.10:4100` | 不重写路径（面板就在 `/admin`） |
| 其余全部  | `http://192.168.1.10:8480` | `/ts2021`、`/derp` 原样透传     |

这份 Caddyfile 是**明文 HTTP 分流**：TLS 已经在外层的 Lucky / 路由器上终止，所以
`auto_https off`，端口与回源地址按你的环境调整。完整字段说明与填法见
[家庭 NAS：Lucky + Caddy](/install/reverse-proxy-lucky#路径分流)。

**要注意什么**：`base_url` 漏掉 `/admin` → 保存类操作报 `Unexpected Server Error`；
`/admin*` 不要重写路径（`/admin` 会 302 到 `/admin/`）；兜底那一支给 Headscale，
不能只放行 API 白名单。

## 四、方案 B：单域名 + 两个端口

**地址长什么样**：客户端连 `https://ha.example.com`（443），面板在
`https://ha.example.com:8443`。

```yaml
server_url: https://ha.example.com # ← 必须改（客户端用的地址，443 不用写端口）
```

```yaml
server:
  base_url: "https://ha.example.com:8443" # ← 必须改（面板地址，不带路径）
  cookie_secure: true
  cookie_secret: "请用上面的命令生成"
```

**反代要几条**：Lucky **两条子规则**，不用 Caddy / Nginx。

| 子规则 | 前端域名         | 监听端口 | 后端（回源）               | 匹配 | 路径重写 |
| ------ | ---------------- | -------- | -------------------------- | ---- | -------- |
| ①      | `ha.example.com` | `8443`   | `http://192.168.1.10:4100` | 留空 | 关闭     |
| ②      | `ha.example.com` | `443`    | `http://192.168.1.10:8480` | 留空 | 关闭     |

**要注意什么**：证书是**一张**，同一张证书在 `443` 和 `8443` 两个监听上都挂一遍即可；
两个端口都要勾上 IPv4 与 IPv6（只监听 v4 时纯 IPv6 网络连不上）；后端**只写 `主机:端口`**，
不要补 `/` 或任何路径；改完点「重启规则」才生效。

## 五、方案 C：多域名

**地址长什么样**：客户端连 `https://ha.example.com`，面板在 `https://panel.example.com`。

```yaml
server_url: https://ha.example.com # ← 必须改（Headscale 自己的域名）
```

```yaml
server:
  base_url: "https://panel.example.com" # ← 必须改（面板自己的域名，不带路径）
  cookie_secure: true
  cookie_secret: "请用上面的命令生成"
```

**反代要几条**：Lucky **两条子规则**，按域名分开。

| 子规则 | 前端域名            | 监听端口 | 后端（回源）               | 匹配 | 路径重写 |
| ------ | ------------------- | -------- | -------------------------- | ---- | -------- |
| ①      | `ha.example.com`    | `443`    | `http://192.168.1.10:8480` | 留空 | 关闭     |
| ②      | `panel.example.com` | `443`    | `http://192.168.1.10:4100` | 留空 | 关闭     |

**要注意什么**：**证书要两张**（`ha.example.com` 一张、`panel.example.com` 一张），或者一张
`*.example.com` 泛域名证书，两张的话都要能自动续期；两个域名都要有独立的 DNS 记录；面板换到
子域名后，**OIDC 回调地址**之类的配置也要跟着换成新域名。

## 六、DNS 记录怎么填

把域名指向运行反代的那台机器（家庭 NAS 一般是路由器 / 软路由，云服务器就是它自己）。

| 记录类型 | 主机名              | 指向             | 用在哪                |
| -------- | ------------------- | ---------------- | --------------------- |
| A        | `ha.example.com`    | `203.0.113.10`   | 方案 A / B / C，IPv4  |
| AAAA     | `ha.example.com`    | `2001:db8::10`   | 有公网 IPv6 时再加    |
| A        | `panel.example.com` | `203.0.113.10`   | 只用于方案 C          |
| CNAME    | `panel.example.com` | `ha.example.com` | 可选替代上一条 A 记录 |

- **A / AAAA 才是常态**：家庭宽带的公网 IP 会变，所以要用 **DDNS**（Lucky 自带 DDNS，
  路由器上一般也有）。手填 IP 记录，过几天宽带换代就断了。
- **不要用泛解析**：`*.example.com` 会把拼错的域名、扫描器的随机域名全指到你的服务器上，
  证书和虚拟主机都盖不住它们，只会多出误配置的面板入口和攻击面。**有几种访问方式就写几条记录。**
- **CNAME** 只是少写一个 IP：服务商换 IP、或者想把多个名字指到同一个地方时才用；它指向的
  目标必须还是你自己的域名。
- **IPv6**：域名有 AAAA 记录、反代也确实在监听 IPv6 时，纯 IPv6 网络（部分移动网络、
  IPv6-only VPS）才能连上。注意 **IPv6 没有 NAT，不存在端口转发**：路由器 / NAS 的防火墙要
  **单独**放行 `443` / `8443`（以及 `udp/3478`）的入站，否则域名解析出来的地址根本连不上。

## 七、证书放在哪一层

结论只有一句：**证书永远装在「谁对外监听、谁终止 TLS」那一层**，面板和 Headscale 本身
不用管证书。

| 方案 | 证书装在哪                                        | 装几张                          |
| ---- | ------------------------------------------------- | ------------------------------- |
| A    | 最外层（路由器 / Lucky），再转发给 NAS 内的 Caddy | 1 张，含 `ha.example.com`       |
| B    | 最外层，同一张证书挂在两个监听端口上              | 1 张，含 `ha.example.com`       |
| C    | 最外层，两个域名各挂各的                          | 2 张（或 1 张 `*.example.com`） |

证书从哪来，按你的环境选一种：

| 来源               | 怎么做                                                  | 适合谁                           |
| ------------------ | ------------------------------------------------------- | -------------------------------- |
| **Lucky 里申请**   | DNS API（泛域名必需）或文件方式申请、自动续期           | 家庭 NAS                         |
| **Caddy 自动申请** | 写域名，Caddy 自动完成 ACME 验证与续期（Let's Encrypt） | 有公网 80/443 的云服务器         |
| **自签证书**       | 自己生成，浏览器会警告、客户端可能直接拒绝              | 只在**内网**试验，别用于长期使用 |

::: warning 泛域名证书需要 DNS API
Let's Encrypt 的通配符证书只能用 **DNS-01** 验证签发，也就是要在 Lucky（或 Caddy）里配好
**DNS 服务商的 API 凭据**；只用文件 / HTTP 方式签发不了 `*.example.com`。
:::

## 八、备案（中国大陆）

| 你的服务器在哪   | 要不要备案 | 能直接用 80 / 443 吗 | 家庭用户怎么办         |
| ---------------- | ---------- | -------------------- | ---------------------- |
| 中国大陆         | **要**     | 备案通过后才行       | 拿不到备案资格（见下） |
| 境外（含港澳台） | 不需要     | 可以，直接开自动证书 | 可以直接用 `443`       |

- **大陆服务器必须先做 ICP 备案**，域名才能在 `80` / `443` 上对外提供服务；没备案时访问
  表现为超时，或者被插一个提示页。备案需要**域名实名 + 国内服务器**，通常 **1–20 个工作日**，
  各地管局要求不同，请按你的服务商指引办。
- **家庭宽带没有备案资格**：家宽不是「提供互联网信息服务的服务器」，也没法绑定主体备案。
  所以家庭用户走的是**非标端口（如 `8443`）+ 自备证书**这条路 —— 这不是绕过，而是这种
  网络本来就只能这样做。见[家庭 NAS：Lucky + Caddy](/install/reverse-proxy-lucky)。
- **未备案的大陆服务器用非标端口通常能被访问**，但这是**不符合规定**的状态：一旦被抽查，
  服务可能被中断，也没有稳定性可言。**能用不等于合规，有条件就尽快备案。**
- 本页只说明规则与代价，**不提供任何绕过备案的做法**。

## 九、验收清单

1. **解析对不对**（在你自己的电脑 `192.168.1.20` 上执行）：

   ```bash
   dig +short ha.example.com          # 期望：203.0.113.10（或你的 IPv6 地址）
   ```

2. **证书受不受信任**：

   ```bash
   curl -sI https://ha.example.com:8443/ | head -3
   # 期望：没有证书告警；Headscale 返回 200（空白页，不是 404）
   ```

3. **客户端路径通不通**（关键：不能是 404）：

   ```bash
   curl -si https://ha.example.com:8443/ts2021 | head -3
   # 期望：不是 404（换了协议的报错都属于正常）
   curl -si https://ha.example.com:8443/health
   # 期望：200 且返回 {"status":"pass"}
   ```

4. **面板在不在该在的位置**：

   ```bash
   curl -si https://ha.example.com:8443/admin | head -3   # 期望：302，Location: /admin/
   curl -s  https://ha.example.com:8443/admin/healthz     # 期望：{"status":"OK"}
   ```

5. **客户端能注册**（任意一台装了 Tailscale 的机器）：

   ```bash
   tailscale up --login-server https://ha.example.com:8443
   # 期望：给出登录链接，浏览器打开后能确认这台机器
   ```

6. **面板能登录、表单能保存**：浏览器打开面板地址登录，随便改一个设置保存。报
   `Unexpected Server Error` 就去看下一节第 1 条。

## 十、常见问题

### 1. 面板进去了，但登录后点任何保存都报错

`server.base_url` 与浏览器地址**不完全一致**（协议、域名、端口、`/admin` 四样都要对上），
或者反代把 `Host` 改写成了内网 IP。方案 A 最常见的错是把 `/admin` 漏掉。

### 2. 浏览器能打开面板，客户端却一直连不上

看反代有没有**改写路径**。Headscale 要求 `/ts2021`、`/key`、`/register`、`/verify`、
`/api/v1/*`、`/health`、`/derp` 全部原样透传；只转发 API 白名单时客户端会拿到 404。

### 3. 改了 `server_url` 之后，原来的机器全都要重新注册

这是**预期行为**：控制地址变了，客户端要重新登录。改之前先备份，改完后逐台重新上线，
或者逐台执行 `tailscale up --login-server <新地址>`（必要时先 `tailscale logout`）。

### 4. 家庭宽带用一阵子就断了，重拨之后又能用

公网 IP 变了，而 DNS 里还是旧地址。把 **DDNS** 配起来（Lucky 或路由器自带的都可以），
让它自动更新 A / AAAA 记录。

### 5. 国内服务器 80 / 443 打不开，但换 `8443` 就正常

域名没有完成 ICP 备案。请按服务商指引导备案；本页不建议也不提供任何绕过办法（见第八节）。

接下来：面板自己的证书配置看 [TLS 与证书](/configuration/tls)，装完之后的排查看
[常见问题](/configuration/common-issues)。
