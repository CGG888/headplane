import { access, constants, readFile } from "node:fs/promises";

import { type } from "arktype";
import { load } from "js-yaml";

import {
  normalizeLoginOidcSettings,
  sanitizeLoginOidcSettings,
  type LoginOidcSettings,
} from "~/routes/settings/login/login-oidc";
import { readLoginOidcSettings } from "~/server/headplane-store/login-oidc";
import log from "~/utils/log";

import {
  headplaneConfig,
  PartialHeadplaneConfig,
  partialHeadplaneConfig,
  pathSupportedKeys,
  type HeadplaneConfig,
} from "./config-schema";
import { warnAboutRiskyAuthConfig } from "./config-warnings";
import { ConfigError } from "./error";

/** Where the config file is read from; also the file never written by the UI. */
export function resolveConfigPath(configPathOverride?: string): string {
  return configPathOverride != null
    ? configPathOverride
    : process.env.HEADPLANE_CONFIG_PATH != null
      ? String(process.env.HEADPLANE_CONFIG_PATH)
      : "/etc/headplane/config.yaml";
}

/**
 * The three configuration layers, kept apart instead of merged, so callers can
 * say which one supplied a value. `saved` is what the operator stored on
 * /settings/login, which sits between the file and the environment.
 */
export interface ConfigLayers {
  configPath: string;
  dataPath: string;
  file: PartialHeadplaneConfig | undefined;
  env: PartialHeadplaneConfig | undefined;
  saved: LoginOidcSettings;
}

/**
 * Reads the config file, the environment overrides and the saved console-login
 * overrides. Errors from the file are propagated exactly as before; the saved
 * document itself never throws.
 *
 * @param configPathOverride Used for testing to override the config file path
 */
export async function loadConfigLayers(configPathOverride?: string): Promise<ConfigLayers> {
  const configPath = resolveConfigPath(configPathOverride);
  const file = await loadConfigFile(configPath);
  const env = await loadConfigEnv();

  // The data directory is never editable from the UI, so a preliminary merge of
  // the file and the environment is enough to locate the store.
  const preliminary = deepMerge(file, env);
  const dataPath = preliminary.server?.data_path ?? "/var/lib/headplane/";
  const saved = await readLoginOidcSettings(dataPath);

  return { configPath, dataPath, file, env, saved };
}

/**
 * Main entrypoint that attempts to load and merge configuration from a
 * YAML config file (if available), the console-login overrides saved from the
 * UI, and environment variables. The order is deliberate and documented:
 * environment variables override the saved values, which override the file.
 *
 * The function also supports loading secret values from file paths for
 * specific configuration keys (e.g., certificates, private keys) by checking
 * for corresponding `_path` suffixed environment variables or config file
 * entries.
 *
 * @param configPathOverride Used for testing to override the config file path
 * @returns @ref{HeadplaneConfig} The fully validated configuration
 * @throws {Error} If there are validation errors in the final configuration
 */
export async function loadConfig(configPathOverride?: string) {
  const layers = await loadConfigLayers(configPathOverride);

  const savedOverride = loginOidcOverride(layers.saved);
  const combinedConfig = deepMerge(layers.file, savedOverride, layers.env);

  // A saved value supersedes the config file's older indirection for the same
  // setting; keeping both would either be ignored or fail validation.
  supersedeLoginOidcKeys(combinedConfig, layers.saved, layers.env);

  await loadConfigKeyPaths(combinedConfig);

  const finalConfig = headplaneConfig(combinedConfig);
  if (finalConfig instanceof type.errors) {
    // A saved override must never be able to stop HeadplaneCN from starting:
    // if it is the reason the configuration is invalid, it is dropped with a
    // loud log and the file plus environment are used instead.
    const fallback = await loadConfigWithoutSaved(layers);
    if (fallback !== undefined) {
      log.error(
        "config",
        "Ignoring the console login settings saved on /settings/login because they are invalid: %s",
        finalConfig.map((e) => e.toString()).join("; "),
      );
      warnAboutRiskyAuthConfig(fallback);
      return fallback;
    }

    throw ConfigError.from("INVALID_REQUIRED_FIELDS", {
      messages: finalConfig.map((e) => e.toString()),
    });
  }

  warnAboutRiskyAuthConfig(finalConfig);
  return finalConfig;
}

