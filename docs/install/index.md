---
title: 安装
description: 选择部署形态、域名方案与反向代理路线，并开始安装。
outline: [2, 3]
---

# 安装

HeadplaneCN 是 Headscale 的 Web 面板。安装本身只有几步，真正需要先想清楚的是**三件事**：

1. **部署形态**：Headscale 跑成原生进程（原生模式），还是也交给 Docker（双镜像模式）；
2. **域名方案**：一个域名一个端口、一个域名两个端口，还是两个域名；
3. **反向代理路线**：家庭 NAS（路由器上的 Lucky 终止 TLS + NAS 内的 Caddy 分流），
   还是云服务器（一台机器上的 Caddy 全包）。

下面先给结论，再给细节。内容多的部分都拆成了独立页面，本页只负责让你选对路。

## 先选部署形态

| 形态                                            | 长什么样                          | 适合谁                                  | 代价                                |
| ----------------------------------------------- | --------------------------------- | --------------------------------------- | ----------------------------------- |
| [受限模式](/install/limited-mode)               | 只有面板，不连 Headscale 配置文件 | 试用、演示                              | 没有网络管理与浏览器 SSH            |
| [原生模式](/install/native-mode)                | 面板直接在宿主机上跑              | 不用 Docker 的 Linux 用户               | 要自己准备 Node.js、systemd         |
| [Docker](/install/docker)                       | 面板一个容器                      | 大多数自托管用户                        | 面板与 Headscale 分离时功能受限     |
| [fnOS（飞牛）· 原生模式](/install/fnos)         | Headscale 原生进程 + 面板容器     | 飞牛 NAS，认证/数据都留在原生 Headscale | 要能让面板读到 Headscale 配置与进程 |
| [fnOS（飞牛）· 双镜像模式](/install/dual-image) | Headscale 与面板各一个容器        | 飞牛 NAS，想让两者都用 Docker 管        | 迁移动了 Headscale 的进程形态       |

::: tip 两种形态怎么选
**只在 NAS 上装一次、想尽量少动现有东西** → 原生模式（Headscale 保持原生进程，面板加个容器）。
**想让两个服务重启、升级、备份各自独立** → 双镜像模式。两者可以互转，
见[模式迁移与回退](/install/migration)，转换前请先备份。
:::

## 再选域名方案

Headscale 有一个硬约束：`server_url` **不能带路径前缀**，客户端永远访问域名的根路径。所以面板只能
另开位置，只有三种现实选择：

| 方案                          | 面板地址                       | 需要 Caddy/Nginx 吗          | 证书                       |
| ----------------------------- | ------------------------------ | ---------------------------- | -------------------------- |
| **单域名 + 路径分流**（推荐） | `https://ha.example.com/admin` | **需要**，放在 NAS 上做分流  | 一张，装在反代那一层       |
| **单域名 + 两个端口**         | `https://ha.example.com:8443`  | 不需要，Lucky 两条子规则即可 | 一张（同一张证书两个端口） |
| **多域名**                    | `https://panel.example.com`    | 不需要                       | 两张（或一张泛域名证书）   |

细节、DNS 记录、证书放置位置与备案问题见[域名与访问方式](/install/domains)。

## 最后选反向代理路线

| 你的环境                                         | 走哪条路                                                     | 为什么                                                                 |
| ------------------------------------------------ | ------------------------------------------------------------ | ---------------------------------------------------------------------- |
| 家庭 NAS、有公网 IP 或可用内网穿透、**无法备案** | [Lucky + NAS 内 Caddy](/install/reverse-proxy-lucky)         | 家宽拿不到 80/443 与备案；TLS 由 Lucky 终止，NAS 里用 Caddy 做路径分流 |
| 一台有公网 IP 的云服务器                         | [云服务器 Caddy](/install/reverse-proxy-caddy)               | 一台机器上 Caddy 全包：自动证书、路径分流，不需要 Lucky                |
| 已有 Nginx / Traefik                             | 参考[原生模式](/install/native-mode#反向代理)里的 Nginx 示例 | 换一个反代不改变分流要求                                               |

::: warning 中国大陆的云服务器需要备案
国内服务器的域名要完成 **ICP 备案**，80/443 才能正常对外提供服务；**境外（含港澳台）服务器不需要备案**，
可以直接用 80/443 加自动证书。家庭宽带走的是非标端口 + 自备证书这条路，因此不需要也不能备案。
详见[云服务器 Caddy](/install/reverse-proxy-caddy#备案中国大陆服务器必须先备案)。
:::

## 安装前要准备的东西

HeadplaneCN 需要一份配置文件才能运行，可以用
[示例文件](https://github.com/CGG888/headplaneCN/blob/main/config.example.yaml)作为起点。几个绕不开的字段：

| 字段                       | 说明                                                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| **`headscale.url`**        | 面板访问 Headscale API 的地址。同机默认 `http://127.0.0.1:8480`（容器里是 `http://headscale:8080`）。                                             |
| **`headscale.public_url`** | 浏览器访问 Headscale 的**外部**地址，要和 `server_url` 一致，用于生成注册链接。                                                                   |
| **`server.base_url`**      | 面板自己的地址（协议 + 域名 + 端口），例如 `https://ha.example.com:8443`。**不要带 `/admin`** —— 面板固定挂在 `/admin` 下，那个前缀是它自己加的。 |
| **`server.cookie_secret`** | 加密 cookie。用 `openssl rand -base64 24` 生成。**换掉它会让所有人重新登录。**                                                                    |
| **`server.cookie_secure`** | 只要对外是 HTTPS 就设 `true`。                                                                                                                    |
| **`server.data_path`**     | 面板自己的数据库目录，Docker 里要挂出来。                                                                                                         |

运行 HeadplaneCN 的用户（或容器）需要：`server.data_path` 可写、`headscale.config_path` 可读；
要在界面里改 Headscale 设置或重启它，还需要[对应的集成](/install/fnos)（原生模式的 proc
集成，或双镜像模式的 Docker 集成）。

还需要一把 Headscale API 密钥：

```bash
# 在运行 Headscale 的机器上执行，按需调整有效期
headscale apikeys create --expiration 90d
```

## 装完之后的验收

不管走哪条路，装完都应当能通过这四条检查（每条在对应教程里都有具体命令）：

1. `https://<你的地址>/health` 返回 `200`，`/admin` 跳到 `302` 并打开登录页；
2. `POST /ts2021` **不是 404**（新客户端靠它上线，404 说明路径被反代改写了）；
3. `https://<你的地址>/derp` 返回 `426` 或 `400`（说明 DERP 链路通了，不是 404）；
4. 用 `tailscale up --login-server https://<你的地址>` 能注册出一台设备。

## 接下来

- 需要转换部署形态：[模式迁移与回退](/install/migration)
- 需要 DERP 中继与区域镜像：[DERP 与中继](/configuration/derp)
- 面板的证书与 TLS 细节：[TLS 与证书](/configuration/tls)
- 装完出问题：[常见问题](/configuration/common-issues)
