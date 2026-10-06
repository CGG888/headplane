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
  重新编号到 **900 段**——**901 香港 / 902 新加坡**固定，其余 903+ **按 Agent 实测延迟**排序，
  已分配的编号保持稳定；表格支持按延迟排序、筛选与「最快三个」预设。
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
完整步骤见[中文文档](https://cgg888.github.io/headplaneCN/)，其中
[fnOS（飞牛）安装指南](https://cgg888.github.io/headplaneCN/install/fnos) 含可直接使用的 `config.yaml` 与 `docker-compose.yml`。

```yaml
services:
  headplane:
    image: ghcr.io/cgg888/headplanecn:latest
    container_name: headplane
    restart: unless-stopped

    # host 网络：容器内 127.0.0.1 就是宿主机，可直接访问只监听本机的原生 headscale
    # host 模式下不能再写 ports / extra_hosts
    network_mode: host

    # 共享宿主机 PID 命名空间：原生进程集成要读 /proc 找到 headscale 进程
    pid: host

    volumes:
      - "/path/to/headplane/config.yaml:/etc/headplane/config.yaml:ro"
      - "/path/to/headplane/data:/var/lib/headplane"
      # 关键：headscale 的生效配置必须读写挂载，不能加 :ro
      - "/path/to/headscale/config.yaml:/etc/headscale/config.yaml"

    environment:
      - "HEADPLANE_HEADSCALE__CONFIG_PATH=/etc/headscale/config.yaml"
      - "HEADPLANE_INTEGRATION__PROC__ENABLED=true"
      - "HEADPLANE_INTEGRATION__AGENT__ENABLED=true"
```

**四个关键点**

1. **`network_mode: host`**：容器内的 `127.0.0.1` 就是宿主机，因此能直接访问只监听本机的 headscale；
   host 模式下不能再写 `ports` / `extra_hosts`。
2. **`pid: host`**：原生进程集成（`integration.proc`）需要读 `/proc` 才能找到 `headscale serve` 进程并发送 SIGHUP，
   否则保存配置后不会生效。
3. **Headscale 配置必须读写挂载**：把**生效的那份** `config.yaml` 挂进容器且**不加 `:ro`**
   （例如 `/etc/headscale/config.yaml`），并让 `headscale.config_path` 指向同一个容器内路径——
   这是 DNS / 设置入口出现、并且能保存的前提。
4. **`derp.paths` 必须写宿主机路径，容器按相同绝对路径挂载**：Headscale 读的是宿主机上的那份文件，
   容器内的挂载点必须与它**逐字相同**（不要写成 `/etc/headscale/derp-maps` 这类容器专用路径），
   并以读写方式挂载；否则网页看不到它，或者 Headscale 重载时报
   `getting DERPMap: open ...: no such file or directory`。

**安全提醒**

- `server.cookie_secret` 必须正好 32 个字符并保密（`openssl rand -base64 24`）。
- Headscale 的 API Key 只在创建时显示一次；泄漏后用 `headscale apikeys expire --prefix <前缀>` 撤销后重建。
- 不要把 `/var/run/docker.sock` 随意挂进容器 —— 那等于把宿主机的 root 权限交给容器。

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
