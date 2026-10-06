---
title: 架构
description: HeadplaneCN 服务端代码使用的服务架构模式。
outline: [2, 3]
---

# 架构

HeadplaneCN 的服务端代码在单个 Node.js 进程中，由彼此独立的服务模块组成。每个服务自行管理状态
和生命周期，不依赖共享的“上帝对象”，也不使用依赖注入框架。

本页记录所有服务端服务都必须遵循的模式。

## 核心模式：闭包工厂

每个服务都是一个**工厂函数**：依赖以参数传入，私有状态被闭包捕获，返回一个由函数组成的普通
对象。没有类，没有装饰器，没有模块级全局变量。

```ts
// ✅ Correct: closure factory
export function createOidcService(config: OidcConfig): OidcService {
  // Private state — owned by this instance, invisible outside
  let endpoints: ResolvedEndpoints | undefined;
  let cachedAuthMethod: string | undefined;

  function status() {
    if (endpoints) return { state: "ready", endpoints };
    return { state: "pending" };
  }

  async function startFlow() {
    // Uses `config` and `endpoints` from closure
  }

  function invalidate() {
    endpoints = undefined;
    cachedAuthMethod = undefined;
  }

  return { status, startFlow, invalidate };
}
```

```ts
// ❌ Wrong: module-level global state
let endpoints: ResolvedEndpoints | undefined;

export function init(config: OidcConfig) {
  // Mutates module globals — untestable, import-order fragile
}

export function startFlow() {
  // Reads from module globals — can't have two instances
}
```

```ts
// ❌ Wrong: class with `this`
export class OidcService {
  private endpoints?: ResolvedEndpoints;
  // Adds ceremony without adding value over closures
}
```

### 为什么用闭包？

- **可测试**：每个测试都可以用不同的配置创建一个全新实例。不需要 `vi.resetModules()`，不需要
  处理导入顺序的取巧写法，也没有单例需要清理。
- **可组合**：服务可以把其他服务当作工厂参数接收，从而依赖它们。不需要容器注册，也不需要
  字符串键。
- **可热重载**：调用 `service.reload(newConfig)` 或直接创建新实例即可，旧状态会被垃圾回收。
- **显式**：每个依赖都出现在工厂函数签名里，没有隐藏的环境状态。

## 服务接口

每个服务都应该为自己的公开 API 定义 TypeScript 接口。使用方（路由、其他服务、测试）依赖的
是这个接口，而不是内部实现。

```ts
export interface OidcService {
  status(): OidcStatus;
  startFlow(): Promise<Result<FlowData, OidcError>>;
  handleCallback(params: URLSearchParams, state: FlowState): Promise<Result<Identity, OidcError>>;
  invalidate(): void;
  reload(config: OidcConfig): void;
}
```

### 生命周期钩子

需要运行后台工作（定时器、轮询、监听循环）的服务应该暴露生命周期钩子。这样后台行为就留在拥有
它的服务内部：

```ts
export interface AuthService {
  require(request: Request): Promise<Principal>;
  can(principal: Principal, cap: Capabilities): boolean;
  // Lifecycle
  start(): void; // Begin session pruning interval
  stop(): void; // Clear interval, clean up
}

export function createAuthService(opts: AuthServiceOptions): AuthService {
  let pruneTimer: NodeJS.Timeout | undefined;

  return {
    require(request) {
      /* ... */
    },
    can(principal, cap) {
      /* ... */
    },
    start() {
      pruneTimer = setInterval(() => void pruneExpiredSessions(), 15 * 60 * 1000);
    },
    stop() {
      if (pruneTimer) clearInterval(pruneTimer);
    },
  };
}
```

## Result 类型

可能失败的服务使用共享的 `Result<T, E>` 类型，而不是抛出异常。这让每个调用点的错误处理都变
得显式。

```ts
import { type Result, ok, err } from "~/server/result";

// Returning success
return ok({ url, flowState });

// Returning failure
return err({ code: "discovery_failed", message: "..." });
```

路由和其他调用方使用这个可辨识联合：

```ts
const result = await runtime.oidc.startFlow();
if (!result.ok) {
  // result.error is typed — render the right UI
  return redirect(`/login?s=${result.error.code}`);
}
// result.value is typed
return redirect(result.value.url);
```

`Result` 位于 `app/server/result.ts`，刻意保持最小：

```ts
type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };
```

## 组合根

所有服务都在同一个地方装配：`server/index.ts`。它就是**组合根** —— 唯一知道全部服务以及它们
如何连接的文件。