/**
 * The `oidc:` block a saved document contributes, with any individually
 * invalid field dropped so a hand-edited document cannot fail the whole load.
 */
function loginOidcOverride(saved: LoginOidcSettings): PartialHeadplaneConfig | undefined {
  const settings = sanitizeLoginOidcSettings(normalizeLoginOidcSettings(saved));
  if (Object.keys(settings).length === 0) {
    return undefined;
  }

  return { oidc: settings } as unknown as PartialHeadplaneConfig;
}

/**
 * Removes the config-file keys a saved value makes obsolete:
 *
 * - a secret saved from the UI replaces `oidc.client_secret_path`, because
 *   having both is a hard startup error;
 * - a saved `logout_idp` replaces the legacy `oidc.use_end_session`, unless the
 *   environment sets the legacy flag, which always wins.
 */
function supersedeLoginOidcKeys(
  config: PartialHeadplaneConfig,
  saved: LoginOidcSettings,
  env: PartialHeadplaneConfig | undefined,
): void {
  const oidc = config.oidc as unknown as Record<string, unknown> | undefined;
  if (oidc === undefined || oidc === null) {
    return;
  }

  if (saved.client_secret !== undefined) {
    delete oidc.client_secret_path;
  }

  if (saved.logout_idp !== undefined && env?.oidc?.use_end_session === undefined) {
    delete oidc.use_end_session;
  }
}

/** The configuration with the saved layer left out, when that one validates. */
async function loadConfigWithoutSaved(layers: ConfigLayers): Promise<HeadplaneConfig | undefined> {
  if (Object.keys(layers.saved).length === 0) {
    return undefined;
  }

  try {
    const combined = deepMerge(layers.file, layers.env);
    await loadConfigKeyPaths(combined);
    const config = headplaneConfig(combined);
    return config instanceof type.errors ? undefined : config;
  } catch {
    return undefined;
  }
}

/**
 * Attempts to load configuration from a YAML file at the specified path.
 * If the file is not accessible, it returns undefined.
 *
 * @param path The file path to load the configuration from
 * @returns A partial configuration object or undefined
 * @throws {Error} If there are validation errors in the loaded configuration
 */
export async function loadConfigFile(path: string) {
  try {
    await access(path, constants.R_OK);
  } catch {
    log.info("config", "Could not access config file at path: %s", path);
    return;
  }

  const rawBuffer = await readFile(path, "utf8");
  const rawConfig = load(rawBuffer);
  const config = partialHeadplaneConfig(rawConfig);
  if (config instanceof type.errors) {
    throw ConfigError.from("INVALID_REQUIRED_FIELDS", {
      messages: config.map((e) => e.toString()),
    });
  }

  return config;
}

/**
 * Loads configuration overrides from environment variables prefixed with
 * `HEADPLANE_`. Nested configuration keys can be represented using double
 * underscores (`__`). For example, `HEADPLANE_SERVER__PORT=8080` would set
 * the `server.port` configuration key to `8080`.
 *
 * @returns A partial configuration object or undefined
 * @throws {Error} If there are validation errors in the loaded configuration
 */
export async function loadConfigEnv() {
  if (process.env.HEADPLANE_LOAD_ENV_OVERRIDES != null) {
    log.warn(
      "config",
      "HEADPLANE_LOAD_ENV_OVERRIDES is deprecated and will be removed in future versions",
    );
    log.warn(
      "config",
      "Environment variables are always loaded and `.env` files are no longer supported",
    );
  }

  const rawConfig: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value == null || !key.startsWith("HEADPLANE_")) {
      continue;
    }

    const parsedValue = parseEnvValue(value);
    const configKey = key.slice("HEADPLANE_".length).toLowerCase();
    deepSet(rawConfig, configKey.split("__"), parsedValue);
  }

  const config = partialHeadplaneConfig(rawConfig);
  if (config instanceof type.errors) {
    throw ConfigError.from("INVALID_REQUIRED_FIELDS", {
      messages: config.map((e) => e.toString()),
    });
  }

  return Object.keys(config).length > 0 ? config : undefined;
}

