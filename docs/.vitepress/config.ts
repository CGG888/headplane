import { defineConfig } from "vitepress";

// GitHub Pages project site: https://cgg888.github.io/headplaneCN/
const base = "/headplaneCN/";

// Simplified Chinese navigation. Mirrors the English sidebar order; only the
// pages translated under `docs/zh-Hans` are listed so no entry points at a
// page that does not exist.
const zhHansNav = [
  { text: "首页", link: "/zh-Hans/" },
  { text: "安装", link: "/zh-Hans/install" },
  { text: "功能", link: "/zh-Hans/features/overview" },
  { text: "English", link: "/" },
];

const zhHansSidebar = [
  {
    text: "开始使用",
    items: [
      {
        text: "安装",
        link: "/zh-Hans/install",
        items: [{ text: "fnOS（飞牛）", link: "/zh-Hans/install/fnos" }],
      },
      {
        text: "功能",
        items: [
          { text: "功能总览", link: "/zh-Hans/features/overview" },
          { text: "告警通知", link: "/zh-Hans/features/notifications" },
          { text: "访问控制", link: "/zh-Hans/features/acls" },
          { text: "API 密钥", link: "/zh-Hans/features/api-keys" },
          { text: "批量操作", link: "/zh-Hans/features/bulk-operations" },
          { text: "DNS", link: "/zh-Hans/features/dns" },
          { text: "Headscale 设置", link: "/zh-Hans/features/headscale-settings" },
          { text: "系统状态", link: "/zh-Hans/features/system-status" },
          { text: "操作审计", link: "/zh-Hans/features/audit" },
          { text: "配置快照", link: "/zh-Hans/features/snapshots" },
          { text: "Headplane Agent", link: "/zh-Hans/features/agent" },
          { text: "机器管理", link: "/zh-Hans/features/machines" },
          { text: "多语言", link: "/zh-Hans/features/languages" },
        ],
      },
    ],
  },
];

export default defineConfig({
  vite: {
    define: {
      __HEADPLANE_BETA_DOCS__: JSON.stringify(process.env.HEADPLANE_BETA_DOCS === "true"),
    },
  },
  title: "Headplane",
  description: "The missing dashboard for Headscale",
  base,
  sitemap: {
    hostname: "https://cgg888.github.io/headplaneCN/",
  },
  cleanUrls: true,
  // Head tags are not rewritten with `base`, so prefix asset paths by hand.
  head: [["link", { rel: "icon", href: `${base}logo.svg` }]],
  locales: {
    root: {
      label: "English",
      lang: "en",
      link: "/",
    },
    "zh-Hans": {
      label: "简体中文",
      lang: "zh-Hans",
      link: "/zh-Hans/",
      title: "Headplane 中文文档",
      description: "Headscale 的 Web 管理界面",
      themeConfig: {
        nav: zhHansNav,
        sidebar: zhHansSidebar,
        lastUpdated: {
          text: "最后更新",
        },
      },
    },
  },
  themeConfig: {
    logo: "/logo.svg",
    nav: [
      { text: "Home", link: "/" },
      { text: "Changelog", link: "/CHANGELOG" },
    ],
    search: {
      provider: "local",
    },
    sidebar: [
      {
        text: "Getting Started",
        items: [
          { text: "What is Headplane?", link: "/introduction" },
          {
            text: "Installation",
            link: "/install",
            items: [
              { text: "Limited Mode", link: "/install/limited-mode" },
              { text: "Native Mode", link: "/install/native-mode" },
              { text: "Docker", link: "/install/docker" },
              { text: "fnOS (飞牛)", link: "/install/fnos" },
            ],
          },
          {
            text: "Configuration",
            link: "/configuration",
            items: [
              { text: "Common Issues", link: "/configuration/common-issues" },
              { text: "TLS & Certificates", link: "/configuration/tls" },
              {
                text: "Sensitive Values",
                link: "/configuration#sensitive-values",
              },
            ],
          },
          { text: "Nix", link: "/Nix" },
          { text: "NixOS", link: "/NixOS-options" },
          {
            text: "Features",
            items: [
              { text: "Overview", link: "/features/overview" },
              { text: "Alert Notifications", link: "/features/notifications" },
              {
                text: "Single Sign-On (SSO)",
                link: "/features/sso",
                items: [{ text: "Proxy Authentication", link: "/features/proxy-auth" }],
              },
              { text: "Access Control", link: "/features/acls" },
              { text: "API Keys", link: "/features/api-keys" },
              { text: "Bulk Operations", link: "/features/bulk-operations" },
              { text: "DNS", link: "/features/dns" },
              { text: "Headscale Settings", link: "/features/headscale-settings" },
              { text: "System Status", link: "/features/system-status" },
              { text: "Audit Log", link: "/features/audit" },
              { text: "Snapshots", link: "/features/snapshots" },
              { text: "Headplane Agent", link: "/features/agent" },
              { text: "Browser SSH", link: "/features/ssh" },
              { text: "Languages", link: "/features/languages" },
            ],
          },
          {
            text: "Development",
            collapsed: true,
            items: [
              { text: "Architecture", link: "/development/architecture" },
              { text: "Contributing", link: "/CONTRIBUTING" },
              { text: "Security", link: "/SECURITY" },
            ],
          },
        ],
      },
    ],

    socialLinks: [
      { icon: "github", link: "https://github.com/tale/headplane" },
      { icon: "githubsponsors", link: "https://github.com/sponsors/tale" },
      { icon: "kofi", link: "https://ko-fi.com/atale" },
    ],

    lastUpdated: {
      text: "Updated at",
      formatOptions: {
        dateStyle: "full",
        timeStyle: "medium",
      },
    },
  },
});
