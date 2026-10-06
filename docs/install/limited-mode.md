---
title: 受限模式
description: 以受限模式安装 Headplane。
---

# 受限模式

::: warning
**受限模式不推荐用于生产环境。**
生产部署请考虑其他安装方式。受限模式缺少网络管理、浏览器远程 SSH 等高级功能。
:::

受限模式适合想先试试 Headplane **基本**功能的用户。它只与 Headplane API 交互，没有任何高级
功能，因此适合本地测试与开发。

## 前置条件

- Docker（可选 Docker Compose）
- 已安装并运行 Headscale 0.27.0 或更新版本
- 一份[填写完成的配置文件](./index.md)（Headplane 用）。

## 安装

::: tip
想不用 Docker 试用受限模式，可以按[原生模式](/install/native-mode)指南安装，只是不配置
任何高级功能。
:::

以受限模式运行 Headplane 只需要一条命令：

```bash
docker run -d \
    -p 3000:3000 \
    -v /path/to/your/config.yaml:/etc/headplane/config.yaml \
    -v /path/to/data/storage:/var/lib/headplane \
    --name headplane
    --restart unless-stopped
    ghcr.io/cgg888/headplanecn:latest
```

挂载配置文件、并给 Headplane 一个持久化存储位置来保存自己的数据，这两点很重要。想换端口运行，
改端口映射即可。

### 可选：Docker Compose

更喜欢用 Docker Compose 的话，下面是以受限模式运行 Headplane 的最小 `compose.yaml` 示例：

```yaml
services:
  headplane:
    image: ghcr.io/cgg888/headplanecn:latest
    container_name: headplane
    restart: unless-stopped
    ports:
      - "3000:3000"
    volumes:
      - "/path/to/your/config.yaml:/etc/headplane/config.yaml"
      - "/path/to/data/storage:/var/lib/headplane"
```

## 访问 Headplane

容器启动后，在浏览器里打开 `http://localhost:3000/admin` 就能访问 Headplane 界面（如果不是
在本机运行，把 `localhost` 换成服务器的 IP 地址或域名）。

登录需要提供一把 Headscale API 密钥。可以在 Headscale 环境里执行下面的命令创建：

```bash
# 按需调整有效期
headscale apikeys create --expiration 90d
```

受限模式面向测试与开发，请不要在生产环境使用。生产部署请选择其他安装方式，它们既提供 Headplane
的高级功能，也更稳健。

受限模式在技术上支持单点登录（SSO）认证（该部分说明目前只有英文版），但其中部分功能可能无法按预期工作。
想要完整的 SSO 体验，请使用其他安装方式。
