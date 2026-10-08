import { dirname } from "node:path";

import { data } from "react-router";

import { AUDIT_ACTIONS, auditActorOf, type AuditService } from "~/server/audit";
import {
  appConfigContext,
  auditContext,
  authContext,
  derpMirrorContext,
  derpSyncContext,
  headscaleConfigContext,
  headscaleContext,
  integrationContext,
  snapshotContext,
} from "~/server/context";
import { ensureMirrorPathInDerpPaths } from "~/server/derp-mirror/paths";
import { mirrorTargetProblem, type DerpMirrorService } from "~/server/derp-mirror/service.server";
import {
  DERP_MIRROR_MAX_SOURCES,
  isAbsoluteHttpUrl,
  normalizeOfficialRegionId,
  parseDerpMirrorIntervalHours,
} from "~/server/derp-mirror/settings";
import { parseDerpMapBody } from "~/server/derp-mirror/sources";
import type { DerpMirrorReload } from "~/server/derp-mirror/types";
import {
  invalidateDerpData,
  refreshDerpAfterWrite,
  type DerpChangeKind,
} from "~/server/derp-refresh";
import { isDerpSyncFamilies, parseDerpSyncIntervalHours } from "~/server/derp-sync/settings";
import { restoreDerpMapFile, saveDerpMapFile } from "~/server/headscale/derp-map-files";
import {
  DERP_REGION_NAMES_SNAPSHOT_REASON,
  mergeMissingDerpRegionNames,
  readDerpRegionNames,
  removeDerpRegionName,
  setDerpRegionName,
  writeDerpRegionNames,
  type DerpRegionNameEntry,
} from "~/server/headscale/derp-region-names";
import { clearHostEchoCache, parseHostEchoUrl, writeHostEchoSettings } from "~/server/host-echo";
import { snapshotBeforeMutation } from "~/server/snapshots/service.server";
import type { Principal } from "~/server/web/auth";
import { Capabilities } from "~/server/web/roles";
import log from "~/utils/log";

import type { Route } from "./+types/overview";
import {
  isHeadscaleDuration,
  isLogFormat,
  isLogLevel,
  MIN_EPHEMERAL_INACTIVITY_SECONDS,
  parseGoDurationSeconds,
  validateHaProbeSettings,
} from "./advanced-settings";
import type { DerpMapIssue } from "./derp-map-schema";
import {
  defaultDerpPrivateKeyPath,
  isAbsoluteFilePath,
  isDerpIpv4Address,
  isDerpIpv6Address,
  isDerpStunAddress,
  isHttpUrl,
  parseDerpRegionId,
  parseDerpRegionMapId,
  parseDerpUpdateFrequencySeconds,
} from "./derp-settings";
import type {
  HeadscaleSettingsErrorCode,
  HeadscaleSettingsFailure,
  HeadscaleSettingsSuccess,
  MirrorPathReport,
} from "./error-keys";
import { runOidcSelfTest } from "./oidc-self-test";
import { validateTrustedProxyCidr } from "./trusted-proxies";

const PKCE_METHODS = new Set(["plain", "S256"]);
const POLICY_MODES = new Set(["file", "database"]);

/**
 * The snapshot reason recorded before the mirror's target file is added to
 * `derp.paths`. The mirror snapshots the map file it replaces; this one covers
 * the configuration change that makes Headscale load that file at all.
 */
export const DERP_MIRROR_PATH_SNAPSHOT_REASON = "derp-mirror-path";

/**
 * Actions that must not be refused just because Headscale's configuration file
 * is mounted read-only.
 *
 * The OIDC self-test only reads the configuration. The official-region filter
 * keeps its own settings in Headplane's data directory and its map file in a
 * mounted directory, so a read-only Headscale configuration still lets the
 * operator save, check, run and renumber it; the one step that touches the
 * configuration — adding the file to `derp.paths` — reports itself as skipped
 * instead of failing the save. Every other action still needs a write.
 */
const READ_ONLY_TOLERANT_ACTIONS = new Set([
  "test_oidc",
  "add_mirror_region_names",
  "save_derp_mirror",
  "save_derp_mirror_paste",
  "clear_derp_mirror_paste",
  "check_derp_mirror",
  "run_derp_mirror",
  "reassign_derp_mirror",
  "probe_derp_latency",
  "derp_latency_probe_status",
  "cancel_derp_latency_probe",
]);

/** Form field to Headscale config path for the boolean feature switches. */
const FEATURE_PATHS = [
  ["taildrop_enabled", "taildrop.enabled"],
  ["auto_update_enabled", "auto_update.enabled"],
  ["logtail_enabled", "logtail.enabled"],
] as const;

