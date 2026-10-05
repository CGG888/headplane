import { dirname } from "node:path";

import { data } from "react-router";

import {
  appConfigContext,
  authContext,
  headscaleConfigContext,
  headscaleContext,
  integrationContext,
  snapshotContext,
} from "~/server/context";
import { restoreDerpMapFile, saveDerpMapFile } from "~/server/headscale/derp-map-files";
import {
  readDerpRegionNames,
  removeDerpRegionName,
  setDerpRegionName,
  writeDerpRegionNames,
} from "~/server/headscale/derp-region-names";
import { Capabilities } from "~/server/web/roles";

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
} from "./error-keys";
import { runOidcSelfTest } from "./oidc-self-test";
import { validateTrustedProxyCidr } from "./trusted-proxies";

const PKCE_METHODS = new Set(["plain", "S256"]);
const POLICY_MODES = new Set(["file", "database"]);

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

  // The self-test only reads the configuration and the identity provider, so it
  // stays available when Headscale's config file is mounted read-only.
  if (action !== "test_oidc" && !headscaleConfig.writable()) {
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

      await headscaleConfig.patch([{ path: "trusted_proxies", value: [...trustedProxies, proxy] }]);
      await integration?.onConfigChange(headscale);
      return success();
    }

    case "remove_trusted_proxy": {
      const proxy = readField(formData, "proxy");
      const { trustedProxies } = headscaleConfig.getTailnetSettings();
      if (!trustedProxies.includes(proxy)) {
        return failure("proxyNotFound");
      }

      await headscaleConfig.patch([
        {
          path: "trusted_proxies",
          value: trustedProxies.filter((entry) => entry !== proxy),
        },
      ]);
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

      await headscaleConfig.patch([{ path: "derp.urls", value: [...urls, url] }]);
      await integration?.onConfigChange(headscale);
      return success();
    }

    case "remove_derp_url": {
      const url = readField(formData, "url");
      const { urls } = headscaleConfig.getDERPSettings();
      if (!urls.includes(url)) {
        return failure("derpUrlNotFound");
      }

      await headscaleConfig.patch([
        { path: "derp.urls", value: urls.filter((entry) => entry !== url) },
      ]);
      await integration?.onConfigChange(headscale);
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

      await headscaleConfig.patch([{ path: "derp.paths", value: [...paths, path] }]);
      await integration?.onConfigChange(headscale);
      return success();
    }

    case "remove_derp_path": {
      const path = readField(formData, "path");
      const { paths } = headscaleConfig.getDERPSettings();
      if (!paths.includes(path)) {
        return failure("derpPathNotFound");
      }

      await headscaleConfig.patch([
        { path: "derp.paths", value: paths.filter((entry) => entry !== path) },
      ]);
      await integration?.onConfigChange(headscale);
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
      await integration?.onConfigChange(headscale);
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
      await integration?.onConfigChange(headscale);
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
      await integration?.onConfigChange(headscale);
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

      return success();
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

function readField(formData: FormData, name: string): string {
  return formData.get(name)?.toString().trim() ?? "";
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
