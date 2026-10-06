import { defineConfig } from "vitepress";

// GitHub Pages project site: https://cgg888.github.io/headplaneCN/
const base = "/headplaneCN/";

// Simplified Chinese is the default locale and is served from the site root,
// so every path below is a root path and never points into `/en/`. The entries
// mirror `enNav`/`enSidebar` one-for-one: same groups, same pages, same order.
const zhHansNav = [
  { text: "首页", link: "/" },
  { text: "赞助", link: "/sponsor" },
  { text: "更新日志", link: "/CHANGELOG" },
  { text: "版本记录", link: "/versions" },
];

const zhHansSidebar = [
  {
    text: "开始使用",
    items: [
      { text: "什么是 HeadplaneCN？", link: "/introduction" },
      {
        text: "安装",
        link: "/install",
        items: [
          { text: "受限模式", link: "/install/limited-mode" },
          { text: "原生模式", link: "/install/native-mode" },
          { text: "Docker", link: "/install/docker" },
          { text: "双镜像部署", link: "/install/dual-image" },
          { text: "fnOS（飞牛）", link: "/install/fnos" },
        ],
      },
      { text: "与上游的差异", link: "/differences" },
      {
        text: "配置",
        link: "/configuration",
        items: [
          { text: "常见问题", link: "/configuration/common-issues" },
          { text: "TLS 与证书", link: "/configuration/tls" },
          {
            text: "敏感值",
            link: "/configuration#敏感值",
          },
        ],
      },
      { text: "Nix", link: "/Nix" },
      { text: "NixOS", link: "/NixOS-options" },
      {
        text: "功能",
        items: [
          { text: "功能总览", link: "/features/overview" },
          { text: "告警通知", link: "/features/notifications" },
          {
            text: "单点登录（SSO）",
            link: "/features/sso",
            items: [{ text: "代理认证", link: "/features/proxy-auth" }],
          },
          { text: "访问控制", link: "/features/acls" },
          { text: "API 密钥", link: "/features/api-keys" },
          { text: "批量操作", link: "/features/bulk-operations" },
          { text: "DNS", link: "/features/dns" },
          { text: "Headscale 设置", link: "/features/headscale-settings" },
          { text: "系统状态", link: "/features/system-status" },
          { text: "操作审计", link: "/features/audit" },
          { text: "配置快照", link: "/features/snapshots" },
          { text: "HeadplaneCN Agent", link: "/features/agent" },
          { text: "浏览器 SSH", link: "/features/ssh" },
          { text: "多语言", link: "/features/languages" },
        ],
      },
      {
        text: "开发",
        collapsed: true,
        items: [
          { text: "架构", link: "/development/architecture" },
          { text: "贡献指南", link: "/CONTRIBUTING" },
          { text: "安全", link: "/SECURITY" },
        ],
      },
    ],
  },
  {
    text: "支持",
    items: [{ text: "赞助", link: "/sponsor" }],
  },
];

// English mirrors the same structure under `/en/`; no entry leaves the prefix.
const enNav = [
  { text: "Home", link: "/en/" },
  { text: "Sponsor", link: "/en/sponsor" },
  { text: "Changelog", link: "/en/CHANGELOG" },
  { text: "Version history", link: "/en/versions" },
];

const enSidebar = [
  {
    text: "Getting Started",
    items: [
      { text: "What is HeadplaneCN?", link: "/en/introduction" },
      {
        text: "Installation",
        link: "/en/install",
        items: [
          { text: "Limited Mode", link: "/en/install/limited-mode" },
          { text: "Native Mode", link: "/en/install/native-mode" },
          { text: "Docker", link: "/en/install/docker" },
          { text: "Dual-Image Deployment", link: "/en/install/dual-image" },
          { text: "fnOS (飞牛)", link: "/en/install/fnos" },
        ],
      },
      { text: "Differences from upstream", link: "/en/differences" },
      {
        text: "Configuration",
        link: "/en/configuration",
        items: [
          { text: "Common Issues", link: "/en/configuration/common-issues" },
          { text: "TLS & Certificates", link: "/en/configuration/tls" },
          {
            text: "Sensitive Values",
            link: "/en/configuration#sensitive-values",
          },
        ],
      },
      { text: "Nix", link: "/en/Nix" },
      { text: "NixOS", link: "/en/NixOS-options" },
      {
        text: "Features",
        items: [
          { text: "Overview", link: "/en/features/overview" },
          { text: "Alert Notifications", link: "/en/features/notifications" },
          {
            text: "Single Sign-On (SSO)",
            link: "/en/features/sso",
            items: [{ text: "Proxy Authentication", link: "/en/features/proxy-auth" }],
          },
          { text: "Access Control", link: "/en/features/acls" },
          { text: "API Keys", link: "/en/features/api-keys" },
          { text: "Bulk Operations", link: "/en/features/bulk-operations" },
          { text: "DNS", link: "/en/features/dns" },
          { text: "Headscale Settings", link: "/en/features/headscale-settings" },
          { text: "System Status", link: "/en/features/system-status" },
          { text: "Audit Log", link: "/en/features/audit" },
          { text: "Snapshots", link: "/en/features/snapshots" },
          { text: "HeadplaneCN Agent", link: "/en/features/agent" },
          { text: "Browser SSH", link: "/en/features/ssh" },
          { text: "Languages", link: "/en/features/languages" },
        ],
      },
      {
        text: "Development",
        collapsed: true,
        items: [
          { text: "Architecture", link: "/en/development/architecture" },
          { text: "Contributing", link: "/en/CONTRIBUTING" },
          { text: "Security", link: "/en/SECURITY" },
        ],
      },
    ],
  },
  {
    text: "Support",
    items: [{ text: "Sponsor", link: "/en/sponsor" }],
  },
];