export async function headscaleSettingsAction({ request, context }: Route.ActionArgs) {
  const auth = context.get(authContext);
  const headscale = context.get(headscaleContext);
  const headscaleConfig = context.get(headscaleConfigContext);
  const integration = context.get(integrationContext);

  const principal = await auth.require(request);
  const check = auth.can(principal, Capabilities.configure_iam);
  if (!check) {
    throw data({ localized: { key: "errors.permission.modifyIam" } }, { status: 403 });
  }

  const formData = await request.formData();
  const action = formData.get("action_id")?.toString();

  /**
   * Every DERP write funnels through this: it clears what this process cached
   * (map files, remote maps, relay DNS) and, when this deployment can, gets the
   * change into Headscale's running process. The result is recorded so the DERP
   * page can say whether the change is live or still waiting for a restart.
   */
  const refreshDerp = (changeKind: DerpChangeKind, reason: string) =>
    refreshDerpAfterWrite({
      headscale,
      integration,
      changeKind,
      reason,
      autoUpdateEnabled: headscaleConfig.getDERPSettings().autoUpdateEnabled,
    });

  // The self-test only reads the configuration and the identity provider, and
  // the region filter keeps everything of its own outside Headscale's
  // configuration file, so neither is refused when that file is read-only.
  if (!READ_ONLY_TOLERANT_ACTIONS.has(action ?? "") && !headscaleConfig.writable()) {
    throw data({ localized: { key: "errors.headscaleConfigNotWritable" } }, { status: 403 });
  }

  switch (action) {
    case "test_oidc": {
      // Real checks against the provider, run server-side so the browser never
      // talks to it directly. Nothing is written and the client secret is never
      // read: the runner only learns whether one is configured.
      const oidc = headscaleConfig.getOIDCSettings();
      const appConfig = context.get(appConfigContext);
      const selfTest = await runOidcSelfTest({
        issuer: oidc?.issuer,
        clientId: oidc?.clientId,
        hasInlineClientSecret: oidc?.hasInlineClientSecret ?? false,
        clientSecretPath: oidc?.clientSecretPath,
        scope: oidc?.scope,
        pkceEnabled: oidc?.pkceEnabled ?? false,
        pkceMethod: oidc?.pkceMethod,
        allowedDomains: oidc?.allowedDomains,
        allowedGroups: oidc?.allowedGroups,
        allowedUsers: oidc?.allowedUsers,
        baseUrl: appConfig?.server.base_url,
      });

      return data({ success: true, selfTest } satisfies HeadscaleSettingsSuccess);
    }

    case "save_oidc": {
      // Headscale treats an empty issuer as "OIDC disabled", so clearing the
      // field is a legitimate change. A configured provider, however, needs a
      // real http(s) URL and the client ID registered with it.
      const issuer = readField(formData, "issuer");
      const clientId = readField(formData, "client_id");
      if (issuer.length > 0) {
        if (!isHttpUrl(issuer)) {
          return failure("invalidIssuer");
        }

        if (clientId.length === 0) {
          return failure("invalidClientId");
        }
      }

      const scope = splitList(readField(formData, "scope"));
      if (scope.length === 0) {
        return failure("invalidScope");
      }

      const pkceMethod = readField(formData, "pkce_method");
      if (!PKCE_METHODS.has(pkceMethod)) {
        return failure("invalidPkceMethod");
      }

      const patches: { path: string; value: unknown }[] = [
        { path: "oidc.issuer", value: issuer },
        { path: "oidc.client_id", value: clientId },
        { path: "oidc.scope", value: scope },
        {
          path: "oidc.email_verified_required",
          value: readField(formData, "email_verified_required") === "true",
        },
        {
          path: "oidc.use_expiry_from_token",
          value: readField(formData, "use_expiry_from_token") === "true",
        },
        {
          path: "oidc.only_start_if_oidc_is_available",
          value: readField(formData, "only_start_if_oidc_is_available") === "true",
        },
        { path: "oidc.pkce.enabled", value: readField(formData, "pkce_enabled") === "true" },
        { path: "oidc.pkce.method", value: pkceMethod },
      ];

      // The secret is write-only. An empty field means "keep the stored
      // secret", so it must not be patched at all.
      const clientSecret = formData.get("client_secret")?.toString() ?? "";
      if (clientSecret.length > 0) {
        patches.push({ path: "oidc.client_secret", value: clientSecret });
      }

      // The path is the safer alternative to an inline secret. Headscale reads
      // the file itself (and expands environment variables in the path), so
      // there is nothing to validate here; an empty field removes the key.
      const clientSecretPath = readField(formData, "client_secret_path");
      patches.push({
        path: "oidc.client_secret_path",
        value: clientSecretPath.length > 0 ? clientSecretPath : null,
      });

      await headscaleConfig.patch(patches);
      await integration?.onConfigChange(headscale);
      return success();
    }

    case "save_oidc_extra_params": {
      // The editor sends one key and one value field per row. A row that is
      // empty on both sides is a leftover from "add parameter", not something
      // the operator meant to save.
      const keys = formData.getAll("extra_param_key").map((entry) => entry.toString().trim());
      const values = formData.getAll("extra_param_value").map((entry) => entry.toString().trim());
      const rowCount = Math.max(keys.length, values.length);

      const extraParams: Record<string, string> = {};
      for (let index = 0; index < rowCount; index++) {
        const key = keys[index] ?? "";
        const value = values[index] ?? "";
        if (key.length === 0 && value.length === 0) {
          continue;
        }

        // Headscale sends these verbatim to the authorization endpoint, so a
        // nameless or whitespace-ridden key cannot be turned into a query
        // parameter and an empty value would silently disappear.
        if (key.length === 0 || value.length === 0 || /\s/.test(key)) {
          return failure("invalidOidcExtraParams");
        }

        if (key in extraParams) {
          return failure("duplicateOidcExtraParam");
        }

        extraParams[key] = value;
      }

      // An empty map removes `oidc.extra_params` instead of writing `{}`, which
      // is what Headscale's own example leaves behind when nothing is set.
      await headscaleConfig.patch([
        {
          path: "oidc.extra_params",
          value: Object.keys(extraParams).length > 0 ? extraParams : null,
        },
      ]);
      await integration?.onConfigChange(headscale);
      return success();
    }

    case "add_trusted_proxy": {
      const proxy = readField(formData, "proxy");
      const problem = validateTrustedProxyCidr(proxy);
      if (problem === "invalid") {
        return failure("invalidCidr");
      }

      if (problem === "unspecified") {
        return failure("unspecifiedCidr");
      }

      const { trustedProxies } = headscaleConfig.getTailnetSettings();
      if (trustedProxies.includes(proxy)) {
        return failure("duplicateProxy");
      }

      await headscaleConfig.mutate(() => {
        // Re-read inside the write queue: two concurrent adds must not both
        // start from the same list and have the later write drop the earlier.
        const current = headscaleConfig.getTailnetSettings();
        if (current.trustedProxies.includes(proxy)) {
          return [];
        }

        return [{ path: "trusted_proxies", value: [...current.trustedProxies, proxy] }];
      });
      await integration?.onConfigChange(headscale);
      return success();
    }

    case "remove_trusted_proxy": {
      const proxy = readField(formData, "proxy");
      const { trustedProxies } = headscaleConfig.getTailnetSettings();
      if (!trustedProxies.includes(proxy)) {
        return failure("proxyNotFound");
      }

      await headscaleConfig.mutate(() => {
        const current = headscaleConfig.getTailnetSettings();
        if (!current.trustedProxies.includes(proxy)) {
          return [];
        }

        return [
          {
            path: "trusted_proxies",
            value: current.trustedProxies.filter((entry) => entry !== proxy),
          },
        ];
      });
      await integration?.onConfigChange(headscale);
      return success();
    }

    case "set_policy_mode": {
      const mode = readField(formData, "policy_mode");
      if (!POLICY_MODES.has(mode)) {
        return failure("invalidPolicyMode");
      }

      await headscaleConfig.patch([{ path: "policy.mode", value: mode }]);
      await integration?.onConfigChange(headscale);
      return success();
    }

    case "save_node_settings": {
      // Headscale parses `node.expiry` with prometheus' model.ParseDuration,
      // where the literal "0" means "nodes never expire".
      const nodeExpiry = readField(formData, "node_expiry");
      if (!isHeadscaleDuration(nodeExpiry)) {
        return failure("invalidNodeExpiry");
      }

      // Headscale refuses to start when the inactivity timeout is 65s or less.
      const inactivityTimeout = readField(formData, "ephemeral_inactivity_timeout");
      const inactivitySeconds = parseGoDurationSeconds(inactivityTimeout);
      if (
        inactivitySeconds === undefined ||
        inactivitySeconds <= MIN_EPHEMERAL_INACTIVITY_SECONDS
      ) {
        return failure("invalidEphemeralInactivity");
      }

      await headscaleConfig.patch([
        { path: "node.expiry", value: nodeExpiry },
        { path: "node.ephemeral.inactivity_timeout", value: inactivityTimeout },
      ]);
      await integration?.onConfigChange(headscale);
      return success();
    }

    case "save_ha_probe_settings": {
      // HA subnet-router health probing, added in Headscale 0.29. Headscale's
      // own rules are spelled out in its config-example.yaml; an interval of 0
      // disables probing, so it is valid and skips the ordering check.
      const interval = readField(formData, "ha_probe_interval");
      const timeout = readField(formData, "ha_probe_timeout");

      const problem = validateHaProbeSettings(interval, timeout);
      switch (problem) {
        case "invalidInterval": {
          return failure("invalidHaProbeInterval");
        }
        case "invalidTimeout": {
          return failure("invalidHaProbeTimeout");
        }
        case "timeoutNotBelowInterval": {
          return failure("invalidHaProbeCombination");
        }
        default: {
          break;
        }
      }

      await headscaleConfig.patch([
        { path: "node.routes.ha.probe_interval", value: interval },
        { path: "node.routes.ha.probe_timeout", value: timeout },
      ]);
      await integration?.onConfigChange(headscale);
      return success();
    }

    case "save_log_settings": {
      const level = readField(formData, "log_level");
      if (!isLogLevel(level)) {
        return failure("invalidLogLevel");
      }

      const format = readField(formData, "log_format");
      if (!isLogFormat(format)) {
        return failure("invalidLogFormat");
      }

      await headscaleConfig.patch([
        { path: "log.level", value: level },
        { path: "log.format", value: format },
      ]);
      await integration?.onConfigChange(headscale);
      return success();
    }

    case "save_feature_settings": {
      const patches: { path: string; value: unknown }[] = [];
      for (const [field, path] of FEATURE_PATHS) {
        const value = readBooleanField(formData, field);
        if (value === undefined) {
          return failure("invalidBooleanValue");
        }

        patches.push({ path, value });
      }

      // `disable_check_updates` is Headscale's opt-out, so the form sends the
      // inverted "check for updates" switch and the value is flipped here.
      const checkUpdates = readBooleanField(formData, "check_updates");
      if (checkUpdates === undefined) {
        return failure("invalidBooleanValue");
      }

      patches.push({ path: "disable_check_updates", value: !checkUpdates });

      await headscaleConfig.patch(patches);
      await integration?.onConfigChange(headscale);
      return success();
    }

    case "add_derp_url": {
      const url = readField(formData, "url");
      if (!isHttpUrl(url)) {
        return failure("invalidDerpUrl");
      }

      const { urls } = headscaleConfig.getDERPSettings();
      if (urls.includes(url)) {
        return failure("duplicateDerpUrl");
      }

      await headscaleConfig.mutate(() => {
        const current = headscaleConfig.getDERPSettings();
        if (current.urls.includes(url)) {
          return [];
        }

        return [{ path: "derp.urls", value: [...current.urls, url] }];
      });
      await refreshDerp("config", "add_derp_url");
      return success();
    }

    case "remove_derp_url": {
      const url = readField(formData, "url");
      const { urls } = headscaleConfig.getDERPSettings();
      if (!urls.includes(url)) {
        return failure("derpUrlNotFound");
      }

      await headscaleConfig.mutate(() => {
        const current = headscaleConfig.getDERPSettings();
        if (!current.urls.includes(url)) {
          return [];
        }

        return [{ path: "derp.urls", value: current.urls.filter((entry) => entry !== url) }];
      });
      await refreshDerp("config", "remove_derp_url");
      return success();
    }

    case "add_derp_path": {
      const path = readField(formData, "path");
      if (path.length === 0) {
        return failure("invalidDerpPath");
      }

      const { paths } = headscaleConfig.getDERPSettings();
      if (paths.includes(path)) {
        return failure("duplicateDerpPath");
      }

      await headscaleConfig.mutate(() => {
        const current = headscaleConfig.getDERPSettings();
        if (current.paths.includes(path)) {
          return [];
        }

        return [{ path: "derp.paths", value: [...current.paths, path] }];
      });
      await refreshDerp("config", "add_derp_path");
      return success();
    }

    case "remove_derp_path": {
      const path = readField(formData, "path");
      const { paths } = headscaleConfig.getDERPSettings();
      if (!paths.includes(path)) {
        return failure("derpPathNotFound");
      }

      await headscaleConfig.mutate(() => {
        const current = headscaleConfig.getDERPSettings();
        if (!current.paths.includes(path)) {
          return [];
        }

        return [{ path: "derp.paths", value: current.paths.filter((entry) => entry !== path) }];
      });
      await refreshDerp("config", "remove_derp_path");
      return success();
    }

    case "save_derp_settings": {
      const autoUpdateEnabled = readBooleanField(formData, "derp_auto_update_enabled");
      if (autoUpdateEnabled === undefined) {
        return failure("invalidBooleanValue");
      }

      // Headscale reads this with Go's time.ParseDuration; a zero interval
      // would make its DERP updater busy-loop.
      const updateFrequency = readField(formData, "derp_update_frequency");
      if (parseDerpUpdateFrequencySeconds(updateFrequency) === undefined) {
        return failure("invalidDerpUpdateFrequency");
      }

      await headscaleConfig.patch([
        { path: "derp.auto_update_enabled", value: autoUpdateEnabled },
        { path: "derp.update_frequency", value: updateFrequency },
      ]);
      await refreshDerp("config", "save_derp_settings");
      return success();
    }

    case "enable_derp_auto_update": {
      // The one-click version of the setting above, for an operator who just
      // changed a map file and does not want to restart Headscale for it. Ten
      // minutes is short enough to feel automatic and long enough that the
      // updater's own netmap change — Headscale reshuffles the map it hands out
      // on every tick — stays a background detail. The updater is created when
      // Headscale starts, so this first save still needs one restart.
      await headscaleConfig.patch([
        { path: "derp.auto_update_enabled", value: true },
        { path: "derp.update_frequency", value: "10m" },
      ]);
      await refreshDerp("config", "enable_derp_auto_update");
      return success();
    }

    case "save_derp_server": {
      const enabled = readBooleanField(formData, "derp_server_enabled");
      const verifyClients = readBooleanField(formData, "derp_server_verify_clients");
      const automaticallyAdd = readBooleanField(
        formData,
        "derp_server_automatically_add_embedded_derp_region",
      );
      if (enabled === undefined || verifyClients === undefined || automaticallyAdd === undefined) {
        return failure("invalidBooleanValue");
      }

      // Headscale reserves 900-999 for embedded DERP regions.
      const regionId = parseDerpRegionId(readField(formData, "derp_server_region_id"));
      if (regionId === undefined) {
        return failure("invalidDerpRegionId");
      }

      const regionCode = readField(formData, "derp_server_region_code");
      const regionName = readField(formData, "derp_server_region_name");
      if (regionCode.length === 0 || regionName.length === 0) {
        return failure("invalidDerpRegionCode");
      }

      // Headscale refuses to start an enabled embedded server without a STUN
      // address, and without a DERP map entry it cannot fall back to either.
      const stunListenAddr = readField(formData, "derp_server_stun_listen_addr");
      if (enabled && stunListenAddr.length === 0) {
        return failure("missingDerpStunAddr");
      }

      // Both public addresses are optional. An empty field clears a previously
      // configured value by deleting the key, so Headscale falls back to the
      // address it derives itself instead of advertising an empty string.
      const ipv4 = readField(formData, "derp_server_ipv4");
      if (!isDerpIpv4Address(ipv4)) {
        return failure("invalidDerpIpv4");
      }

      const ipv6 = readField(formData, "derp_server_ipv6");
      if (!isDerpIpv6Address(ipv6)) {
        return failure("invalidDerpIpv6");
      }

      const { paths } = headscaleConfig.getDERPSettings();
      if (enabled && !automaticallyAdd && paths.length === 0) {
        return failure("derpPathsRequired");
      }

      await headscaleConfig.patch([
        { path: "derp.server.enabled", value: enabled },
        { path: "derp.server.region_id", value: regionId },
        { path: "derp.server.region_code", value: regionCode },
        { path: "derp.server.region_name", value: regionName },
        { path: "derp.server.stun_listen_addr", value: stunListenAddr },
        { path: "derp.server.ipv4", value: ipv4.length > 0 ? ipv4 : null },
        { path: "derp.server.ipv6", value: ipv6.length > 0 ? ipv6 : null },
        { path: "derp.server.verify_clients", value: verifyClients },
        {
          path: "derp.server.automatically_add_embedded_derp_region",
          value: automaticallyAdd,
        },
      ]);
      await refreshDerp("config", "save_derp_server");
      return success();
    }

    case "save_derp_sync": {
      // The sync settings live in Headplane's own data directory, not in
      // Headscale's configuration: only the addresses a run writes end up in
      // the config file, and the schedule itself never does.
      const derpSync = context.get(derpSyncContext);
      const enabled = readBooleanField(formData, "derp_sync_enabled");
      const autoReload = readBooleanField(formData, "derp_sync_auto_reload");
      if (enabled === undefined || autoReload === undefined) {
        return failure("invalidBooleanValue");
      }

      const intervalHours = parseDerpSyncIntervalHours(
        readField(formData, "derp_sync_interval_hours"),
      );
      if (intervalHours === undefined) {
        return failure("invalidDerpSyncInterval");
      }

      const families = readField(formData, "derp_sync_families");
      if (!isDerpSyncFamilies(families)) {
        return failure("invalidDerpSyncFamilies");
      }

      const result = await derpSync.update({ enabled, intervalHours, families, autoReload });
      if (!result.success) {
        return failure("derpSyncSaveFailed");
      }

      // The address the sync writes ends up in the DERP map this page renders.
      invalidateDerpData();
      return success();
    }

    case "run_derp_sync": {
      // The settings card's "Run now": detect, write only what actually
      // changed, then follow the reload switch. Works while the schedule is off.
      const derpSync = context.get(derpSyncContext);
      await derpSync.runNow();
      invalidateDerpData();
      return success();
    }

    case "check_derp_sync": {
      // The settings card's "Check": the same two detections and the same
      // comparison, reported on the page and written nowhere.
      const derpSync = context.get(derpSyncContext);
      await derpSync.checkNow();
      return success();
    }

    case "save_host_echo": {
      // The external IPv6 echo is configuration for the sync above, so it is
      // edited here. It lives in Headplane's own data directory and never in
      // Headscale's configuration, which is why the sync can consume it without
      // writing anything into the configuration file.
      const enabled = readBooleanField(formData, "host_echo_enabled");
      if (enabled === undefined) {
        return failure("invalidBooleanValue");
      }

      const url = parseHostEchoUrl(formData.get("host_echo_url")?.toString() ?? "");
      if (url === undefined) {
        return failure("invalidHostEchoUrl");
      }

      const dataPath = context.get(appConfigContext)?.server.data_path;
      if (!dataPath) {
        return failure("hostEchoSaveFailed");
      }

      const written = await writeHostEchoSettings(dataPath, { enabled, url });
      if (!written) {
        return failure("hostEchoSaveFailed");
      }

      // The setting decides which endpoint is asked, so a cached answer from the
      // previous one must not survive the save.
      clearHostEchoCache();
      return success();
    }

    case "preset_embedded_derp": {
      // One-click preset for the embedded DERP server. The dialog prefills
      // every field from the current configuration, so the operator reviews
      // and can edit the values before this writes them in a single patch.
      const regionId = parseDerpRegionId(readField(formData, "derp_server_region_id"));
      if (regionId === undefined) {
        return failure("invalidDerpRegionId");
      }

      const regionCode = readField(formData, "derp_server_region_code");
      const regionName = readField(formData, "derp_server_region_name");
      if (regionCode.length === 0 || regionName.length === 0) {
        return failure("invalidDerpRegionCode");
      }

      const stunListenAddr = readField(formData, "derp_server_stun_listen_addr");
      if (!isDerpStunAddress(stunListenAddr)) {
        return failure("invalidDerpStunAddr");
      }

      // An empty key path falls back to Headscale's documented install layout:
      // the signing key sits next to Headscale's own config file.
      const appConfig = context.get(appConfigContext);
      const submittedKeyPath = readField(formData, "derp_server_private_key_path");
      const privateKeyPath =
        submittedKeyPath.length > 0
          ? submittedKeyPath
          : defaultDerpPrivateKeyPath(appConfig?.headscale.config_path);
      if (!isAbsoluteFilePath(privateKeyPath)) {
        return failure("invalidDerpPrivateKeyPath");
      }

      // The public addresses are optional here too; the dialog prefills them
      // from the current configuration, and clearing one deletes the key.
      const ipv4 = readField(formData, "derp_server_ipv4");
      if (!isDerpIpv4Address(ipv4)) {
        return failure("invalidDerpIpv4");
      }

      const ipv6 = readField(formData, "derp_server_ipv6");
      if (!isDerpIpv6Address(ipv6)) {
        return failure("invalidDerpIpv6");
      }

      // Enabling the server with `automatically_add_embedded_derp_region` off
      // requires a DERP map path, exactly like the manual save does.
      const { paths, server } = headscaleConfig.getDERPSettings();
      if (!server.automaticallyAddEmbeddedDerpRegion && paths.length === 0) {
        return failure("derpPathsRequired");
      }

      const patches: { path: string; value: unknown }[] = [
        { path: "derp.server.enabled", value: true },
        { path: "derp.server.region_id", value: regionId },
        { path: "derp.server.region_code", value: regionCode },
        { path: "derp.server.region_name", value: regionName },
        { path: "derp.server.stun_listen_addr", value: stunListenAddr },
        { path: "derp.server.ipv4", value: ipv4.length > 0 ? ipv4 : null },
        { path: "derp.server.ipv6", value: ipv6.length > 0 ? ipv6 : null },
        { path: "derp.server.private_key_path", value: privateKeyPath },
      ];

      // Optional: the operator asked for the embedded server to be the only
      // relay, so every map URL is dropped in this same save. Unticked (or a
      // request without the field) leaves derp.urls exactly as it is.
      if (readBooleanField(formData, "derp_clear_public_map") === true) {
        patches.push({ path: "derp.urls", value: [] });
      }

      await headscaleConfig.patch(patches);
      await refreshDerp("config", "preset_embedded_derp");
      return success();
    }

    case "add_derp_region_name": {
      const regionId = parseDerpRegionMapId(readField(formData, "derp_region_id"));
      if (regionId === undefined) {
        return failure("invalidDerpRegionMapId");
      }

      const regionName = readField(formData, "derp_region_name");
      if (regionName.length === 0) {
        return failure("invalidDerpRegionMapName");
      }

      const dataPath = context.get(appConfigContext)?.server.data_path;
      if (!dataPath) {
        return failure("derpRegionMapWriteFailed");
      }

      const names = await readDerpRegionNames(dataPath);
      const written = await writeDerpRegionNames(
        dataPath,
        setDerpRegionName(names, regionId, regionName),
      );
      if (!written) {
        return failure("derpRegionMapWriteFailed");
      }

      invalidateDerpData();
      return success();
    }

    case "remove_derp_region_name": {
      const regionId = parseDerpRegionMapId(readField(formData, "derp_region_id"));
      if (regionId === undefined) {
        return failure("invalidDerpRegionMapId");
      }

      const dataPath = context.get(appConfigContext)?.server.data_path;
      if (!dataPath) {
        return failure("derpRegionMapWriteFailed");
      }

      const names = await readDerpRegionNames(dataPath);
      if (!(String(regionId) in names)) {
        return failure("derpRegionMapNotFound");
      }

      const written = await writeDerpRegionNames(dataPath, removeDerpRegionName(names, regionId));
      if (!written) {
        return failure("derpRegionMapWriteFailed");
      }

      invalidateDerpData();
      return success();
    }

    case "add_mirror_region_names": {
      // One click from the region filter: every region the operator has ticked
      // is written into the manual name mapping under the number it is mirrored
      // as, because that is the id those regions carry once the mirrored map is
      // the one Headscale hands to clients. The card sends the Chinese names it
      // already shows, and the store only ever fills gaps, so an operator's own
      // name is never overwritten and a second click adds nothing.
      const dataPath = context.get(appConfigContext)?.server.data_path;
      if (!dataPath) {
        return failure("derpRegionMapWriteFailed");
      }

      const current = await readDerpRegionNames(dataPath);
      const merged = mergeMissingDerpRegionNames(current, readMirrorRegionNameEntries(formData));

      if (merged.added > 0) {
        // A mutation on this page takes the usual snapshot first (fail-soft),
        // then writes through the store's own API and records the change.
        await snapshotBeforeMutation(
          context.get(snapshotContext),
          DERP_REGION_NAMES_SNAPSHOT_REASON,
        );

        const written = await writeDerpRegionNames(dataPath, merged.names);
        if (!written) {
          return failure("derpRegionMapWriteFailed");
        }

        await recordMirrorRegionNames(context.get(auditContext), principal, dataPath, merged.added);
      }

      if (merged.added > 0) {
        invalidateDerpData();
      }

      return data({
        success: true,
        addedRegionNames: merged.added,
      } satisfies HeadscaleSettingsSuccess);
    }

    case "save_derp_mirror": {
      // The mirror's own settings live in Headplane's data directory; only the
      // map file a run writes lives where Headscale reads it. The stored
      // numbering is deliberately left alone: a save must not shuffle the
      // numbers clients already know, so re-ranking is its own action below.
      const enabled = readBooleanField(formData, "mirror_enabled");
      const autoReload = readBooleanField(formData, "mirror_auto_reload");
      if (enabled === undefined || autoReload === undefined) {
        return failure("invalidBooleanValue");
      }

      const intervalHours = parseDerpMirrorIntervalHours(
        readField(formData, "mirror_interval_hours"),
      );
      if (intervalHours === undefined) {
        return failure("invalidDerpMirrorInterval");
      }

      const officialRegionIds: string[] = [];
      let invalidSelection = false;
      for (const entry of formData.getAll("mirror_region")) {
        const id = normalizeOfficialRegionId(entry);
        if (id === undefined) {
          invalidSelection = true;
          break;
        }

        if (!officialRegionIds.includes(id)) {
          officialRegionIds.push(id);
        }
      }

      if (invalidSelection) {
        return failure("invalidDerpMirrorSelection");
      }

      // The run refuses a relative path or one with a `..` segment, so the same
      // check here turns it into a field error instead of a failed run.
      const targetPath = readField(formData, "mirror_path");
      if (mirrorTargetProblem(targetPath) !== undefined) {
        return failure("invalidDerpMirrorPath");
      }

      // The source URLs are tried in order, so their order is the submitted
      // order. A blank row is a leftover from "add source", not a source; any
      // other entry has to be an absolute http(s) URL the fetcher can dial.
      const sourceUrls: string[] = [];
      for (const entry of formData.getAll("mirror_source")) {
        const url = entry.toString().trim();
        if (url.length === 0) {
          continue;
        }

        if (!isAbsoluteHttpUrl(url)) {
          return failure("invalidDerpMirrorSource");
        }

        if (sourceUrls.includes(url)) {
          continue;
        }

        if (sourceUrls.length >= DERP_MIRROR_MAX_SOURCES) {
          return failure("tooManyDerpMirrorSources");
        }

        sourceUrls.push(url);
      }

      const mirror = context.get(derpMirrorContext);
      const result = await mirror.update({
        enabled,
        autoReload,
        intervalHours,
        targetPath,
        officialRegionIds,
        sourceUrls,
      });

      if (!result.success) {
        return failure("derpMirrorSaveFailed");
      }

      // A mirrored file nobody loads is useless, so enabling the filter also
      // makes sure Headscale's own `derp.paths` lists its target. Disabling it
      // deliberately leaves the list alone: dropping a valid entry would delete
      // configuration the operator may still be using.
      const pathReport = result.settings.enabled
        ? await ensureMirrorPath(
            context,
            principal,
            result.settings.targetPath,
            result.settings.autoReload,
          )
        : undefined;

      invalidateDerpData();

      return data({
        success: true,
        ...(pathReport === undefined ? {} : { mirrorPath: pathReport }),
      } satisfies HeadscaleSettingsSuccess);
    }

    case "check_derp_mirror": {
      // The tab's dry run: fetch, filter, generate and compare, and write
      // nothing at all — no snapshot, no reload, no change to the stored
      // numbering and no change to `derp.paths`. The run it returns is reported
      // where it was started.
      const mirror = context.get(derpMirrorContext);
      const run = await mirror.check();
      if (run === undefined) {
        return failure("derpMirrorCheckFailed");
      }

      return data({ success: true, mirror: run } satisfies HeadscaleSettingsSuccess);
    }

    case "run_derp_mirror": {
      // The tab's "Update now": the same work as a scheduled tick, writing only
      // what actually changed and then following the reload switch. Writing the
      // file is also the moment it becomes worth loading, so the path is made
      // sure of here too.
      const mirror = context.get(derpMirrorContext);
      const run = await mirror.runNow();
      if (run === undefined) {
        return failure("derpMirrorRunFailed");
      }

      const settings = mirrorPathTarget(mirror);
      const pathReport =
        settings === undefined
          ? undefined
          : await ensureMirrorPath(context, principal, settings.targetPath, settings.autoReload);

      invalidateDerpData();

      return data({
        success: true,
        mirror: run,
        ...(pathReport === undefined ? {} : { mirrorPath: pathReport }),
      } satisfies HeadscaleSettingsSuccess);
    }

    case "reassign_derp_mirror": {
      // The one action that drops the stored numbering and ranks every selected
      // region again by today's measurements, which is what the tab's preview
      // shows. Only reachable through the confirmation dialog, and it writes the
      // file, so it makes sure of the `derp.paths` entry like "Update now" does.
      const mirror = context.get(derpMirrorContext);
      const run = await mirror.reassign();
      if (run === undefined) {
        return failure("derpMirrorReassignFailed");
      }

      const settings = mirrorPathTarget(mirror);
      const pathReport =
        settings === undefined
          ? undefined
          : await ensureMirrorPath(context, principal, settings.targetPath, settings.autoReload);

      invalidateDerpData();

      return data({
        success: true,
        mirror: run,
        ...(pathReport === undefined ? {} : { mirrorPath: pathReport }),
      } satisfies HeadscaleSettingsSuccess);
    }

    case "save_derp_mirror_paste": {
      // The last resort for a network where no source URL can be reached: the
      // operator brings the official map's body in by hand. It is validated with
      // the reader a fetched body goes through and stored verbatim, so the run
      // that consumes it takes exactly the same generate, validate, snapshot and
      // write path as a downloaded one. Nothing is written to the map file here:
      // the next run is what writes it.
      const body = formData.get("mirror_paste")?.toString() ?? "";
      if (body.trim().length === 0) {
        return failure("emptyDerpMirrorPaste");
      }

      const read = parseDerpMapBody(body);
      if (read.regions === undefined) {
        return failure(
          read.reason === "too-large" ? "derpMirrorPasteTooLarge" : "derpMirrorPasteInvalid",
        );
      }

      const mirror = context.get(derpMirrorContext);
      const result = await mirror.update({
        pastedMap: {
          body,
          at: new Date().toISOString(),
          regions: read.regions.length,
        },
      });

      if (!result.success) {
        return failure("derpMirrorPasteSaveFailed");
      }

      invalidateDerpData();

      return data({
        success: true,
        ...(result.settings.pastedMap === undefined ? {} : { paste: result.settings.pastedMap }),
      } satisfies HeadscaleSettingsSuccess);
    }

    case "clear_derp_mirror_paste": {
      // Clearing puts the mirror back on its URL sources. The patch names only
      // this field, so every other setting keeps whatever the store holds,
      // whether or not the service has read it into memory yet.
      const mirror = context.get(derpMirrorContext);
      const result = await mirror.update({ pastedMap: undefined });
      if (!result.success || result.settings.pastedMap !== undefined) {
        return failure("derpMirrorPasteClearFailed");
      }

      invalidateDerpData();
      return success();
    }

    case "probe_derp_latency": {
      // The official regions are the one part of the map no client can report
      // on: a machine only knows the map Headscale handed it. Measuring them
      // from this server is what makes them rankable at all.
      //
      // The run belongs to the mirror service, not to this request. It starts in
      // the background and this answers at once, so no request ever waits for
      // the probes — dozens of nodes across two families, each waiting out its
      // timeout on a network that filters UDP, would outlast any reverse proxy
      // in front of Headplane and come back as the proxy's own error page. The
      // card follows the run by polling `derp_latency_probe_status`.
      const mirror = context.get(derpMirrorContext);
      const started = mirror.startLatencyProbe();
      if (!started.started) {
        return failure("derpMirrorProbeBusy");
      }

      return data({ success: true, probe: started.status } satisfies HeadscaleSettingsSuccess);
    }

    case "derp_latency_probe_status": {
      // A read of the in-flight run: counters and the regions measured so far.
      // It waits for nothing and dials nothing, so polling it every second
      // costs a few in-memory reads.
      const mirror = context.get(derpMirrorContext);
      return data({
        success: true,
        probe: mirror.latencyProbeStatus(),
      } satisfies HeadscaleSettingsSuccess);
    }

    case "cancel_derp_latency_probe": {
      // The run in progress closes its sockets and reports what it had; with no
      // run in progress there is nothing to cancel, which is not an error.
      const mirror = context.get(derpMirrorContext);
      mirror.cancelLatencyProbe();
      return data({
        success: true,
        probe: mirror.latencyProbeStatus(),
      } satisfies HeadscaleSettingsSuccess);
    }

    case "save_derp_map": {
      // A local DERP map file is content Headscale reads at startup, so the
      // server validates it the same way the editor does and refuses to write
      // anything else. The submitted path is only matched against `derp.paths`;
      // it can never name a file the operator did not configure.
      const appConfig = context.get(appConfigContext);
      const { paths } = headscaleConfig.getDERPSettings();
      const configPath = appConfig?.headscale.config_path;
      const result = await saveDerpMapFile({
        configuredPaths: paths,
        // Headscale resolves a relative derp.paths entry against its own config
        // file, and the guard has to compare the same resolved path.
        baseDir: configPath ? dirname(configPath) : undefined,
        requestedPath: readField(formData, "path"),
        content: formData.get("content")?.toString() ?? "",
        snapshots: context.get(snapshotContext),
      });

      if (!result.ok) {
        return failure(result.code, result.issues);
      }

      await refreshDerp("map-file", "save_derp_map");

      return data({
        success: true,
        snapshotId: result.snapshotId,
        snapshotTaken: result.snapshotId !== undefined,
      } satisfies HeadscaleSettingsSuccess);
    }

    case "restore_derp_map": {
      // Rolling back writes a file too, so it goes through the same guard and
      // the same atomic write; the snapshot it restores from was taken by
      // Headplane before the write that is being undone.
      const appConfig = context.get(appConfigContext);
      const { paths } = headscaleConfig.getDERPSettings();
      const configPath = appConfig?.headscale.config_path;
      const result = await restoreDerpMapFile({
        configuredPaths: paths,
        baseDir: configPath ? dirname(configPath) : undefined,
        requestedPath: readField(formData, "path"),
        snapshots: context.get(snapshotContext),
      });

      if (!result.ok) {
        return failure(result.code);
      }

      await refreshDerp("map-file", "restore_derp_map");

      return data({
        success: true,
        snapshotId: result.snapshotId,
      } satisfies HeadscaleSettingsSuccess);
    }

    default: {
      return failure("invalidAction");
    }
  }
}