/**
 * Deeply merges multiple objects together. Later objects in the arguments
 * list will override properties of earlier objects.
 *
 * @param objects The objects to merge
 * @returns The merged object
 */
function deepMerge<T>(...objects: (T | undefined)[]): T {
  const result: { [key: string]: unknown } = {};
  for (const obj of objects.filter((o) => o != null)) {
    for (const [key, value] of Object.entries(
      obj as {
        [key: string]: unknown;
      },
    )) {
      if (value != null && typeof value === "object" && !Array.isArray(value)) {
        if (result[key] == null || typeof result[key] !== "object" || Array.isArray(result[key])) {
          result[key] = {};
        }
        result[key] = deepMerge(result[key], value);
      } else {
        result[key] = value;
      }
    }
  }

  return result as T;
}

/**
 * Sets a value deeply within an object based on the provided path.
 *
 * @param obj The object to set the value in
 * @param path An array of keys representing the path to set
 * @param value The value to set at the specified path
 */
function deepSet(obj: { [key: string]: unknown }, path: string[], value: unknown): void {
  let current = obj;
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i];
    if (current[key] == null || typeof current[key] !== "object") {
      current[key] = {};
    }

    current = current[key] as { [key: string]: unknown };
  }

  current[path[path.length - 1]] = value;
}

/**
 * Parses an environment variable string value into an appropriate type.
 * Supports booleans, null, undefined, and numbers. Falls back to string.
 *
 * @param value The environment variable string value
 * @returns The parsed value
 */
function parseEnvValue(value: string): unknown {
  const v = value.trim().toLowerCase();
  if (v === "true") return true;
  if (v === "false") return false;
  if (v === "null") return null;
  if (v === "undefined") return undefined;

  if (/^-?\d+(\.\d+)?$/.test(v)) {
    const num = Number(v);
    if (!Number.isNaN(num)) return num;
  }

  return value;
}

/**
 * For configuration keys that support loading from file paths (e.g.,
 * certificates, private keys), this function checks for corresponding
 * `_path` suffixed keys and loads the file content if the main key is
 * not already set.
 *
 * @param partial The partial configuration object to update
 */
export async function loadConfigKeyPaths(partial: PartialHeadplaneConfig) {
  for (const key of pathSupportedKeys) {
    const pathKey = `${key}_path`;
    const pathValue = deepGet(partial, pathKey.split("."));
    const existing = deepGet(partial, key.split("."));

    if (pathValue == null || typeof pathValue !== "string") {
      continue;
    }

    if (existing != null) {
      throw ConfigError.from("CONFLICTING_SECRET_PATH_FIELD", {
        fieldName: key,
      });
    }

    const realPath = pathValue.replace(/\$\{([^}]+)\}/g, (_, variableName) => {
      const value = process.env[variableName];
      if (value === undefined) {
        throw ConfigError.from("MISSING_INTERPOLATION_VARIABLE", {
          pathKey: `${key}_path`,
          variableName: variableName,
        });
      }

      return value;
    });

    try {
      const fileContent = await readFile(realPath, "utf8");
      deepSet(partial, key.split("."), fileContent.trim().normalize());
    } catch {
      throw ConfigError.from("MISSING_SECRET_FILE", {
        pathKey: `${key}_path`,
        filePath: realPath,
      });
    }
  }
}

/**
 * Deeply retrieves a value from an object based on the provided path.
 *
 * @param obj The object to retrieve the value from
 * @param path An array of keys representing the path to retrieve
 * @returns The value at the specified path or undefined if not found
 */
function deepGet(obj: { [key: string]: unknown }, path: string[]): unknown {
  let current = obj;
  for (const segment of path) {
    if (current == null || typeof current !== "object") {
      return undefined;
    }

    current = current[segment] as { [key: string]: unknown };
  }

  return current;
}
