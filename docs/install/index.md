---
title: 安装
description: 开始使用 HeadplaneCN。
outline: [2, 3]
---

# 安装

HeadplaneCN 可以部署在多种环境里，方便它无缝融入你现有的基础设施。请先准备好配置文件，再选择
最适合你的安装方式。

## 配置

HeadplaneCN 需要一份配置文件才能运行。可以使用
[示例文件](https://github.com/CGG888/headplaneCN/blob/main/config.example.yaml)作为起点。其中几个
重要字段：

| 字段                       | 说明                                                                                            |
| -------------------------- | ----------------------------------------------------------------------------------------------- |
| **`headscale.url`**        | 指向你的 Headscale 服务器（例如 `http://headscale.example.com`，在 Docker 里是 `http://headscale:8080`）。 |
| **`server.cookie_secret`** | 用于加密 cookie。可以用 `openssl rand -base64 24` 这类命令生成随机串。                            |
| **`server.data_path`**     | 只是一个要记住的路径，尤其是使用 Docker 时。                                                      |

配置文件的选项远不止这些，也复杂得多。关于所有可用选项的详细说明，以及如何通过密钥文件路径选项
和环境变量安全地设置这些值，请参考[配置](../configuration/index.md)指南。

## 部署方式

HeadplaneCN 有多种部署方式，各有优缺点。请选择最适合你的那一种：

### [Docker](/install/docker)：用 Docker 快速、简单地部署

- 因为简单易用，推荐大多数用户选择。
- 支持网络管理、浏览器远程 SSH 等高级功能。
- 需要安装 Docker 与 Docker Compose。

---

### [原生模式](/install/native-mode)：直接安装在服务器上

- 适合不想使用 Docker 的用户。
- 同样支持网络管理、浏览器远程 SSH 等高级功能。
- 需要手动准备依赖与运行环境。

---

### [受限模式](/install/limited-mode)：功能最少、最省事的部署

- 适合测试或简单环境，不适用于生产。
- 没有任何高级功能或集成，例如网络管理或浏览器远程 SSH。

---

### [fnOS（飞牛）](/install/fnos)：在飞牛 NAS 上部署

- 面向以 fnOS 应用源原生运行 Headscale、再用 Docker 运行 HeadplaneCN 的 NAS 部署方式。
- 包含可直接使用的配置文件、反向代理要点与逐条排查方法。
