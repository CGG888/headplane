# NixOS 模块选项

> 本页由 `nix/options.nix` 生成；`mise run build-nixos-docs` 只会写入 `docs/en/NixOS-options.md`，本中文页是对该生成结果的翻译镜像，不会自动重新生成。

所有选项都必须位于 `services.headplane` 之下。

例如：`settings.headscale.config_path` 会变成 `services.headplane.settings.headscale.config_path`。

## debug

_Description:_ 启用调试日志

_Type:_ boolean

_Default:_ `false`

## enable

_Description:_ 是否启用 headplane。

_Type:_ boolean

_Default:_ `false`

_Example:_ `true`

## package

_Description:_ 要使用的 headplane 软件包。

_Type:_ package

_Default:_ `pkgs.headplane`

## settings

_Description:_ HeadplaneCN 配置选项。会生成一个 YAML 配置文件。
参见：https://github.com/CGG888/headplaneCN/blob/main/config.example.yaml

_Type:_ submodule

_Default:_ `{ }`

## settings.headscale

_Description:_ 用于 HeadplaneCN 集成的 Headscale 专属设置。

_Type:_ submodule

_Default:_ `{ }`

## settings.headscale.api_key_path

_Description:_ 包含 Headscale API 密钥的文件的路径。
OIDC 认证和 HeadplaneCN Agent 都需要它。

_Type:_ null or absolute path

_Default:_ `null`

_Example:_ `"config.sops.secrets.headscale_api_key.path"`

## settings.headscale.config_path

_Description:_ Headscale 配置文件的路径。
这一项是可选的，但**强烈**建议设置，以获得最好的体验。
如果该文件是只读的，HeadplaneCN 会在 Web 界面中显示你的配置项，但无法修改它们。

_Type:_ null or absolute path

_Default:_ `null`

_Example:_ `"/etc/headscale/config.yaml"`

## settings.headscale.config_strict

_Description:_ 已弃用。HeadplaneCN 不再校验完整的 Headscale 配置，该选项没有任何效果。

_Type:_ boolean

_Default:_ `true`

## settings.headscale.dns_records_path

_Description:_ 如果你在 Headscale 配置中使用了 `dns.extra_records_path`，HeadplaneCN 会自动读取该路径。只有在 HeadplaneCN 需要以不同路径访问同一个文件时才设置此项。
请确保该文件对 HeadplaneCN 进程可读且可写。
使用它之后，HeadplaneCN 就不再需要为了修改 DNS 记录而自动重启 Headscale。

_Type:_ null or absolute path

_Default:_ `null`

_Example:_ `"/var/lib/headplane/extra_records.json"`

## settings.headscale.public_url

_Description:_ 公开 URL（如果不同的话）。它会影响 Web 界面的某些部分。

_Type:_ null or string

_Default:_ `null`

_Example:_ `"https://headscale.example.com"`

## settings.headscale.tls_cert_path

_Description:_ 包含 TLS 证书的文件的路径。

_Type:_ null or absolute path

_Default:_ `null`

_Example:_ `"config.sops.secrets.tls_cert.path"`

## settings.headscale.url

_Description:_ 你的 Headscale 实例的 URL。
所有 API 请求都通过该 URL 转发。
这**不是** gRPC 端点，而是 HTTP 端点。
重要：如果你使用 TLS，这里**必须**设为 `https://`。

_Type:_ string

_Default:_ `"http://127.0.0.1:8080"`

_Example:_ `"https://headscale.example.com"`

## settings.integration

_Description:_ HeadplaneCN 与 Headscale 交互的集成配置。

_Type:_ submodule

_Default:_ `{ }`

## settings.integration.agent

_Description:_ HeadplaneCN Agent 的 Agent 配置。

_Type:_ submodule

_Default:_ `{ }`

## settings.integration.agent.cache_ttl

_Description:_ Agent 信息的缓存时长（毫秒）。
如果你希望数据更新更快，可以调小该 TTL，但这会增加向 Headscale 发起请求的频率。

_Type:_ signed integer

_Default:_ `180000`

## settings.integration.agent.enabled

