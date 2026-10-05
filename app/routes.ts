import { index, layout, prefix, route } from "@react-router/dev/routes";

export default [
  // Utility Routes
  route("/healthz", "routes/util/healthz.ts"),

  // API Routes
  ...prefix("/api", [
    route("/info", "routes/util/info.ts"),
    route("/color-scheme", "routes/util/color-scheme.ts"),
    route("/locale", "routes/util/locale.ts"),
  ]),
  ...prefix("/events", [route("/live", "routes/util/live.ts")]),

  // Snapshot downloads stream a file straight to the browser, so they sit
  // outside the application layout instead of rendering the UI around them.
  route("/settings/snapshots/download", "routes/settings/snapshots/download.ts"),

  // Headplane's own database is a second, clearly separate download: the route
  // above only ever carries Headscale's configuration.
  route("/settings/snapshots/data-backup", "routes/settings/snapshots/data-backup.ts"),

  // Audit exports are downloads too, so they get the same treatment.
  route("/settings/audit/export", "routes/settings/audit/export.ts"),

  // Authentication Routes
  route("/login", "routes/auth/login/page.tsx"),
  route("/logout", "routes/auth/logout.ts"),
  route("/oidc/callback", "routes/auth/oidc-callback.ts"),
  route("/oidc/start", "routes/auth/oidc-start.ts"),
  route("/ssh/:id", "routes/ssh/page.tsx"),

  // All the main logged-in routes
  layout("layout/app.tsx", [
    index("routes/home.tsx"),
    route("/overview", "routes/overview.tsx"),
    ...prefix("/machines", [
      index("routes/machines/overview.tsx"),
      route("/:id", "routes/machines/machine.tsx"),
    ]),

    route("/users", "routes/users/overview.tsx"),
    route("/acls", "routes/acls/overview.tsx"),
    route("/dns", "routes/dns/overview.tsx"),

    ...prefix("/settings", [
      index("routes/settings/overview.tsx"),
      route("/auth-keys", "routes/settings/auth-keys/overview.tsx"),
      route("/api-keys", "routes/settings/api-keys/overview.tsx"),
      route("/restrictions", "routes/settings/restrictions/overview.tsx"),
      route("/agent", "routes/settings/agent.tsx"),
      route("/headscale", "routes/settings/headscale/overview.tsx"),
      route("/system", "routes/settings/system/overview.tsx"),
      route("/audit", "routes/settings/audit/overview.tsx"),
      route("/snapshots", "routes/settings/snapshots/overview.tsx"),
      route("/notifications", "routes/settings/notifications/overview.tsx"),
    ]),
  ]),

  // Catch-all: renders a localized 404 instead of React Router's default page.
  route("*", "routes/util/not-found.tsx"),
];