```ts
export interface AppRuntime {
  config: HeadplaneConfig;
  db: DbClient;
  auth: AuthService;
  oidc?: OidcService;
  headscale: Headscale;
  agents?: AgentManager;
  stop(): Promise<void>;
}

export async function createAppRuntime(): Promise<AppRuntime> {
  const config = await loadConfig();
  const db = await createDbClient(/* ... */);
  const auth = createAuthService({ db /* ... */ });
  const oidc = config.oidc
    ? createOidcService({
        /* ... */
      })
    : undefined;

  return {
    config,
    db,
    auth,
    oidc,
    async stop() {
      auth.stop?.();
    },
  };
}
```

React Router 的 `AppLoadContext` 包装了这个运行时：

```ts
const runtime = await createAppRuntime();

getLoadContext() {
  return { runtime };
}
```

路由通过 `context.runtime` 访问服务：

```ts
export async function loader({ context }: Route.LoaderArgs) {
  const principal = await context.runtime.auth.require(request);
  // ...
}
```

### 依赖方向

服务可以依赖其他服务，但只能通过显式的工厂参数 —— 绝不能导入另一个服务的模块并读取它的状态：

```ts
// ✅ Correct: explicit dependency
export function createAuthService(opts: {
  db: DbClient;
  // ...
}): AuthService {}

// ❌ Wrong: hidden coupling
import { getDb } from "~/server/db";
export function createAuthService(): AuthService {
  const db = getDb(); // Where does this come from? Is it initialized?
}
```

## 错误处理

### 配置期错误与流程期错误

服务会区分搭建阶段发生的错误（配置期）和用户操作期间发生的错误（流程期）。这一区分决定了错误
在哪里、以什么方式呈现在界面上：

| 类型     | 发生时机             | 界面呈现方式         | 示例                                      |
| -------- | -------------------- | -------------------- | ----------------------------------------- |
| 配置期   | 用户操作之前         | 登录页横幅           | `discovery_failed`、`invalid_api_key`     |
| 流程期   | 用户开始流程之后     | 带错误码的重定向     | `token_exchange_failed`、`state_mismatch` |
| 非致命   | 流程进行期间         | 仅记录日志           | `userinfo_failed`                         |

### 错误码

每个服务错误都应该有一个唯一的 `code` 字符串，它对应：

1. 一条带可操作细节的日志（给运维者）
2. 一个界面组件（给用户）
3. 一个文档章节（用于故障排查）

```ts
export interface OidcError {
  code: OidcErrorCode; // Machine-readable, used in URLs and UI switches
  message: string; // Human-readable, for server logs only
  hint?: string; // Troubleshooting suggestion for logs
}
```

## 测试

### 单元测试

每个测试都用自己需要的配置创建一个全新的服务实例，不需要 mock 框架：

```ts
import { createOidcService } from "~/server/oidc/provider";

test("status is pending before first discovery", () => {
  const oidc = createOidcService(testConfig);
  expect(oidc.status().state).toBe("pending");
});

test("invalidate clears cached endpoints", async () => {
  const oidc = createOidcService(testConfig);
  await oidc.discover();
  oidc.invalidate();
  expect(oidc.status().state).toBe("pending");
});
```

### 伪造服务

在路由测试中，只搭建你需要的那些服务，组成一个部分运行时：

```ts
function createTestRuntime(overrides: Partial<AppRuntime> = {}): AppRuntime {
  return {
    config: testConfig,
    db: createTestDb(),
    auth: createTestAuth(),
    headscale: createTestHeadscale(),
    stop: async () => {},
    ...overrides,
  };
}

test("login page shows SSO button when OIDC is ready", () => {
  const runtime = createTestRuntime({
    oidc: createOidcService(testOidcConfig),
  });
  // Test the route loader with this runtime
});
```

### 集成测试

通过 `testcontainers` 在容器中使用真实的 OIDC 提供方（Dex、Keycloak），无需浏览器自动化即可
测试完整流程：

```ts
// Configure Dex with static client + static passwords
// Hit the token endpoint directly
// Validate the entire server-side flow end-to-end
```

## 新增一个服务

1. **定义接口**，放在 `app/server/<name>/` 下的新文件中。
2. **编写工厂函数**，接收显式依赖并返回该接口。状态保存在闭包变量里。
3. **添加生命周期钩子**（`start`/`stop`/`reload`/`invalidate`），前提是该服务有后台工作或缓存
   状态。
4. 对可能失败的操作**使用 `Result<T, E>`**。定义带 `code` 字段的类型化错误。
5. 在 `server/index.ts` 的 `createAppRuntime()` 中**把它接进去**。
6. **编写测试**，创建相互隔离的实例 —— 不需要 mock 模块。