/**
 * Makes sure Headscale loads the file the region filter writes.
 *
 * Saving the filter enabled, or running it again, appends the mirror's target
 * file to `derp.paths` when it is missing — never removing or reordering an
 * entry, never adding a second copy of one that is already there, and never
 * touching another `derp` key. The write takes the page's usual pre-mutation
 * snapshot and leaves an audit entry; a read-only configuration is a recorded
 * skip rather than an error, so the save it belongs to still succeeds and the
 * card can keep the manual instruction visible.
 *
 * It never throws: the automatic step rides on top of a change that already
 * succeeded, so anything unexpected — including a configuration surface that
 * cannot answer — is reported as a skip instead of failing that change.
 */
async function ensureMirrorPath(
  context: Route.ActionArgs["context"],
  principal: Principal,
  targetPath: string,
  autoReload: boolean,
): Promise<MirrorPathReport> {
  try {
    return await runMirrorPathStep(context, principal, targetPath, autoReload);
  } catch (error) {
    log.warn(
      "config",
      "Unable to check Headscale's derp.paths for the region mirror: %s",
      error instanceof Error ? error.message : String(error),
    );
    return { status: "skipped", path: targetPath, reason: "write-failed" };
  }
}

/** The body of {@link ensureMirrorPath}, which wraps it so nothing escapes. */
async function runMirrorPathStep(
  context: Route.ActionArgs["context"],
  principal: Principal,
  targetPath: string,
  autoReload: boolean,
): Promise<MirrorPathReport> {
  const appConfig = context.get(appConfigContext);
  const config = context.get(headscaleConfigContext);
  const configPath = appConfig?.headscale.config_path;

  // A configuration surface that cannot read or write `derp.paths` at all is
  // reported like any other skip, so the caller still answers normally.
  if (
    !config ||
    typeof config.getDERPSettings !== "function" ||
    typeof config.patch !== "function"
  ) {
    return { status: "skipped", path: targetPath, reason: "write-failed" };
  }

  let snapshotId: string | undefined;
  const outcome = await ensureMirrorPathInDerpPaths({
    config,
    targetPath,
    baseDir: configPath ? dirname(configPath) : undefined,
    beforeWrite: async () => {
      const snapshot = await snapshotBeforeMutation(
        context.get(snapshotContext),
        DERP_MIRROR_PATH_SNAPSHOT_REASON,
      );
      snapshotId = snapshot?.id;
    },
  });

  const report: MirrorPathReport = { ...outcome };
  if (snapshotId !== undefined) {
    report.snapshotId = snapshotId;
  }

  // A reload is only asked for once the target file exists: reloading
  // Headscale into a `derp.paths` entry that names a file nothing has written
  // yet would take the server down. Until then the first run writes the file
  // and its own reload switch picks the map up.
  if (outcome.status === "added" && outcome.fileExists) {
    report.reload = await reloadAfterMirrorPathAdded(context, autoReload);
  }

  // An entry that was already there changed nothing, so it is neither
  // snapshotted nor audited: a repeated save stays idempotent.
  if (outcome.status !== "present") {
    await recordMirrorPathChange(context, principal, report);
  }

  return report;
}