// Deep-link target for "edit this page"; `:path` already carries the locale
// directory, so the same pattern serves both locales.
const editLinkPattern = "https://github.com/CGG888/headplaneCN/edit/main/docs/:path";

const lastUpdatedFormat = {
  dateStyle: "full",
  timeStyle: "medium",
} as const;

export default defineConfig({
  vite: {
    define: {
      __HEADPLANE_BETA_DOCS__: JSON.stringify(process.env.HEADPLANE_BETA_DOCS === "true"),
    },
  },
  title: "HeadplaneCN 中文文档",
  description: "HeadplaneCN 的 Web 管理界面",
  base,
  // One hostname covers every locale; the plugin derives the per-page
  // `hreflang` alternates from `locales` itself.
  sitemap: {
    hostname: "https://cgg888.github.io/headplaneCN/",
  },
  cleanUrls: true,
  // Head tags are not rewritten with `base`, so prefix asset paths by hand.
  head: [["link", { rel: "icon", href: `${base}logo.svg` }]],
  locales: {
    // The default locale: Simplified Chinese at the site root.
    root: {
      label: "简体中文",
      lang: "zh-Hans",
      title: "HeadplaneCN 中文文档",
      description: "HeadplaneCN 的 Web 管理界面",
      themeConfig: {
        nav: zhHansNav,
        sidebar: zhHansSidebar,
        search: {
          provider: "local",
          options: {
            translations: {
              button: {
                buttonText: "搜索",
                buttonAriaLabel: "搜索文档",
              },
              modal: {
                displayDetails: "显示详细列表",
                resetButtonTitle: "清除搜索条件",
                backButtonTitle: "关闭搜索",
                noResultsText: "没有找到相关结果：",
                footer: {
                  selectText: "选择",
                  selectKeyAriaLabel: "回车键",
                  navigateText: "切换",
                  navigateUpKeyAriaLabel: "上箭头",
                  navigateDownKeyAriaLabel: "下箭头",
                  closeText: "关闭",
                  closeKeyAriaLabel: "Esc",
                },
              },
            },
          },
        },
      },
    },
    en: {
      label: "English",
      lang: "en",
      link: "/en/",
      title: "HeadplaneCN",
      description: "The missing dashboard for Headscale",
      themeConfig: {
        nav: enNav,
        sidebar: enSidebar,
        outline: { label: "On this page" },
        docFooter: { prev: "Previous page", next: "Next page" },
        editLink: {
          pattern: editLinkPattern,
          text: "Edit this page on GitHub",
        },
        lastUpdated: {
          text: "Updated at",
          formatOptions: lastUpdatedFormat,
        },
        darkModeSwitchLabel: "Appearance",
        lightModeSwitchTitle: "Switch to light theme",
        darkModeSwitchTitle: "Switch to dark theme",
        sidebarMenuLabel: "Menu",
        returnToTopLabel: "Return to top",
        langMenuLabel: "Change language",
        skipToContentLabel: "Skip to content",
      },
    },
  },
  // Chinese-first defaults for the root locale; the `en` locale overrides the
  // UI strings it needs to.
  themeConfig: {
    logo: "/logo.svg",
    search: {
      provider: "local",
    },
    outline: { label: "本页目录" },
    docFooter: { prev: "上一页", next: "下一页" },
    editLink: {
      pattern: editLinkPattern,
      text: "在 GitHub 上编辑此页",
    },
    lastUpdated: {
      text: "最后更新",
      formatOptions: lastUpdatedFormat,
    },
    darkModeSwitchLabel: "外观",
    lightModeSwitchTitle: "切换到浅色主题",
    darkModeSwitchTitle: "切换到深色主题",
    sidebarMenuLabel: "目录",
    returnToTopLabel: "回到顶部",
    langMenuLabel: "切换语言",
    skipToContentLabel: "跳转到内容",

    socialLinks: [
      { icon: "github", link: "https://github.com/CGG888/headplaneCN" },
      // Sponsorship goes to this fork's own sponsor page (upstream links removed).
      { icon: "githubsponsors", link: `${base}sponsor`, ariaLabel: "赞助 / Sponsor" },
    ],
  },
});