_Description:_ HeadplaneCN Agent 会定期从你的 Tailnet 同步节点信息（版本、操作系统等）。
它使用 headscale.api_key 自动生成临时预授权密钥，因此无需手动配置密钥。
需要 Headscale 0.28 或更新版本。

_Type:_ boolean

_Default:_ `false`

## settings.integration.agent.executable_path

_Description:_ HeadplaneCN Agent 可执行文件的路径。
如果使用 NixOS 模块提供的软件包，默认值就是正确的。

_Type:_ absolute path

_Default:_ `"/usr/libexec/headplane/agent"`

## settings.integration.agent.host_name

_Description:_ 可选，用于修改 Agent 在 Tailnet 中的名称

_Type:_ string

_Default:_ `"headplane-agent"`

## settings.integration.agent.package

_Description:_ 要使用的 headplane-agent 软件包。

_Type:_ package

_Default:_ `pkgs.headplane-agent`

## settings.integration.agent.tailscale_netns

_Description:_ 在专用的 HeadplaneCN Agent 进程中使用 Tailscale 的套接字级路由环路处理。
除非它的回退逻辑把 Agent 与 Headscale 的连接固定到了错误的网卡上，否则请保持启用。
只有在确认容器网络命名空间中的普通操作系统路由能正确到达 Headscale 之后，才应设为 false。

_Type:_ boolean

_Default:_ `true`

## settings.integration.agent.work_dir

_Description:_ 除非你在运行自定义部署，否则不要修改这一项。
work_dir 表示 Agent 存放数据的位置，以便能够自动重新通过 Tailnet 认证。
它必须对运行 HeadplaneCN 进程的用户可写。

_Type:_ absolute path

_Default:_ `"/var/lib/headplane/agent"`

## settings.integration.proc

_Description:_ 原生进程集成设置。

_Type:_ submodule

_Default:_ `{ }`

## settings.integration.proc.enabled

_Description:_ 启用 “Native” 集成，适用于 Headscale 和
HeadplaneCN 都运行在容器之外的情况。它不需要额外配置，
但你需要确保 HeadplaneCN 进程能够终止 Headscale 进程。

_Type:_ boolean

_Default:_ `true`

## settings.integration.proc.allow_restart

_Description:_ 允许 HeadplaneCN 在配置改动后从设置页重启 Headscale。只有在
systemd、s6 之类的监管程序会把 Headscale 重新拉起时才有效 —— HeadplaneCN
只发送 SIGTERM，然后等待新的 `headscale serve` 进程出现。

_Type:_ boolean

_Default:_ `false`

## settings.oidc

_Description:_ 用于认证的 OIDC 配置。

_Type:_ submodule

_Default:_ `{ }`

## settings.oidc.client_id

_Description:_ OIDC 客户端的客户端 ID。

_Type:_ string

_Default:_ `""`

_Example:_ `"your-client-id"`

## settings.oidc.client_secret_path

_Description:_ 包含 OIDC 客户端密钥的文件的路径。

_Type:_ null or absolute path

_Default:_ `null`

_Example:_ `"config.sops.secrets.oidc_client_secret.path"`

## settings.oidc.disable_api_key_login

_Description:_ 是否禁用 API 密钥登录。

_Type:_ boolean

_Default:_ `false`

## settings.oidc.default_role

_Description:_ 首个所有者完成引导后，为新创建的 OIDC 用户分配的角色。
所有者角色保留给首次登录的引导流程。

_Type:_ one of "admin", "network_admin", "it_admin", "auditor", "viewer", "member"

_Default:_ `"member"`

## settings.oidc.headscale_api_key_path

_Description:_ 已弃用：请改用 `headscale.api_key_path`。
包含 Headscale API 密钥的文件的路径。

_Type:_ null or absolute path

_Default:_ `null`

_Example:_ `"config.sops.secrets.headscale_api_key.path"`

## settings.oidc.issuer

_Description:_ OpenID 签发方的 URL。

_Type:_ string

_Default:_ `""`

_Example:_ `"https://provider.example.com/issuer-url"`

## settings.oidc.redirect_uri