/**
 * The mirror's stored target and reload switch, read defensively: the run the
 * caller just performed is its own result, and a service that cannot answer
 * must not turn that result into an error.
 */
function mirrorPathTarget(
  mirror: DerpMirrorService,
): { targetPath: string; autoReload: boolean } | undefined {
  try {
    const settings = mirror.settings();
    return { targetPath: settings.targetPath, autoReload: settings.autoReload };
  } catch {
    return undefined;
  }
}

/** Follows the mirror's own reload switch after the path was added. */
async function reloadAfterMirrorPathAdded(
  context: Route.ActionArgs["context"],
  autoReload: boolean,
): Promise<DerpMirrorReload> {
  if (!autoReload) {
    return "manual";
  }

  // A new `derp.paths` entry is a configuration change: Headscale's updater
  // re-reads file contents, but the list of files it reads comes from its
  // startup snapshot. What this deployment can do about that is decided in one
  // place, so the native restart and the Docker restart follow the same rules
  // here as everywhere else.
  const result = await refreshDerpAfterWrite({
    headscale: context.get(headscaleContext),
    integration: context.get(integrationContext),
    changeKind: "config",
    reason: "derp_path_added",
    autoUpdateEnabled: context.get(headscaleConfigContext).getDERPSettings().autoUpdateEnabled,
  });

  switch (result.outcome) {
    case "triggered":
      return "triggered";
    case "failed":
      return "failed";
    case "not-needed":
    case "ticker":
      return "not-needed";
    default:
      return "manual";
  }
}

