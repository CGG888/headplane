# HeadplaneCN

> **HeadplaneCN** 是 [Headplane](https://github.com/tale/headplane) 的分支（fork），面向**自托管 NAS** 场景调优，
> 尤其是**飞牛 fnOS** 这类「headscale 以原生进程运行、面板跑在 Docker 里」的部署。
> 在保留上游全部功能的基础上，本分支补齐了三语界面，并新增 DERP 地图在线编辑、中继地址自动同步、
> 官方区域镜像、告警通知、配置快照与操作审计等能力。

[![镜像：ghcr.io/cgg888/headplanecn](https://img.shields.io/badge/ghcr.io-cgg888%2Fheadplanecn-2496ED?logo=docker&logoColor=white)](https://cgg888.github.io/headplaneCN/install/)
[![许可证：MIT](https://img.shields.io/badge/license-MIT-green)](./LICENSE)

**快速入口**：[中文文档](https://cgg888.github.io/headplaneCN/) ·
[English docs](https://cgg888.github.io/headplaneCN/en/) ·
[问题反馈](https://github.com/CGG888/headplaneCN/issues) ·
[变更日志](./CHANGELOG.md)

![机器列表：状态、地址、在线时间、路由与标签](./docs/assets/1.png)

## 这是什么

Headscale 是 Tailscale 的**开源自托管控制端**（基于 WireGuard），官方**不带** Web 界面。
HeadplaneCN 给它补上前端：机器、用户、访问控制（ACL）、DNS 与 Headscale 设置，都能在浏览器里管理。

本分支针对「NAS 上原生跑 headscale + Docker 跑面板 + 反向代理」这类部署做了适配，
最典型的是**飞牛 fnOS**：fnOS 官方应用中心不提供 headscale，需要先添加第三方应用源
`github.com/conversun/fnos-store` 安装 fpk 包，由该包**以原生进程运行 headscale**
（安装步骤与两份可直接使用的配置文件见[中文文档的 fnOS 安装指南](https://cgg888.github.io/headplaneCN/install/fnos)）。

核心能力：机器过期时间/路由/改名/属主/标签、批量操作、ACL 与 SSH 规则（**需 Headscale `policy.mode: database`**，
文件模式下只能查看）、用户与预授权密钥、API Key 管理、DNS 记录与 Headscale 设置编辑、OIDC 单点登录与代理认证、
浏览器 SSH（需 Agent 集成 + 目标节点开启 `tailscale up --ssh` + OIDC 登录）。

## 相对上游的新增能力

- **DERP 地图在线编辑**：`derp.paths` 里的每个本地地图文件都能在浏览器里查看（带行号）、编辑、保存、回滚，
  还提供三份带注释的示例模板；保存前自动快照该文件，服务端强校验 YAML 与 DERP map 结构
  （区域 id/code 唯一、节点主机名与端口合法），失败时给出本地化原因，仅在可写挂载下才允许保存。
- **中继地址自动同步**：按 6/12/24 小时或手动「立即运行」检测并写入 `derp.server.ipv4` / `ipv6`——
  只在实际变化时写入、只改变化的键，写前自动快照并记入审计，失败发出告警；可选自动重载（默认开启，
  会短暂中断客户端）。「检查」只预演不写入。
- **可选的外部 IPv6 回显**（默认关闭）：只走 IPv6 询问公共回显服务，回答「互联网实际看到的地址」，
  适配 NAT66 / 路由器转发的场景。
- **官方区域镜像与筛选**：把 Tailscale 官方公共 DERP 区域按需镜像成一份本地地图文件下发给客户端，
  重新编号到 **900 段**——从 **901** 起**按 Agent 实测延迟**排序（没有固定区域，默认一个
  都不勾选），已分配的编号保持稳定；表格支持按延迟排序、筛选与「最快三个」预设。
- **告警通知**：Webhook 推送 Headscale 失联与恢复、节点掉线与恢复、密钥即将过期、配置检查失败，
  含冷却时间、投递历史与测试按钮。
- **配置快照与操作审计**：设置页可一键生成配置快照并回滚，审计页记录谁在什么时候改了什么，支持导出 CSV / JSON。
- **三语界面**：English / 简体中文 / 繁體中文。

## 界面语言

| 语言     | 标识      |
| -------- | --------- |
| English  | `en`      |
| 简体中文 | `zh-Hans` |
| 繁體中文 | `zh-Hant` |

- **切换位置**：登录后点右上角**头像菜单**里的语言项；未登录时点**登录页右上角的地球按钮**。
- **生效方式**：选择写入 `locale` cookie 并由**服务端渲染**，页头、表格、对话框、登录页、404 与权限错误提示全部跟随，时间格式也跟随。
- **首次访问**：读取浏览器 `Accept-Language` 自动匹配，匹配不到时用英文。
- Headscale API 报错、服务端日志与内部校验信息由上游产生，保持英文。

## 部署

镜像：`ghcr.io/cgg888/headplanecn`，标签为 `latest`、`x.y.z`，以及带 `-shell` 后缀的调试镜像（含 shell/curl，便于进容器排查）。
完整步骤见[中文文档](https://cgg888.github.io/headplaneCN/)。NAS 上有两种形态：

- **双镜像部署（推荐）**：[Headscale 与 HeadplaneCN 各跑一个容器](https://cgg888.github.io/headplaneCN/install/dual-image)，
  host 网络，Headscale 数据目录以**同一绝对路径**挂载，配置里的绝对路径一个字都不用改；
  保存配置由 **Docker 集成**重启 Headscale 容器。
- **fnOS 原生形态**：[fnOS（飞牛）安装指南](https://cgg888.github.io/headplaneCN/install/fnos)：
  Headscale 由 fnOS 应用原生运行，面板容器用 `integration.proc`（SIGHUP）重载。

两种形态可以互转（含双向步骤与失败回退），见[模式迁移与回退](https://cgg888.github.io/headplaneCN/install/migration)。

对外怎么访问，按你的环境选一条路：家庭 NAS 用
[Lucky + NAS 内 Caddy](https://cgg888.github.io/headplaneCN/install/reverse-proxy-lucky)
（家宽无法备案，TLS 在路由器上的 Lucky 终止，NAS 里的 Caddy 按路径把 `/admin` 分给面板）；有公网 IP 的云服务器直接用
[Caddy](https://cgg888.github.io/headplaneCN/install/reverse-proxy-caddy)
（一台机器全包，中国大陆服务器需先完成 ICP 备案，境外服务器不需要）。单域名、单域名两个端口、多域名怎么选，
DNS 与证书放在哪一层，见[域名与访问方式](https://cgg888.github.io/headplaneCN/install/domains)。

双镜像形态配套了交互式安装脚本 [`scripts/dual-image-install.sh`](./scripts/dual-image-install.sh)：所有环境相关的值
（含各目录布局）都会逐个询问并校验，`--dry-run` 只打印计划不写文件，也不会有任何删除数据的动作。

`.env`（一处改版本，整栈跟随）：

```ini
HEADSCALE_VERSION=0.29.4
HEADPLANE_VERSION=0.22.23
HEADSCALE_UID=0
HEADSCALE_GID=0
BASE_DIR=/vol1/1000/APP/headplaneCN
PANEL_BIND=0.0.0.0
PANEL_PORT=4100
TZ=Asia/Shanghai
```

`docker-compose.yml`：

```yaml
services:
  # 拉取 ghcr.io 慢时，可在官方镜像名前加代理前缀，例如 v6.gh-proxy.org/docker/ghcr.io/juanfont/headscale
  headscale:
    image: headscale/headscale:${HEADSCALE_VERSION}
    container_name: headscale
    restart: unless-stopped
    network_mode: host # host 模式下不能再写 ports / extra_hosts
    read_only: true
    tmpfs: ["/var/run/headscale", "/tmp"]
    user: "${HEADSCALE_UID:-0}:${HEADSCALE_GID:-0}"
    labels:
      me.tale.headplane.target: "headscale" # Docker 集成靠这个标签找到容器
    volumes:
      - "${BASE_DIR}/headscale/config.yaml:/etc/headscale/config.yaml:ro"
      # 关键：数据目录按同一绝对路径挂载，Headscale 配置里的绝对路径无需修改
      - "${BASE_DIR}/headscale:${BASE_DIR}/headscale"
    command: serve
    healthcheck:
      test: ["CMD", "headscale", "health"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s

  headplaneCN:
    image: ghcr.io/cgg888/headplanecn:${HEADPLANE_VERSION}
    container_name: headplaneCN
    restart: unless-stopped
    network_mode: host
    depends_on: [headscale]
    volumes:
      - "${BASE_DIR}/config.yaml:/etc/headplane/config.yaml:ro"
      - "${BASE_DIR}/data:/var/lib/headplane"
      # 面板要在保存 DERP 等设置时改写这份配置，所以不能加 :ro
      - "${BASE_DIR}/headscale/config.yaml:/etc/headscale/config.yaml"
      - "${BASE_DIR}/headscale:${BASE_DIR}/headscale:ro"
      # Docker 集成：保存配置后重启 headscale 容器。挂上它就等于交出 Docker 控制权
      - "/var/run/docker.sock:/var/run/docker.sock"
    environment:
      - "TZ=${TZ:-Asia/Shanghai}"
      - "HEADPLANE_SERVER__HOST=${PANEL_BIND}"
      - "HEADPLANE_SERVER__PORT=${PANEL_PORT}"
      - "HEADPLANE_HEADSCALE__CONFIG_PATH=/etc/headscale/config.yaml"
      - "HEADPLANE_INTEGRATION__DOCKER__ENABLED=true"
      - "HEADPLANE_INTEGRATION__DOCKER__CONTAINER_NAME=headscale"
      - "HEADPLANE_INTEGRATION__PROC__ENABLED=false"
    # 面板镜像自带的探针探测 127.0.0.1，绑定具体 IP 时会误报 unhealthy；按实际绑定覆盖
    healthcheck:
      test:
        [
          "CMD",
          "/nodejs/bin/node",
          "-e",
          "fetch('http://${PANEL_BIND}:${PANEL_PORT}/admin/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",
        ]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s
```

**五个关键点**

1. **`network_mode: host`**：容器内的 `127.0.0.1` 就是宿主机，因此能直接访问只监听本机的 Headscale；
   host 模式下不能再写 `ports` / `extra_hosts`。
2. **同一绝对路径**：Headscale 配置里的 `sqlite.path`、`noise.private_key_path`、`derp.server.private_key_path`、
   `derp.paths`、`unix_socket` 都是**宿主机路径**。把这些目录按**逐字相同**的路径挂进 headscale 容器，
   配置就一个字都不用改（面板容器同样按相同路径挂载，才能读写同一份 `derp.paths` 文件）。
3. **Docker 集成取代 SIGHUP**：面板通过 `/var/run/docker.sock` 重启 `headscale` 容器，所以
   **不需要** `pid: host`（那是 `integration.proc` 读 `/proc` 用的，仅 Agent 可能还需要）、
   也**不需要** `security_opt: ["apparmor=unconfined"]`。挂上 `docker.sock` 就等于把 Docker 的
   控制权交给面板（`:ro` 只保护 socket 文件本身，挡不住 API 调用），所以请确保面板自身的访问控制到位。
4. **Headscale 配置必须读写挂载**：把**生效的那份** `config.yaml` 挂进面板容器且**不加 `:ro`**，
   并让面板的 `headscale.config_path` 指向同一个容器内路径——这是设置页能保存的前提。
5. **`derp.paths` 里的文件**：Headscale 读的是宿主机上的那份文件，容器内的挂载点必须与它**逐字相同**
   （不要写成 `/etc/headscale/derp-maps` 这类容器专用路径），否则网页看不到它，或者 Headscale 重载时报
   `getting DERPMap: open ...: no such file or directory`。面板「官方区域筛选」的目标文件默认按
   Headscale 实况配置自动推导，若你的数据目录换过位置，在设置页里确认一次即可。

**安全提醒**

- `server.cookie_secret` 必须正好 32 个字符并保密（`openssl rand -base64 24`）。
- Headscale 的 API Key 只在创建时显示一次；泄漏后用 `headscale apikeys expire --prefix <前缀>` 撤销后重建。
- `/var/run/docker.sock` 等于宿主机的 root 权限：只在需要 Docker 集成时挂载，并把面板的访问控制与反代做好；
  不需要自动重启 Headscale 时，改为挂 `:ro` 或去掉这一行，同时把 `integration.proc.enabled` / `docker.enabled` 关掉。

## 文档

- **中文文档（主站，位于站点根路径）**：<https://cgg888.github.io/headplaneCN/>
- **English docs（位于 `/en/`）**：<https://cgg888.github.io/headplaneCN/en/>
- 变更记录：[CHANGELOG.md](./CHANGELOG.md)；贡献规范：[docs/en/CONTRIBUTING.md](./docs/en/CONTRIBUTING.md)

## 版本记录

完整的版本记录（每个版本做了什么）见文档站：<https://cgg888.github.io/headplaneCN/versions>（English 站点：<https://cgg888.github.io/headplaneCN/en/>）；
详细英文变更日志见 [CHANGELOG.md](./CHANGELOG.md)。

## 反馈与贡献

欢迎提交 issue 与 PR：<https://github.com/CGG888/headplaneCN/issues>

## 致谢

HeadplaneCN 是 **[Headplane](https://github.com/tale/headplane)** 的分支（fork）。
Headplane 由 Aarnav Tale 及其贡献者开发维护，本分支的全部功能都建立在他们的工作之上 ——
**没有上游项目，就没有这个分支**。

- 上游仓库：<https://github.com/tale/headplane>
- 上游文档：<https://headplane.net>

上游本身的问题请提到上游仓库；本分支特有的改动、部署方式与问题，请提到本仓库的 issue。

## 许可

本项目沿用上游的 **MIT License**，完整文本见 [LICENSE](./LICENSE)，
版权声明为 `Copyright (c) 2024 Aarnav Tale`。MIT 许可允许使用、复制、修改、合并、发布、分发、
再许可与销售本软件，但要求保留上述版权声明与本许可声明。
