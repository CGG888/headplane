---
title: Headscale HTTP API 参考
description: Headscale HTTP API 的端点全表，以及 HeadplaneCN 对每个端点的实现覆盖情况。
outline: [2, 3]
---

# Headscale HTTP API 参考

> 生成时间：**2026-10-06** ｜ 规格版本：**`version not set`**（`info.version` 字段原样如此，规格自身未携带版本号）
> 规格来源：`GET https://headscale.example.com/swagger/v1/openapiv2.json`
> 覆盖结论以同一时刻的仓库代码为准；行号可能随代码变动而漂移。

本页回答两个问题：Headscale 的 HTTP API 到底有哪些端点；本项目的客户端与界面实现到了哪一步。
每一行的“使用位置”都指向真实文件，便于复核。

## 目录

- [概述](#概述)
- [覆盖矩阵](#覆盖矩阵)
- [节点](#节点)
- [用户](#用户)
- [策略](#策略)
- [预授权密钥](#预授权密钥)
- [API 密钥](#api-密钥)
- [认证与注册](#认证与注册)
- [健康检查](#健康检查)
- [调试](#调试)
- [未实现与部分实现清单](#未实现与部分实现清单)
- [如何验证](#如何验证)
- [附录：规格之外的端点](#附录规格之外的端点)

## 概述

**这是什么。** Headscale 的 HTTP API 是它 gRPC 服务 `headscale.v1.HeadscaleService` 的 JSON 映射。本规格的
`info.title` 是 `headscale/v1/headscale.proto`，`swagger` 为 `2.0`，只有一个 tag `HeadscaleService`，所有
`operationId` 都是 `HeadscaleService_*`（例如 `HeadscaleService_ListNodes`），这是 grpc-gateway 从 proto 生成的
典型特征。也就是说：**规格只描述 HTTP 这一半**；如果 Headscale 还暴露了只能在原生 gRPC 上访问的能力，本规格
不包含它（待确认，无法从规格本身判断）。

**基础路径。** 全部端点都在 `/api/v1` 之下。

**鉴权。** 统一使用 `Authorization: Bearer <API key>`。需要注意：本规格**没有** `securityDefinitions`
区块，鉴权方式并非从规格读出，而是来自 Headscale 的实际行为与本项目代码
（`app/server/headscale/api/transport.ts:91` 为每个请求加上该头）。本项目的请求还会附带
`Accept: application/json` 与 `User-Agent: Headplane/<版本>`。

**密钥从哪来。** 在 Headscale 服务器上用 CLI 创建，例如
`headscale apikeys create --expiration 90d`；创建后只能在 Headplane 的 **设置 → API 密钥** 页面
（`POST /api/v1/apikey`）看到一次性明文——但那个页面本身就需要一把有效密钥，所以**首次必须用 CLI**。
本项目从配置项 `headscale.api_key` 读取服务端使用的密钥，回退到已弃用的 `oidc.headscale_api_key`
（`app/server/context.ts:56-58`）。登录 Headplane 时用户输入的密钥与之无关，是会话级的另一把。

**gRPC / HTTP 之分。** 规格里没有任何 gRPC 专属条目，所有 `operationId` 都对应同一套 `/api/v1` 路径。
Headscale 自带的原生 gRPC 监听端口（默认 `50443`）是否在本操作者的部署中开放，无法从规格判断——**待确认**。
本项目只用 HTTP。

**在线 Swagger UI。** `https://headscale.example.com/swagger`，其中的 “Explore” 指向
`https://headscale.example.com/swagger/v1/openapiv2.json`。请把 `headscale.example.com` 换成你自己的地址；
本文档全篇使用占位符，不记录任何真实域名、IP 或密钥。

**规格的一个坑。** 规格里的 `summary` 字段并不是接口说明，而是 proto 文件的分节注释，例如
`"summary": "--- ApiKeys start ---"`、`"--- Node start ---"`、`"--- Health start ---"`。本文的「能力说明」
一列是依据 `operationId` 与端点语义写出的，不是从 `summary` 抄来的。

## 覆盖矩阵

状态口径：**已实现** = 客户端封装的参数/响应能用且至少有一个界面调用点；**部分** = 端点可用但规格声明的
某些参数本项目从不使用；**未实现** = 代码中没有任何调用点。

### 节点

| 方法   | 路径                                     | 能力说明               | 状态   | 使用位置（文件与页面）                                                                 | 备注                           |
| ------ | ---------------------------------------- | ---------------------- | ------ | -------------------------------------------------------------------------------------- | ------------------------------ |
| GET    | `/api/v1/node`                           | 列出节点，可带用户过滤 | 部分   | `api/resources/nodes.ts:50`；`live-store.ts:123`（5 秒轮询）→ `/machines`、`/overview` | 规格的 `user` 查询参数未被使用 |
| GET    | `/api/v1/node/{nodeId}`                  | 读取单个节点           | 已实现 | `api/resources/nodes.ts:58` → `/machines/:id`、`machine-actions.ts:249`                |                                |
| DELETE | `/api/v1/node/{nodeId}`                  | 删除节点               | 已实现 | `api/resources/nodes.ts:66` → `/machines/:id` 删除对话框、批量删除                     | 不可逆                         |
| POST   | `/api/v1/node/register`                  | 用注册密钥登记新节点   | 已实现 | `api/resources/nodes.ts:69` → `/machines` 新建机器对话框                               | 查询串与 body 同时发送         |
| POST   | `/api/v1/node/{nodeId}/approve_routes`   | 批准子网路由           | 已实现 | `api/resources/nodes.ts:88` → `/machines/:id` 路由对话框                               | 全量覆盖，非增量               |
| POST   | `/api/v1/node/{nodeId}/expire`           | 设置或取消密钥过期     | 已实现 | `api/resources/nodes.ts:96,114,121` → 过期对话框、批量过期                             | 三种调用形态                   |
| POST   | `/api/v1/node/{nodeId}/rename/{newName}` | 重命名节点             | 已实现 | `api/resources/nodes.ts:99` → 重命名对话框                                             | 名称需自行转义                 |
| POST   | `/api/v1/node/{nodeId}/tags`             | 覆盖节点标签           | 已实现 | `api/resources/nodes.ts:106` → 标签对话框、批量标签                                    | 全量覆盖                       |
| POST   | `/api/v1/node/backfillips`               | 回填缺失的节点 IP      | 未实现 | 无调用点                                                                               | `confirmed` 语义待确认         |

### 用户

| 方法   | 路径                                    | 能力说明               | 状态   | 使用位置（文件与页面）                                                                           | 备注                   |
| ------ | --------------------------------------- | ---------------------- | ------ | ------------------------------------------------------------------------------------------------ | ---------------------- |
| GET    | `/api/v1/user`                          | 列出用户，支持三种过滤 | 已实现 | `api/resources/users.ts:32`；`live-store.ts:129`（15 秒轮询）→ `/users`、`/ssh/:id`、`/overview` | 过滤参数互斥，见下文   |
| POST   | `/api/v1/user`                          | 创建用户               | 已实现 | `api/resources/users.ts:46` → `/users` 创建用户对话框                                            |                        |
| DELETE | `/api/v1/user/{id}`                     | 删除用户               | 已实现 | `api/resources/users.ts:55` → `/users` 删除用户对话框                                            | 与节点的级联行为待确认 |
| POST   | `/api/v1/user/{oldId}/rename/{newName}` | 重命名用户             | 已实现 | `api/resources/users.ts:58` → `/users` 重命名用户对话框                                          | 同时会改写策略里的组名 |

### 策略

| 方法 | 路径                   | 能力说明           | 状态   | 使用位置（文件与页面）                                                         | 备注                  |
| ---- | ---------------------- | ------------------ | ------ | ------------------------------------------------------------------------------ | --------------------- |
| GET  | `/api/v1/policy`       | 读取当前策略       | 已实现 | `api/resources/policy.ts:20` → `/acls`、`/users`、`/machines`、`/machines/:id` | 策略以字符串传输      |
| PUT  | `/api/v1/policy`       | 覆盖写入策略       | 已实现 | `api/resources/policy.ts:38` → `/acls` 保存；`/users` 用户分组对话框           | 本项目自己负责序列化  |
| POST | `/api/v1/policy/check` | 仅校验策略，不落库 | 已实现 | `api/resources/policy.ts:30` → `/acls`（`acl-action.ts:85`）                   | 通过时返回空对象 `{}` |

### 预授权密钥

| 方法   | 路径                        | 能力说明           | 状态   | 使用位置（文件与页面）                                                                          | 备注                           |
| ------ | --------------------------- | ------------------ | ------ | ----------------------------------------------------------------------------------------------- | ------------------------------ |
| GET    | `/api/v1/preauthkey`        | 列出预授权密钥     | 已实现 | `api/resources/pre-auth-keys.ts:36,81` → 设置 → 预授权密钥、`/overview`                         | 规格未列出 `user` 参数，待确认 |
| POST   | `/api/v1/preauthkey`        | 创建预授权密钥     | 已实现 | `api/resources/pre-auth-keys.ts:43` → 设置 → 预授权密钥、`/ssh/:id`、Agent（`hp-agent.ts:129`） | 支持无属主的 tag-only 密钥     |
| POST   | `/api/v1/preauthkey/expire` | 使预授权密钥失效   | 已实现 | `api/resources/pre-auth-keys.ts:58` → 设置 → 预授权密钥                                         | 0.28 前后报文不同              |
| DELETE | `/api/v1/preauthkey`        | 删除预授权密钥记录 | 已实现 | `api/resources/pre-auth-keys.ts:96` → 设置 → 预授权密钥（单行删除、一键清理已过期）             | 0.28+ 才有；按稳定 id 删除     |

### API 密钥

| 方法   | 路径                      | 能力说明          | 状态   | 使用位置（文件与页面）                                                                               | 备注                       |
| ------ | ------------------------- | ----------------- | ------ | ---------------------------------------------------------------------------------------------------- | -------------------------- |
| GET    | `/api/v1/apikey`          | 列出 API 密钥     | 已实现 | `api/resources/api-keys.ts:29` → 设置 → API 密钥、设置 → 系统、登录校验、`/overview`、布局、告警服务 | 密钥前缀是掩码形式         |
| POST   | `/api/v1/apikey`          | 创建 API 密钥     | 已实现 | `api/resources/api-keys.ts:38` → 设置 → API 密钥 新建对话框                                          | 明文只返回一次             |
| POST   | `/api/v1/apikey/expire`   | 立即吊销 API 密钥 | 已实现 | `api/resources/api-keys.ts:48` → 设置 → API 密钥 吊销对话框、批量吊销                                | 只发 `prefix`              |
| DELETE | `/api/v1/apikey/{prefix}` | 删除 API 密钥记录 | 未实现 | 无调用点                                                                                             | 规格另有可选 `id` 查询参数 |

### 认证与注册

| 方法 | 路径                    | 能力说明             | 状态   | 使用位置（文件与页面）                                           | 备注                            |
| ---- | ----------------------- | -------------------- | ------ | ---------------------------------------------------------------- | ------------------------------- |
| POST | `/api/v1/auth/approve`  | 批准待处理的注册请求 | 已实现 | `api/resources/auth.ts:18` → Agent 自动批准（`hp-agent.ts:183`） | 无手动按钮，Agent 专用          |
| POST | `/api/v1/auth/register` | 用 authId 完成注册   | 未实现 | 无调用点                                                         | 缺“待批准列表”端点，UI 无数据源 |
| POST | `/api/v1/auth/reject`   | 拒绝待处理的注册请求 | 未实现 | 无调用点                                                         | 同上                            |

### 健康检查

| 方法 | 路径             | 能力说明                     | 状态   | 使用位置（文件与页面）                                                 | 备注               |
| ---- | ---------------- | ---------------------------- | ------ | ---------------------------------------------------------------------- | ------------------ |
| GET  | `/api/v1/health` | 鉴权健康检查，含数据库连通性 | 未实现 | 无调用点；本项目改用未鉴权的根路径 `GET /health`（`transport.ts:159`） | 见「健康检查」一节 |

### 调试

| 方法 | 路径                 | 能力说明       | 状态   | 使用位置（文件与页面） | 备注           |
| ---- | -------------------- | -------------- | ------ | ---------------------- | -------------- |
| POST | `/api/v1/debug/node` | 创建调试用节点 | 未实现 | 无调用点               | 建议保持不实现 |

规格共 **29 个端点**：已实现 **21**、部分 **1**、未实现 **7**。

## 节点

### GET /api/v1/node

- 参数：`user`（query，string，可选）按用户名过滤。
- 响应：`{ nodes: Node[] }`。`Node` 的关注字段：`id`（uint64 字符串）、`machineKey`、`nodeKey`、`discoKey`、
  `ipAddresses[]`、`name`、`user`（内嵌 `User`）、`lastSeen`、`expiry`、`preAuthKey`、`createdAt`、
  `registerMethod`（枚举 `REGISTER_METHOD_UNSPECIFIED` / `_AUTH_KEY` / `_CLI` / `_OIDC`）、`online`、
  `approvedRoutes[]`、`availableRoutes[]`、`subnetRoutes[]`、`tags[]`；`givenName` 在规格里已标注为弃用。
- 注意：0.28 起 `tags` 是扁平数组，之前是 `forcedTags`/`validTags`/`invalidTags` 三个字段，本项目按能力位
  自行合并（`api/resources/nodes.ts:41-47`）。
- 前置条件：无。
- curl：

  ```bash
  curl -sS -H "Authorization: Bearer $HEADSCALE_API_KEY" \
    "https://headscale.example.com/api/v1/node"
  ```

### GET /api/v1/node/{nodeId}

- 参数：`nodeId`（path，uint64 字符串，必填）。
- 响应：`{ node: Node }`，字段同上。
- 前置条件：`nodeId` 必须先由列表获得；本项目在 `/machines/:id` 直接取路由参数。
- curl：

  ```bash
  curl -sS -H "Authorization: Bearer $HEADSCALE_API_KEY" \
    "https://headscale.example.com/api/v1/node/$NODE_ID"
  ```

### DELETE /api/v1/node/{nodeId}

- 参数：`nodeId`（path，uint64 字符串，必填）。
- 响应：空对象 `{}`。
- 前置条件：不可逆操作；本项目在删除对话框里要求二次确认。
- curl：

  ```bash
  curl -sS -X DELETE -H "Authorization: Bearer $HEADSCALE_API_KEY" \
    "https://headscale.example.com/api/v1/node/$NODE_ID"
  ```

### POST /api/v1/node/register

- 参数：`user`（query，string，规格标为可选，实际必填）、`key`（query，string，规格标为可选，实际必填）。
- 响应：`{ node: Node }`。
- 前置条件与差异：本项目的客户端**同时**发送查询串和 JSON body（`api/resources/nodes.ts:69-87`），代码注释
  说明 Headscale 需要两者；但规格只为该端点声明了 query，**body 未被声明** —— 标记为待确认。0.29 起 `key`
  必须带 `hskey-authreq-` 前缀，更早的版本要剥掉（能力位 `registerKeyIncludesAuthReqPrefix`）。
- curl：

  ```bash
  curl -sS -X POST \
    -H "Authorization: Bearer $HEADSCALE_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"user":"$USER_NAME","key":"$REGISTRATION_KEY"}' \
    "https://headscale.example.com/api/v1/node/register?user=$USER_NAME&key=$REGISTRATION_KEY"
  ```

### POST /api/v1/node/{nodeId}/approve_routes

- 参数：`nodeId`（path，uint64，必填）；body `{ routes: string[] }`（`routes` 为 CIDR 字符串数组）。
- 响应：`{ node: Node }`。
- 前置条件：`routes` 是**全量覆盖**语义，不是增量。本项目把“已批准 + 新选中”合并后整体提交，
  所以要先拿到节点当前的 `approvedRoutes`（`machine-actions.ts` 中先 `api.nodes.get`）。
- curl：

  ```bash
  curl -sS -X POST \
    -H "Authorization: Bearer $HEADSCALE_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"routes":["10.0.0.0/24","192.168.1.0/24"]}' \
    "https://headscale.example.com/api/v1/node/$NODE_ID/approve_routes"
  ```

### POST /api/v1/node/{nodeId}/expire

规格为三种调用形态共用一个端点，参数均在 query：

| 形态     | 参数                           | 含义                   |
| -------- | ------------------------------ | ---------------------- |
| 立即过期 | 无                             | 把过期时间设为当前时刻 |
| 开关过期 | `disableExpiry=true` / `false` | `true` 表示永不过期    |
| 指定时间 | `expiry=<RFC3339>`             | 显式设置过期时间戳     |

- 参数：`expiry`（query，string/date-time，可选）、`disableExpiry`（query，boolean，可选）。
- 响应：`{ node: Node }`。
- 前置条件：`expiry` 在 Headplane 支持的全部版本（0.27.0+）都存在；`disableExpiry` 需要 **0.29.0+**
  （能力位 `keyExpiryCanBeDisabled`）。给老版本“踢下线”请用无参数形态。注意 `expiry` 是 query 参数而非 body，
  这是 proto 上没有 `body` 注解导致的。
- curl：

  ```bash
  # 立即过期
  curl -sS -X POST -H "Authorization: Bearer $HEADSCALE_API_KEY" \
    "https://headscale.example.com/api/v1/node/$NODE_ID/expire"

  # 永不过期（需要 Headscale 0.29.0+）
  curl -sS -X POST -H "Authorization: Bearer $HEADSCALE_API_KEY" \
    "https://headscale.example.com/api/v1/node/$NODE_ID/expire?disableExpiry=true"

  # 指定过期时间
  curl -sS -X POST -H "Authorization: Bearer $HEADSCALE_API_KEY" \
    "https://headscale.example.com/api/v1/node/$NODE_ID/expire?expiry=2030-01-01T00:00:00.000Z"
  ```

### POST /api/v1/node/{nodeId}/rename/{newName}

- 参数：`nodeId`（path，uint64，必填）、`newName`（path，string，必填）。
- 响应：`{ node: Node }`。
- 前置条件：同样需要先拿到 `nodeId`。`newName` 在客户端会被 `encodeURIComponent` 处理
  （`api/resources/nodes.ts:102`），手工 curl 时含空格或非 ASCII 的名字要自行转义。
- curl：

  ```bash
  curl -sS -X POST -H "Authorization: Bearer $HEADSCALE_API_KEY" \
    "https://headscale.example.com/api/v1/node/$NODE_ID/rename/$NEW_NAME"
  ```

### POST /api/v1/node/{nodeId}/tags

- 参数：`nodeId`（path，uint64，必填）；body `{ tags: string[] }`。
- 响应：`{ node: Node }`。
- 前置条件：同样是全量覆盖，空数组即清空标签。标签需要在策略中声明，因此本项目在标签对话框里把用户引导到
  `/acls`。
- curl：

  ```bash
  curl -sS -X POST \
    -H "Authorization: Bearer $HEADSCALE_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"tags":["tag:server"]}' \
    "https://headscale.example.com/api/v1/node/$NODE_ID/tags"
  ```

### POST /api/v1/node/backfillips

- 参数：`confirmed`（query，boolean，可选；规格**没有** description，语义待确认）。
- 响应：`{ changes: string[] }`；`changes` 里字符串的格式规格未说明——待确认。
- 状态：**未实现**，代码中无调用点。
- 典型用途：从很老的 Headscale 升级上来后，部分节点缺少 IP 地址，需要一次性回填。
- curl：

  ```bash
  curl -sS -X POST -H "Authorization: Bearer $HEADSCALE_API_KEY" \
    "https://headscale.example.com/api/v1/node/backfillips?confirmed=true"
  ```

## 用户

### GET /api/v1/user

- 参数：`id`（query，uint64 字符串，可选）、`name`（query，string，可选）、`email`（query，string，可选）。
- 响应：`{ users: User[] }`。`User` 字段：`id`、`name`、`createdAt`、`displayName`、`email`、`providerId`、
  `provider`、`profilePicUrl`。
- 前置条件：本项目在客户端强制**三者互斥**——同时传两个会直接抛错（`api/resources/users.ts:34-37`）。规格未
  说明这些过滤参数能否组合，标记为待确认。
- curl：

  ```bash
  curl -sS -H "Authorization: Bearer $HEADSCALE_API_KEY" \
    "https://headscale.example.com/api/v1/user?name=$USER_NAME"
  ```

### POST /api/v1/user

- 参数（body）：`name`（string）、`displayName`（string）、`email`（string）、`pictureUrl`（string），均为可选
  字段；实际必须提供 `name`。
- 响应：`{ user: User }`。
- 前置条件：无。
- curl：

  ```bash
  curl -sS -X POST \
    -H "Authorization: Bearer $HEADSCALE_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"name":"$USER_NAME","email":"$USER_EMAIL"}' \
    "https://headscale.example.com/api/v1/user"
  ```

### DELETE /api/v1/user/{id}

- 参数：`id`（path，uint64，必填）。
- 响应：空对象 `{}`。
- 前置条件：规格未说明该用户仍拥有节点时会发生什么（待确认）；本项目只做界面二次确认，不做预检。
- curl：

  ```bash
  curl -sS -X DELETE -H "Authorization: Bearer $HEADSCALE_API_KEY" \
    "https://headscale.example.com/api/v1/user/$USER_ID"
  ```

### POST /api/v1/user/{oldId}/rename/{newName}

- 参数：`oldId`（path，uint64，必填）、`newName`（path，string，必填）。
- 响应：`{ user: User }`。
- 前置条件：重命名后策略里的用户名/组名会失配，本项目在同一个动作里顺带改写策略
  （`app/routes/users/user-actions.ts:171-178`），需要写策略权限。
- curl：

  ```bash
  curl -sS -X POST -H "Authorization: Bearer $HEADSCALE_API_KEY" \
    "https://headscale.example.com/api/v1/user/$USER_ID/rename/$NEW_NAME"
  ```

## 策略

策略始终以**字符串**形式传输（HuJSON/JSON 文本），规格不校验其中的结构。本项目的解析、生成与改写都在
`app/routes/acls/acl-loader.ts`、`acl-action.ts` 里自己完成。

### GET /api/v1/policy

- 参数：无。
- 响应：`{ policy: string, updatedAt: string(date-time) }`。
- 前置条件：无。
- curl：

  ```bash
  curl -sS -H "Authorization: Bearer $HEADSCALE_API_KEY" \
    "https://headscale.example.com/api/v1/policy"
  ```

### PUT /api/v1/policy

- 参数（body）：`policy`（string，必填语义上是必填，规格未标 required）。
- 响应：`{ policy: string, updatedAt: string }`。
- 前置条件：写入即生效；本项目在保存前会先调用 `/policy/check`。
- curl：

  ```bash
  curl -sS -X PUT \
    -H "Authorization: Bearer $HEADSCALE_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"policy":"{\"acls\":[{\"action\":\"accept\",\"src\":[\"*\"],\"dst\":[\"*:*\"]}]}"}' \
    "https://headscale.example.com/api/v1/policy"
  ```

### POST /api/v1/policy/check

- 参数（body）：`policy`（string）。
- 响应：成功时是**空对象** `{}`（规格中 `v1CheckPolicyResponse` 无字段）；解析失败时返回 `rpcStatus` 错误。
- 前置条件：无。本项目把非 2xx 的上游响应统一包成 502（`api/transport.ts:110-129`），真实状态码在响应体里。
- curl：

  ```bash
  curl -sS -X POST \
    -H "Authorization: Bearer $HEADSCALE_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"policy":"{\"acls\":[]}"}' \
    "https://headscale.example.com/api/v1/policy/check"
  ```

## 预授权密钥

### GET /api/v1/preauthkey

- 参数：规格**未列出任何参数**。本项目在 0.28 以下的回退路径上仍会发送 `?user=<用户 id>`
  （`api/resources/pre-auth-keys.ts:39`），该参数能否被接受无法从本规格确认 —— **待确认**。0.28+ 走无参数的
  全量列表（`preAuthKeysHaveStableIds` 能力位）。
- 响应：`{ preAuthKeys: PreAuthKey[] }`。字段：`user`（内嵌 `User`，tag-only 密钥为 null）、`id`、`key`、
  `reusable`、`ephemeral`、`used`、`expiration`、`createdAt`、`aclTags[]`。
- 前置条件：无。
- curl：

  ```bash
  curl -sS -H "Authorization: Bearer $HEADSCALE_API_KEY" \
    "https://headscale.example.com/api/v1/preauthkey"
  ```

### POST /api/v1/preauthkey

- 参数（body）：`user`（uint64 字符串，可选——省略即为无属主的 tag-only 密钥，0.28+）、`reusable`（boolean）、
  `ephemeral`（boolean）、`expiration`（date-time，可为 null）、`aclTags`（string[]）。
- 响应：`{ preAuthKey: PreAuthKey }`，其中 `key` 是明文密钥。
- 前置条件：使用密钥的机器会继承 `aclTags`；Agent 就依赖这一点给自己打 `tag:headplane-agent`
  （`app/server/hp-agent.ts:127-137`）。
- curl：

  ```bash
  curl -sS -X POST \
    -H "Authorization: Bearer $HEADSCALE_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"user":"$USER_ID","reusable":false,"ephemeral":false,"expiration":"2030-01-01T00:00:00Z","aclTags":["tag:server"]}' \
    "https://headscale.example.com/api/v1/preauthkey"
  ```

### POST /api/v1/preauthkey/expire

- 参数（body）：规格只声明 `id`（uint64 字符串）。
- 差异说明：0.28 以下的老版本要求 `{ user, key }`，且 `user` 必须是 **uint64 用户 id**，传用户名会报
  `proto: invalid value for uint64 field user`（代码注释，`api/resources/pre-auth-keys.ts:68-70`）。该旧报文**不在
  本规格内**，本项目按能力位自动切换。
- 响应：空对象 `{}`。
- 前置条件：需要密钥的 `id`（0.28+）或 `user` + `key` 原文（更早版本）——所以旧版本上必须先从列表里拿到明文
  密钥，这正是本项目为旧版本保留 `listForUser` 的原因。
- curl：

  ```bash
  # Headscale 0.28+
  curl -sS -X POST \
    -H "Authorization: Bearer $HEADSCALE_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"id":"$PREAUTH_KEY_ID"}' \
    "https://headscale.example.com/api/v1/preauthkey/expire"
  ```

### DELETE /api/v1/preauthkey

- 参数：`id`（query，uint64 字符串，可选）。
- 响应：空对象 `{}`。
- 状态：**未实现**。界面上的“吊销”走的是 `POST /preauthkey/expire`，密钥立即失效但不删除记录。
- curl：

  ```bash
  curl -sS -X DELETE -H "Authorization: Bearer $HEADSCALE_API_KEY" \
    "https://headscale.example.com/api/v1/preauthkey?id=$PREAUTH_KEY_ID"
  ```

## API 密钥

### GET /api/v1/apikey

- 参数：无。
- 响应：`{ apiKeys: ApiKey[] }`。字段：`id`、`prefix`、`expiration`、`createdAt`、`lastSeen`。
- 前置条件：无。本项目的调用点最多：设置 → API 密钥（`settings/api-keys/overview.tsx:48`）、设置 → 系统诊断
  （`settings/system/overview.tsx:182`）、登录时校验用户输入的密钥（`auth/login/action.ts:62`）、`/overview`
  统计、布局保活（`layout/app.tsx:67`）、告警服务（`alerts/service.server.ts:214`）。
- curl：

  ```bash
  curl -sS -H "Authorization: Bearer $HEADSCALE_API_KEY" \
    "https://headscale.example.com/api/v1/apikey"
  ```

### POST /api/v1/apikey

- 参数（body）：`expiration`（date-time）。
- 响应：`{ apiKey: string }` —— 明文**只返回这一次**，之后无法再读回。
- 前置条件：必须已经有一把有效密钥（鸡生蛋问题），首次请用 CLI。
- curl：

  ```bash
  curl -sS -X POST \
    -H "Authorization: Bearer $HEADSCALE_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"expiration":"2030-01-01T00:00:00Z"}' \
    "https://headscale.example.com/api/v1/apikey"
  ```

### POST /api/v1/apikey/expire

- 参数（body）：`prefix`（string）、`id`（uint64 字符串）。
- 响应：空对象 `{}`。
- 前置条件：`prefix` 必须是 Headscale 存储的**原始前缀**（0.28+ 为 12 字符）；列表接口返回的是掩码形式，
  不能直接回传（代码注释，`api/resources/api-keys.ts:15-19`）。规格未说明 `prefix` 是否为掩码 —— 以代码为准，
  规格侧标记为待确认。
- curl：

  ```bash
  curl -sS -X POST \
    -H "Authorization: Bearer $HEADSCALE_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"prefix":"$API_KEY_PREFIX"}' \
    "https://headscale.example.com/api/v1/apikey/expire"
  ```

### DELETE /api/v1/apikey/{prefix}

- 参数：`prefix`（path，string，必填）、`id`（query，uint64 字符串，可选）。两个标识同时存在时以哪个为准，规格
  未说明 —— 待确认。
- 响应：空对象 `{}`。
- 状态：**未实现**。
- curl：

  ```bash
  curl -sS -X DELETE -H "Authorization: Bearer $HEADSCALE_API_KEY" \
    "https://headscale.example.com/api/v1/apikey/$API_KEY_PREFIX"
  ```

## 认证与注册

这一组端点的共同前提值得先讲清楚：**本规格没有“列出待批准注册请求”的端点**。因此 `authId` 只能从 Headscale
的日志/CLI，或从 tsnet 打印的授权 URL 里拿。本项目的 Agent 正是用正则从未遂登录的 stderr 里抓出 authId
（`app/server/hp-agent.ts:172-179`）。没有列表端点，就意味着任何基于 authId 的 UI 都缺少数据源。

### POST /api/v1/auth/approve

- 参数（body）：`authId`（string）。
- 响应：空对象 `{}`。
- 前置条件：需要有效的 `authId`。本项目只在 Agent 自动批准时调用，没有手动入口；页面位置是
  **设置 → Agent**（状态由 `hp-agent.ts` 驱动）。
- curl：

  ```bash
  curl -sS -X POST \
    -H "Authorization: Bearer $HEADSCALE_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"authId":"$AUTH_ID"}' \
    "https://headscale.example.com/api/v1/auth/approve"
  ```

### POST /api/v1/auth/register

- 参数（body）：`user`（string）、`authId`（string）。
- 响应：`{ node: Node }`。
- 状态：**未实现**；缺少待批准列表，UI 无从选择目标注册。
- curl：

  ```bash
  curl -sS -X POST \
    -H "Authorization: Bearer $HEADSCALE_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"user":"$USER_NAME","authId":"$AUTH_ID"}' \
    "https://headscale.example.com/api/v1/auth/register"
  ```

### POST /api/v1/auth/reject

- 参数（body）：`authId`（string）。
- 响应：空对象 `{}`。
- 状态：**未实现**；原因同上。
- curl：

  ```bash
  curl -sS -X POST \
    -H "Authorization: Bearer $HEADSCALE_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"authId":"$AUTH_ID"}' \
    "https://headscale.example.com/api/v1/auth/reject"
  ```

## 健康检查

### GET /api/v1/health

- 参数：无。
- 响应：`{ databaseConnectivity: boolean }`。
- 状态：**未实现** —— 但这个“未实现”只针对规格里的这个鉴权端点。本项目改用**根路径** `GET /health`
  （未鉴权，**不在本规格内**，`api/transport.ts:159-171`，只要返回 200 就算健康，不解析 body）。调用点包括：
  `/healthz`（`routes/util/healthz.ts`）、`/api/info`（`routes/util/info.ts:42`）、应用布局保活
  （`layout/app.tsx:64`）、设置 → 系统（`settings/system/overview.tsx:174`）、告警服务
  （`alerts/service.server.ts:155`）、节点历史采集（`history/service.server.ts:108`）、Docker 集成
  （`config/integration/docker.ts:289`）与进程助手（`config/integration/proc-helper.ts:99`）。
- curl：

  ```bash
  curl -sS -H "Authorization: Bearer $HEADSCALE_API_KEY" \
    "https://headscale.example.com/api/v1/health"
  ```

## 调试

### POST /api/v1/debug/node

- 参数（body）：`user`（string）、`key`（string）、`name`（string）、`routes`（string[]）。
- 响应：`{ node: Node }`。
- 状态：**未实现**，且建议保持不实现：它会凭空创建一个节点，绕过正常的注册与标签约束，不适合出现在管理界面。
- curl：

  ```bash
  curl -sS -X POST \
    -H "Authorization: Bearer $HEADSCALE_API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"user":"$USER_NAME","key":"$MACHINE_KEY","name":"$NODE_NAME","routes":["10.0.0.0/24"]}' \
    "https://headscale.example.com/api/v1/debug/node"
  ```

## 未实现与部分实现清单

优先级：**P1** 值得尽快做，**P2** 有价值但可等，**P3** 可选或建议不做。所有结论均已逐个回查代码调用点，而非
按印象推断。

| 端点                              | 现状   | 建议                                                                                                      | 优先级 |
| --------------------------------- | ------ | --------------------------------------------------------------------------------------------------------- | ------ |
| `GET /api/v1/node`（`user` 过滤） | 部分   | 大 tailnet 可考虑服务端过滤；目前界面在客户端过滤，功能无缺失                                             | P3     |
| `POST /api/v1/node/backfillips`   | 未实现 | 建议在 设置 → 系统 增加一个带确认的一次性修复入口（老库升级后节点缺 IP）；动手前先确认 `confirmed` 的语义 | P2     |
| `DELETE /api/v1/apikey/{prefix}`  | 未实现 | 同上，expire 已让密钥立即失效；若实现，注意规格同时提供可选 `id` 查询参数                                 | P3     |
| `POST /api/v1/auth/register`      | 未实现 | 规格缺“待批准列表”端点，UI 没有数据源；建议先不实现，除非改成由操作者粘贴 authId                          | P3     |
| `POST /api/v1/auth/reject`        | 未实现 | 原因同上；且拒绝后界面无法复核结果                                                                        | P3     |
| `POST /api/v1/debug/node`         | 未实现 | 建议保持不实现                                                                                            | P3     |
| `GET /api/v1/health`              | 未实现 | 已由根路径 `/health` 承担。仅当需要区分“数据库是否连通”时再补，可并入 设置 → 系统 诊断                    | P3     |

**补充发现（不在上述四项目标端点里）**

- `POST /api/v1/node/{id}/user`：本项目在 `capabilities.nodeOwnerIsImmutable` 为 false（Headscale < 0.28）时
  仍会调用它来做“移动机器到其他用户”（`api/resources/nodes.ts:134-143`，界面为 `/machines` 的移动对话框与批量
  移动）。该端点在**本规格中已不存在**，0.28+ 调用它会 404 —— 因此它被能力位严格门控。这是规格与代码的已知
  偏离，属于有意保留的向后兼容，不建议改动。
- `GET /version` 与 `GET /health`（根路径）：本规格未包含，但本项目依赖（能力探测与健康检查分别见
  `api/index.ts:94`、`api/transport.ts:159`）。

## 如何验证

1. **打开在线 Swagger。** 访问 `https://headscale.example.com/swagger`，展开 `HeadscaleService` 组即可看到全部
   29 个端点。UI 不可用时直接读规格：

   ```bash
   curl -sS https://headscale.example.com/swagger/v1/openapiv2.json | jq '.paths | keys'
   ```

2. **用 curl 打一个端点。** 唯一必需的是 `Authorization` 头；先拿一个只读端点验证密钥：

   ```bash
   export HEADSCALE_URL="https://headscale.example.com"
   export HEADSCALE_API_KEY="$HEADSCALE_API_KEY"
   curl -sS -o /dev/null -w '%{http_code}\n' \
     -H "Authorization: Bearer $HEADSCALE_API_KEY" "$HEADSCALE_URL/api/v1/node"
   ```

3. **常见失败模式。**

   | 现象               | 含义                                                                                                                                                        | 处理                                                               |
   | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
   | `401 Unauthorized` | 密钥错误、被截断、已过期或被撤销。本项目登录页与 设置 → 系统 会判定为 API key invalid                                                                       | 用 `headscale apikeys create` 重新签发，并同步 `headscale.api_key` |
   | `403 Forbidden`    | Headscale 的 API 密钥是管理级的，很少自己返回 403。更常见的是反向代理（Caddy/Nginx）拦下了请求，或 Headplane 自身的权限位拒绝                               | 先绕过代理直连验证；再检查 Headplane 的能力位与用户角色            |
   | `404 Not Found`    | 该端点在当前 Headscale 版本上不存在（版本门控）。例如 `POST /api/v1/node/{id}/user` 在 0.28+ 已被移除，`/api/v1/node/backfillips` 只在较新版本上出现        | 用 `/version` 确认版本；本项目据此推导能力位，而不是靠 403 试探    |
   | `502 Bad Gateway`  | 这是 Headplane 自己的包装：上游的非 2xx 一律被包成 502，真实状态码在 JSON 的 `statusCode`，上游文本经净化后用 `detail` 携带一行摘要（原始响应体留在服务端） | 读响应体里的 `statusCode` 还原真实错误，不要按 502 排查            |

4. **复核“已实现”结论。** 先看 `app/server/headscale/api/resources/*.ts` 里的 `path:` 字面量确定客户端覆盖，
   再到 `app/routes/**` 搜对应的 API 方法名，确认存在界面调用点。只有客户端封装、没有调用点的端点不算“已实现”。

### 本文标记为「待确认」的事项

- 规格是否包含仅 gRPC 可用的能力：无法从规格判断。
- `GET /api/v1/preauthkey` 是否接受 `user` 查询参数：规格未列出，代码在 0.28 以下会发送。
- `POST /api/v1/node/register` 是否接受 JSON body：规格只声明 query，代码两者都发。
- `POST /api/v1/node/backfillips` 的 `confirmed` 含义与响应 `changes` 字符串格式：规格无描述。
- `DELETE /api/v1/apikey/{prefix}` 的 `prefix` 与可选 `id` 同时存在时的优先级：规格未说明。
- `GET /api/v1/apikey` 返回的 `prefix` 是否为掩码：规格未说明，本文以代码注释为准。
- `GET /api/v1/user` 的 `id`/`name`/`email` 能否组合：规格未说明，本项目客户端强制互斥。
- `DELETE /api/v1/user/{id}` 在该用户仍拥有节点时的行为：规格未说明。

## 附录：规格之外的端点

本规格没有声明、但本项目确实会调用的端点：`GET /version`（未鉴权，用于推导能力位，最低支持 Headscale
0.27.0）、`GET /health`（未鉴权，用于健康检查）、`POST /api/v1/node/{id}/user`（旧版本向后兼容）。它们都不在
Swagger 里，因此无法用 `https://headscale.example.com/swagger` 验证，只能对照代码与 Headscale 发行说明。