_Description:_ 这里应填写你的 HeadplaneCN 实例可公开访问的 URL，
并带上 /admin/oidc/callback。

_Type:_ string

_Default:_ `""`

_Example:_ `"https://headscale.example.com/admin/oidc/callback"`

## settings.oidc.role_claim

_Description:_ 可选的 OIDC 声明，包含要分配给新创建用户的 HeadplaneCN 角色。
有效的角色声明优先于 default_role。

_Type:_ null or string

_Default:_ `null`

_Example:_ `"headplane_role"`

## settings.oidc.token_endpoint_auth_method

_Description:_ token 端点的认证方法。

_Type:_ one of "client_secret_post", "client_secret_basic", "client_secret_jwt"

_Default:_ `"client_secret_post"`

## settings.server

_Description:_ HeadplaneCN Web 应用的服务器配置。

_Type:_ submodule

_Default:_ `{ }`

## settings.server.cookie_secret_path

_Description:_ 包含 Cookie 密钥的文件的路径。
该密钥必须正好是 32 个字符。

_Type:_ null or absolute path

_Default:_ `null`

_Example:_ `"config.sops.secrets.headplane_cookie.path"`

## settings.server.cookie_secure

_Description:_ Cookie 是否只能在 HTTPS 下工作？
如果在没有代理的情况下通过 HTTP 运行，请设为 false。
生产环境中建议设为 true。

_Type:_ boolean

_Default:_ `true`

## settings.server.data_path

_Description:_ 持久化 HeadplaneCN 专属数据的路径。
今后所有数据都存放在该目录中，包括内部数据库和任何缓存相关文件。
0.6.1 之前的数据格式会自动迁移。

_Type:_ absolute path

_Default:_ `"/var/lib/headplane"`

_Example:_ `"/var/lib/headplane"`

## settings.server.host

_Description:_ 要绑定的主机地址。

_Type:_ string

_Default:_ `"127.0.0.1"`

_Example:_ `"0.0.0.0"`

## settings.server.port

_Description:_ 要监听的端口。

_Type:_ 16 bit unsigned integer; between 0 and 65535 (both inclusive)

_Default:_ `3000`

## settings.server.proxy_auth

_Description:_ 代理认证配置。

_Type:_ submodule

_Default:_ `{ }`

## settings.server.proxy_auth.allowed_cidrs

_Description:_ 允许绕过 HeadplaneCN 登录流程的直接客户端 CIDR 范围。
这里应填写你的可信反向代理连接 HeadplaneCN 时使用的地址。
需要 headscale.api_key_path。

_Type:_ list of string

_Default:_ `[ "127.0.0.1/32" "::1/128" ]`

_Example:_ `[ "10.0.0.0/24" ]`

## settings.server.proxy_auth.email_header

_Description:_ 可选。包含已认证用户邮箱地址的请求头。

_Type:_ null or string

_Default:_ `null`

## settings.server.proxy_auth.enabled

_Description:_ 是否对允许的客户端 CIDR 信任反向代理认证。

_Type:_ boolean

_Default:_ `false`

## settings.server.proxy_auth.ip_header

_Description:_ 可选。包含原始客户端 IP 的请求头，例如 X-Forwarded-For 或 X-Real-IP。

_Type:_ null or string

_Default:_ `null`

## settings.server.proxy_auth.name_header

_Description:_ 可选。包含已认证用户显示名称的请求头。

_Type:_ null or string

_Default:_ `null`

## settings.server.proxy_auth.picture_header

_Description:_ 可选。包含已认证用户头像 URL 的请求头。

_Type:_ null or string

_Default:_ `null`

## settings.server.proxy_auth.user_header

_Description:_ 包含稳定的已认证代理用户身份的请求头。

_Type:_ string

_Default:_ `"Remote-User"`

## settings.server.proxy_auth.trusted_proxy_cidrs

_Description:_ 可信的、可以提供 ip_header 的直接代理 CIDR 范围。
仅在设置了 ip_header 时使用。

_Type:_ list of string

_Default:_ `[ "127.0.0.1/32" "::1/128" ]`

_Example:_ `[ "127.0.0.1/32" ]`