/**
 * Records what happened to Headscale's load list; the audit store swallows its
 * own failures, and a failure here must never fail the save it describes. The
 * region-mirror action code is reused: the audit page already filters by it,
 * and the detail says which half of the mirror changed.
 */
async function recordMirrorPathChange(
  context: Route.ActionArgs["context"],
  principal: Principal,
  report: MirrorPathReport,
): Promise<void> {
  try {
    await context.get(auditContext)?.record({
      ...auditActorOf(principal),
      action: AUDIT_ACTIONS.derpRegionMirror,
      target: report.path,
      detail:
        report.status === "added"
          ? `derp.paths: added ${report.path}`
          : `derp.paths: not added (${report.status === "skipped" ? report.reason : "unknown"})`,
      result: report.status === "added" ? "success" : "failure",
    });
  } catch {
    // The audit log must never fail the change it describes.
  }
}

function readField(formData: FormData, name: string): string {
  return formData.get(name)?.toString().trim() ?? "";
}

/**
 * The mirrored region names a submission asks for: the number a region is
 * mirrored as and the name the filter card shows for it, paired by position.
 * Unusable pairs are skipped one by one — a malformed entry must not cost the
 * rest of the batch, and the store refuses whatever survives validation anyway.
 */
function readMirrorRegionNameEntries(formData: FormData): DerpRegionNameEntry[] {
  const numbers = formData.getAll("mirror_region_number");
  const names = formData.getAll("mirror_region_name");
  const entries: DerpRegionNameEntry[] = [];

  for (let index = 0; index < Math.min(numbers.length, names.length); index += 1) {
    const regionId = parseDerpRegionMapId(numbers[index]?.toString() ?? "");
    const name = (names[index]?.toString() ?? "").trim();
    if (regionId === undefined || name.length === 0) {
      continue;
    }

    entries.push({ regionId, name });
  }

  return entries;
}

/** Records a bulk region-name insertion; a failure here never breaks the write. */
async function recordMirrorRegionNames(
  audit: AuditService | undefined,
  principal: Principal,
  target: string,
  added: number,
): Promise<void> {
  try {
    await audit?.record({
      ...auditActorOf(principal),
      action: AUDIT_ACTIONS.derpRegionMirror,
      target,
      detail: `${added} region name(s) added`,
      result: "success",
    });
  } catch {
    // The audit log must never fail the change it describes.
  }
}

/**
 * Switches submit an explicit "true"/"false" hidden field, so anything else is
 * a malformed request rather than a value to coerce.
 */
function readBooleanField(formData: FormData, name: string): boolean | undefined {
  const value = readField(formData, name);
  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return undefined;
}

function splitList(value: string): string[] {
  return [...new Set(value.split(/[\s,]+/).filter((entry) => entry.length > 0))];
}

function failure(errorCode: HeadscaleSettingsErrorCode, issues?: DerpMapIssue[]) {
  return data(
    { success: false, errorCode, ...(issues ? { issues } : {}) } satisfies HeadscaleSettingsFailure,
    { status: 400 },
  );
}

function success() {
  return data({ success: true } satisfies HeadscaleSettingsSuccess);
}
