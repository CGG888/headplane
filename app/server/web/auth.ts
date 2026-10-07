import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { isIP } from "node:net";

import { and, eq, lt, sql } from "drizzle-orm";
import { NodeSQLiteDatabase } from "drizzle-orm/node-sqlite";
import { createCookie, redirect } from "react-router";
import { ulid } from "ulidx";

import type { Machine } from "~/types";
import log from "~/utils/log";

import { type HeadplaneUser, authSessions, users } from "../db/schema";
import {
  Capabilities,
  type Role,
  Roles,
  capsForRole,
  isAssignableRole,
  normalizeRole,
} from "./roles";

/**
 * Raised when a request simply carries no usable session — a missing, malformed or
 * expired cookie, or a session row that is gone. `require` turns this into a
 * redirect to the login page, while every other failure keeps propagating as a 500
 * so that a database or Headscale outage is not reported as "please sign in".
 */
class UnauthenticatedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnauthenticatedError";
  }
}

export type Principal =
  | {
      kind: "api_key";
      sessionId: string;
      displayName: string;
      apiKey: string;
    }
  | UserPrincipal;

export type UserPrincipal = {
  kind: "oidc" | "proxy";
  sessionId: string;
  idToken?: string;
  user: {
    id: string;
    subject: string;
    role: Role;
    headscaleUserId: string | undefined;
  };
  profile: {
    name: string;
    email?: string;
    username?: string;
    picture?: string;
  };
};

interface ProxyAuthOptions {
  enabled: boolean;
  allowedCidrs?: string[];
  trustedProxyCidrs?: string[];
  ipHeader?: string;
  userHeader?: string;
  emailHeader?: string;
  nameHeader?: string;
  pictureHeader?: string;
}

interface CookiePayload {
  sid: string;
  api_key?: string;
  profile?: {
    name: string;
    email?: string;
    username?: string;
  };
}

export interface AuthServiceOptions {
  secret: string;
  headscaleApiKey?: string;
  proxyAuth?: ProxyAuthOptions;
  db: NodeSQLiteDatabase;
  cookie: {
    name: string;
    secure: boolean;
    maxAge: number;
    domain?: string;
  };
}

export interface AuthService {
  registerRequestClientAddress(request: Request, address: string | undefined): void;
  /** The verified client address, honouring a trusted reverse proxy. */
  getClientAddress(request: Request): string | undefined;
  require(request: Request): Promise<Principal>;
  can(principal: Principal, capabilities: Capabilities): boolean;
  canManageNode(principal: Principal, node: Machine): boolean;
  getHeadscaleApiKey(principal: Principal): string;
  createOidcSession(
    userId: string,
    profile: NonNullable<CookiePayload["profile"]>,
    options?: { idToken?: string; maxAgeMs?: number },
  ): Promise<string>;

  createApiKeySession(apiKey: string, displayName: string, maxAgeMs: number): Promise<string>;
  destroySession(request?: Request): Promise<string>;
  findOrCreateUser(
    subject: string,
    profile?: { name?: string; email?: string; picture?: string },
    options?: { initialRole?: string; syncRole?: string },
  ): Promise<string>;

  linkHeadscaleUser(userId: string, headscaleUserId: string): Promise<boolean>;
  unlinkHeadscaleUser(userId: string): Promise<void>;
  listUsers(): Promise<HeadplaneUser[]>;
  claimedHeadscaleUserIds(): Promise<Set<string>>;
  roleForSubject(subject: string): Promise<Role | undefined>;
  roleForHeadscaleUser(headscaleUserId: string): Promise<Role | undefined>;
  transferOwnership(currentOwnerUserId: string, newOwnerUserId: string): Promise<boolean>;
  reassignUser(userId: string, role: Role): Promise<boolean>;
  pruneExpiredSessions(): Promise<void>;
  start(): void;
  stop(): void;
}

export function isUserPrincipal(principal: Principal): principal is UserPrincipal {
  return principal.kind === "oidc" || principal.kind === "proxy";
}

interface CidrRange {
  family: 4 | 6;
  base: bigint;
  mask: bigint;
}

const DEFAULT_PROXY_AUTH_CIDRS = ["127.0.0.1/32", "::1/128"];
const DEFAULT_PROXY_AUTH_USER_HEADER = "Remote-User";

function normalizeIpAddress(address: string): string {
  if (address.startsWith("::ffff:")) {
    const mapped = address.slice("::ffff:".length);
    if (isIP(mapped) === 4) {
      return mapped;
    }
  }

  return address;
}

function parseIpv4(address: string): bigint | undefined {
  const parts = address.split(".");
  if (parts.length !== 4) {
    return;
  }

  let value = 0n;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) {
      return;
    }

    const byte = Number(part);
    if (byte < 0 || byte > 255) {
      return;
    }

    value = (value << 8n) + BigInt(byte);
  }

  return value;
}

function parseIpv6(address: string): bigint | undefined {
  const sections = address.split("::");
  if (sections.length > 2) {
    return;
  }

  const head = sections[0] ? sections[0].split(":") : [];
  const tail = sections.length === 2 && sections[1] ? sections[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (missing < 0 || (sections.length === 1 && missing !== 0)) {
    return;
  }

  const groups = [...head, ...Array<string>(missing).fill("0"), ...tail];
  if (groups.length !== 8) {
    return;
  }

  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) {
      return;
    }

    value = (value << 16n) + BigInt(parseInt(group, 16));
  }

  return value;
}

function parseIpAddress(address: string): { family: 4 | 6; value: bigint } | undefined {
  const normalized = normalizeIpAddress(address);
  const family = isIP(normalized);
  if (family === 4) {
    const value = parseIpv4(normalized);
    return value === undefined ? undefined : { family, value };
  }
  if (family === 6) {
    const value = parseIpv6(normalized);
    return value === undefined ? undefined : { family, value };
  }

  return;
}

function parseCidr(cidr: string): CidrRange {
  const parts = cidr.trim().split("/");
  if (parts.length > 2) {
    throw new Error(`Invalid proxy auth CIDR: ${cidr}`);
  }

  const [rawAddress, rawPrefix] = parts;
  const address = parseIpAddress(rawAddress);
  if (!address) {
    throw new Error(`Invalid proxy auth CIDR address: ${cidr}`);
  }

  const maxBits = address.family === 4 ? 32 : 128;
  const prefix = rawPrefix === undefined ? maxBits : Number(rawPrefix);
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > maxBits) {
    throw new Error(`Invalid proxy auth CIDR prefix: ${cidr}`);
  }

  const bits = BigInt(maxBits);
  const hostBits = BigInt(maxBits - prefix);
  const allOnes = (1n << bits) - 1n;
  const mask = prefix === 0 ? 0n : (allOnes << hostBits) & allOnes;

  return {
    family: address.family,
    base: address.value & mask,
    mask,
  };
}

function cidrContains(range: CidrRange, address: string): boolean {
  const parsed = parseIpAddress(address);
  if (!parsed || parsed.family !== range.family) {
    return false;
  }

  return (parsed.value & range.mask) === range.base;
}

export function createAuthService(opts: AuthServiceOptions): AuthService {
  const requestCache = new WeakMap<Request, Promise<Principal>>();
  const clientAddresses = new WeakMap<Request, string>();
  const proxyAuthCidrs = opts.proxyAuth?.enabled
    ? (opts.proxyAuth.allowedCidrs?.length
        ? opts.proxyAuth.allowedCidrs
        : DEFAULT_PROXY_AUTH_CIDRS
      ).map(parseCidr)
    : [];
  const trustedProxyCidrs = opts.proxyAuth?.enabled
    ? (opts.proxyAuth.trustedProxyCidrs?.length
        ? opts.proxyAuth.trustedProxyCidrs
        : DEFAULT_PROXY_AUTH_CIDRS
      ).map(parseCidr)
    : [];
  let pruneTimer: ReturnType<typeof setInterval> | undefined;

  // The cookie payload can carry a Headscale API key, so it is encrypted with a
  // key derived from the configured secret (see encodeCookie/decodeCookie).
  const cookieKey = createHash("sha256").update(`headplane-cookie:${opts.secret}`).digest();

  async function encodeCookie(payload: CookiePayload, maxAge: number): Promise<string> {
    const cookie = createCookie(opts.cookie.name, {
      ...opts.cookie,
      httpOnly: true,
      path: __PREFIX__,
      maxAge,
    });

    // An API key session carries the Headscale API key in this payload, so it is
    // encrypted rather than only signed: a signed cookie stays readable to anyone
    // who can see it (browser storage, a proxy or a backup that records cookies)
    // while the credential is only ever needed by this server. AES-256-GCM also
    // authenticates the payload, so the previous HMAC is no longer needed.
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", cookieKey, iv);
    const ciphertext = Buffer.concat([
      cipher.update(Buffer.from(JSON.stringify(payload)), "utf8"),
      cipher.final(),
    ]);

    const value = [
      "v2",
      iv.toString("base64url"),
      ciphertext.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
    ].join(".");

    return cookie.serialize(value);
  }

  async function decodeCookie(request: Request): Promise<CookiePayload> {
    const cookieHeader = request.headers.get("cookie");
    if (!cookieHeader) {
      throw new UnauthenticatedError("No session cookie found");
    }

    const cookie = createCookie(opts.cookie.name, {
      ...opts.cookie,
      httpOnly: true,
      path: __PREFIX__,
    });

    const raw = (await cookie.parse(cookieHeader)) as string | null;
    if (!raw) {
      throw new UnauthenticatedError("Session cookie is empty");
    }

    // Cookies issued before the encrypted format are rejected outright rather
    // than parsed in cleartext: those sessions are simply gone and the user signs
    // in again.
    const [version, ivPart, ciphertextPart, tagPart] = raw.split(".");
    if (version !== "v2" || !ivPart || !ciphertextPart || !tagPart) {
      throw new UnauthenticatedError("Malformed session cookie");
    }

    let plaintext: Buffer;
    try {
      const decipher = createDecipheriv("aes-256-gcm", cookieKey, Buffer.from(ivPart, "base64url"));

      decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
      plaintext = Buffer.concat([
        decipher.update(Buffer.from(ciphertextPart, "base64url")),
        decipher.final(),
      ]);
    } catch {
      throw new UnauthenticatedError("Invalid session cookie");
    }

    return JSON.parse(plaintext.toString("utf-8")) as CookiePayload;
  }

  function hashApiKey(key: string): string {
    return createHash("sha256").update(key).digest("hex");
  }

  /**
   * Compares the credential carried in the cookie against the hash stored with
   * the session row. The row is what makes an API key session revocable:
   * deleting the row, or clearing the hash on it, takes the session out of
   * service on the next request instead of trusting the cookie on its own.
   */
  function apiKeyMatches(storedHash: string | null, apiKey: string): boolean {
    if (!storedHash) {
      return false;
    }

    const expected = Buffer.from(storedHash, "utf8");
    const actual = Buffer.from(hashApiKey(apiKey), "utf8");
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  }

  function registerRequestClientAddress(request: Request, address: string | undefined): void {
    if (address) {
      clientAddresses.set(request, address);
    }
  }

  function getForwardedClientAddress(request: Request, directAddress: string): string | undefined {
    const headerName = opts.proxyAuth?.ipHeader;
    if (!headerName) {
      return;
    }

    const value = request.headers.get(headerName)?.trim();
    if (!value) {
      return;
    }

    // Every hop appends to the forwarded header, so the leftmost entry is
    // whatever the client sent and can be spoofed freely. Walk from the
    // rightmost entry leftwards and stop at the first address we cannot vouch
    // for: that is the closest hop that is not one of our proxies. If every
    // entry is a trusted proxy (a local single-host setup where the client is
    // the proxy itself, for example), fall back to the socket peer we verified
    // in getProxyAuthClientAddress.
    const entries = value
      .split(",")
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);

    let sawAddress = false;
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      if (!parseIpAddress(entry)) {
        continue;
      }

      sawAddress = true;
      if (trustedProxyCidrs.some((cidr) => cidrContains(cidr, entry))) {
        continue;
      }

      return entry;
    }

    return sawAddress ? directAddress : undefined;
  }

  function getProxyAuthClientAddress(request: Request): string | undefined {
    const directAddress = clientAddresses.get(request);
    if (!directAddress) {
      return;
    }

    if (!opts.proxyAuth?.ipHeader) {
      return directAddress;
    }

    const directPeerTrusted = trustedProxyCidrs.some((cidr) => cidrContains(cidr, directAddress));
    if (!directPeerTrusted) {
      return;
    }

    return getForwardedClientAddress(request, directAddress);
  }

  async function resolveUserPrincipal(options: {
    kind: UserPrincipal["kind"];
    sessionId: string;
    userId: string;
    idToken?: string;
    profile?: {
      name?: string;
      email?: string;
      username?: string;
    };
  }): Promise<UserPrincipal> {
    const [user] = await opts.db.select().from(users).where(eq(users.id, options.userId)).limit(1);

    if (!user) {
      throw new Error("User record not found");
    }

    const role = normalizeRole(user.role);
    return {
      kind: options.kind,
      sessionId: options.sessionId,
      idToken: options.idToken,
      user: {
        id: user.id,
        subject: user.sub,
        role,
        headscaleUserId: user.headscale_user_id ?? undefined,
      },
      profile: {
        name: options.profile?.name ?? user.name ?? user.sub,
        email: options.profile?.email ?? user.email ?? undefined,
        username: options.profile?.username,
        picture: user.picture ?? undefined,
      },
    };
  }

  async function resolveProxyAuthPrincipal(request: Request): Promise<Principal | undefined> {
    if (!opts.proxyAuth?.enabled) {
      return;
    }
    if (!opts.headscaleApiKey) {
      throw new Error("Proxy authentication requires headscale.api_key to be configured");
    }

    const clientAddress = getProxyAuthClientAddress(request);
    if (!clientAddress || !proxyAuthCidrs.some((cidr) => cidrContains(cidr, clientAddress))) {
      return;
    }

    const userHeader = opts.proxyAuth.userHeader ?? DEFAULT_PROXY_AUTH_USER_HEADER;
    const proxyUser = request.headers.get(userHeader)?.trim();
    if (!proxyUser) {
      return;
    }

    const email = opts.proxyAuth.emailHeader
      ? request.headers.get(opts.proxyAuth.emailHeader)?.trim()
      : undefined;
    const name = opts.proxyAuth.nameHeader
      ? request.headers.get(opts.proxyAuth.nameHeader)?.trim()
      : undefined;
    const picture = opts.proxyAuth.pictureHeader
      ? request.headers.get(opts.proxyAuth.pictureHeader)?.trim()
      : undefined;
    const subject = `proxy:${proxyUser}`;
    const userId = await findOrCreateUser(subject, {
      name: name || proxyUser,
      email: email || undefined,
      picture: picture || undefined,
    });

    return resolveUserPrincipal({
      kind: "proxy",
      sessionId: "proxy-auth",
      userId,
      profile: {
        name: name || proxyUser,
        email: email || undefined,
        username: proxyUser,
      },
    });
  }

  async function resolve(request: Request): Promise<Principal> {
    const proxyPrincipal = await resolveProxyAuthPrincipal(request);
    if (proxyPrincipal) {
      return proxyPrincipal;
    }

    const payload = await decodeCookie(request);

    const [session] = await opts.db
      .select()
      .from(authSessions)
      .where(eq(authSessions.id, payload.sid))
      .limit(1);

    if (!session) {
      throw new UnauthenticatedError("Session not found");
    }

    if (session.expires_at < new Date()) {
      await opts.db.delete(authSessions).where(eq(authSessions.id, session.id));
      throw new UnauthenticatedError("Session expired");
    }

    if (session.kind === "api_key") {
      if (!payload.api_key) {
        throw new UnauthenticatedError("API key session missing credential");
      }

      if (!apiKeyMatches(session.api_key_hash, payload.api_key)) {
        // The stored hash no longer matches the credential in the cookie, which
        // means the session was revoked (its row cleared or re-issued): drop the
        // row and treat the cookie as dead rather than trusting it alone.
        await opts.db.delete(authSessions).where(eq(authSessions.id, session.id));
        throw new UnauthenticatedError("API key session revoked");
      }

      return {
        kind: "api_key",
        sessionId: session.id,
        displayName: session.api_key_display ?? "API Key",
        apiKey: payload.api_key,
      };
    }

    if (!session.user_id) {
      throw new UnauthenticatedError("OIDC session missing user_id");
    }

    return resolveUserPrincipal({
      kind: "oidc",
      sessionId: session.id,
      idToken: session.oidc_id_token ?? undefined,
      userId: session.user_id,
      profile: {
        name: payload.profile?.name,
        email: payload.profile?.email,
        username: payload.profile?.username,
      },
    });
  }

  /**
   * Resolves the request principal, redirecting to the login page when the request
   * has no session at all. Routes outside the layout call this directly, and the
   * bare `Error` it used to throw surfaced there as a 500 page with no way forward;
   * a redirect is the answer the user can act on. Failures that are not about the
   * session (a database error, a misconfigured `proxy_auth`) still propagate.
   */
  async function require(request: Request): Promise<Principal> {
    const cached = requestCache.get(request);
    if (cached) {
      return cached;
    }

    const promise = resolve(request).catch((error: unknown) => {
      if (error instanceof UnauthenticatedError) {
        log.debug(
          "auth",
          "No session on %s, redirecting to the login page",
          new URL(request.url).pathname,
        );
        throw redirect("/login");
      }

      throw error;
    });

    requestCache.set(request, promise);
    return promise;
  }

  function can(principal: Principal, capabilities: Capabilities): boolean {
    if (principal.kind === "api_key") {
      // Deliberate: Headscale has no scopes or roles for API keys, so a valid
      // key is admin level for everything the API allows (see
      // docs/en/features/api-keys.md). The key's own expiry bounds the session.
      return true;
    }

    const roleCaps = Roles[principal.user.role];
    return (capabilities & roleCaps) === capabilities;
  }

  function canManageNode(principal: Principal, node: Machine): boolean {
    if (principal.kind === "api_key") {
      return true;
    }

    const caps = Roles[principal.user.role];
    if ((caps & Capabilities.write_machines) !== 0) {
      return true;
    }

    const hsUserId = principal.user.headscaleUserId;
    return hsUserId !== undefined && node.user?.id === hsUserId;
  }

  function getHeadscaleApiKey(principal: Principal): string {
    if (principal.kind === "api_key") {
      return principal.apiKey;
    }

    if (!opts.headscaleApiKey) {
      throw new Error("User sessions require headscale.api_key to be configured");
    }

    return opts.headscaleApiKey;
  }

  async function createOidcSession(
    userId: string,
    profile: NonNullable<CookiePayload["profile"]>,
    options?: { idToken?: string; maxAgeMs?: number },
  ): Promise<string> {
    // Both session kinds take their lifetime in milliseconds and only convert to
    // the seconds `createCookie` wants at the cookie: the two used different
    // units before, so handing a millisecond value to the seconds parameter
    // silently produced a session valid for tens of thousands of years instead
    // of failing loudly.
    const maxAgeMs = options?.maxAgeMs ?? opts.cookie.maxAge * 1000;
    const sid = ulid();
    await opts.db.insert(authSessions).values({
      id: sid,
      kind: "oidc",
      user_id: userId,
      oidc_id_token: options?.idToken,
      expires_at: new Date(Date.now() + maxAgeMs),
    });

    return encodeCookie({ sid, profile }, Math.floor(maxAgeMs / 1000));
  }

  async function createApiKeySession(
    apiKey: string,
    displayName: string,
    maxAgeMs: number,
  ): Promise<string> {
    const sid = ulid();
    await opts.db.insert(authSessions).values({
      id: sid,
      kind: "api_key",
      api_key_hash: hashApiKey(apiKey),
      api_key_display: displayName,
      expires_at: new Date(Date.now() + maxAgeMs),
    });

    return encodeCookie({ sid, api_key: apiKey }, Math.floor(maxAgeMs / 1000));
  }

  async function destroySession(request?: Request): Promise<string> {
    if (request) {
      try {
        const payload = await decodeCookie(request);
        await opts.db.delete(authSessions).where(eq(authSessions.id, payload.sid));
      } catch {
        // Cookie already invalid, just clear it
      }
    }

    const cookie = createCookie(opts.cookie.name, {
      ...opts.cookie,
      httpOnly: true,
      path: __PREFIX__,
    });

    return cookie.serialize("", { expires: new Date(0) });
  }

  async function findOrCreateUser(
    subject: string,
    profile?: { name?: string; email?: string; picture?: string },
    options?: { initialRole?: string; syncRole?: string },
  ): Promise<string> {
    const [existing] = await opts.db.select().from(users).where(eq(users.sub, subject)).limit(1);

    if (existing) {
      const syncedRole = normalizeInitialRole(options?.syncRole);
      await opts.db
        .update(users)
        .set({
          name: profile?.name,
          email: profile?.email,
          picture: profile?.picture,
          ...(syncedRole && existing.role !== "owner"
            ? { role: syncedRole, caps: capsForRole(syncedRole) }
            : {}),
          last_login_at: new Date(),
          updated_at: new Date(),
        })
        .where(eq(users.id, existing.id));
      return existing.id;
    }

    const initialRole = normalizeInitialRole(options?.initialRole) ?? "member";
    const id = ulid();
    await opts.db.insert(users).values({
      id,
      sub: subject,
      name: profile?.name,
      email: profile?.email,
      picture: profile?.picture,
      role: initialRole,
      caps: capsForRole(initialRole),
    });

    // The first account to ever log in becomes the owner. Counting first and
    // updating second left a window where two concurrent first logins each saw
    // `count === 1` and were both promoted — and `owner` can neither be demoted
    // nor re-synced from the IdP. One conditional UPDATE evaluates the count and
    // the promotion together, so only a genuinely single-row table is promoted.
    await opts.db
      .update(users)
      .set({ role: "owner", caps: capsForRole("owner") })
      .where(and(eq(users.id, id), sql`(select count(*) from ${users}) = 1`));

    return id;
  }

  function normalizeInitialRole(role: string | undefined): Exclude<Role, "owner"> | undefined {
    // `isAssignableRole` lists the known roles explicitly rather than walking the
    // prototype chain (so `"toString"` or `"constructor"` cannot pass as a role
    // name) and never accepts `owner`, which only the promotion below hands out.
    return role !== undefined && isAssignableRole(role) ? role : undefined;
  }

  async function linkHeadscaleUser(userId: string, headscaleUserId: string): Promise<boolean> {
    const [existing] = await opts.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.headscale_user_id, headscaleUserId))
      .limit(1);

    if (existing && existing.id !== userId) {
      return false;
    }

    await opts.db
      .update(users)
      .set({ headscale_user_id: headscaleUserId, updated_at: new Date() })
      .where(eq(users.id, userId));

    return true;
  }

  async function unlinkHeadscaleUser(userId: string): Promise<void> {
    await opts.db
      .update(users)
      .set({ headscale_user_id: null, updated_at: new Date() })
      .where(eq(users.id, userId));
  }

  async function listUsers(): Promise<HeadplaneUser[]> {
    return opts.db.select().from(users);
  }

  async function claimedHeadscaleUserIds(): Promise<Set<string>> {
    const rows = await opts.db.select({ hsId: users.headscale_user_id }).from(users);

    const ids = new Set<string>();
    for (const row of rows) {
      if (row.hsId) {
        ids.add(row.hsId);
      }
    }
    return ids;
  }

  async function roleForSubject(subject: string): Promise<Role | undefined> {
    const [user] = await opts.db.select().from(users).where(eq(users.sub, subject)).limit(1);

    if (!user) {
      return;
    }

    return normalizeRole(user.role);
  }

  async function roleForHeadscaleUser(headscaleUserId: string): Promise<Role | undefined> {
    const [user] = await opts.db
      .select()
      .from(users)
      .where(eq(users.headscale_user_id, headscaleUserId))
      .limit(1);

    if (!user) {
      return;
    }

    return normalizeRole(user.role);
  }

  async function transferOwnership(
    currentOwnerUserId: string,
    newOwnerUserId: string,
  ): Promise<boolean> {
    if (currentOwnerUserId === newOwnerUserId) {
      return false;
    }

    const [current] = await opts.db
      .select()
      .from(users)
      .where(eq(users.id, currentOwnerUserId))
      .limit(1);

    if (!current || current.role !== "owner") {
      return false;
    }

    const [target] = await opts.db
      .select()
      .from(users)
      .where(eq(users.id, newOwnerUserId))
      .limit(1);

    if (!target) {
      return false;
    }

    // Demote and promote inside one transaction. Two separate statements left a
    // window where the table had no owner at all, and a crash between them made
    // that permanent: `owner` is the only role that can hand ownership on, so
    // nobody could have repaired it from the UI afterwards.
    opts.db.transaction((tx) => {
      tx.update(users)
        .set({ role: "admin", caps: capsForRole("admin"), updated_at: new Date() })
        .where(eq(users.id, current.id))
        .run();

      tx.update(users)
        .set({ role: "owner", caps: capsForRole("owner"), updated_at: new Date() })
        .where(eq(users.id, target.id))
        .run();
    });

    return true;
  }

  async function reassignUser(userId: string, role: Role): Promise<boolean> {
    // The role arrives from form data, so it is validated here too: only a real
    // role other than `owner` may be assigned. Without this, prototype keys
    // ("toString", "constructor", …) would reach the database, and any
    // `write_users` holder could promote themselves to `owner` — a role that
    // cannot be demoted afterwards and permanently detaches the account from IdP
    // role sync.
    if (!isAssignableRole(role)) {
      return false;
    }

    const [user] = await opts.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user || user.role === "owner") {
      return false;
    }

    await opts.db
      .update(users)
      .set({ role, caps: capsForRole(role), updated_at: new Date() })
      .where(eq(users.id, userId));

    return true;
  }

  async function pruneExpiredSessions(): Promise<void> {
    await opts.db.delete(authSessions).where(lt(authSessions.expires_at, new Date()));
  }

  function start(): void {
    pruneTimer = setInterval(() => void pruneExpiredSessions(), 15 * 60 * 1000);

    // Session pruning is housekeeping, so the timer must not be what keeps the
    // process alive: without this a short-lived run that built the auth service
    // would sit idle until the first tick. `stop()` (wired into the shutdown
    // disposer in `app/server/context.ts`) still clears it.
    pruneTimer.unref();
  }

  function stop(): void {
    if (pruneTimer) {
      clearInterval(pruneTimer);
      pruneTimer = undefined;
    }
  }

  return {
    registerRequestClientAddress,
    getClientAddress: getProxyAuthClientAddress,
    require: require,
    can,
    canManageNode,
    getHeadscaleApiKey,
    createOidcSession,
    createApiKeySession,
    destroySession,
    findOrCreateUser,
    linkHeadscaleUser,
    unlinkHeadscaleUser,
    listUsers,
    claimedHeadscaleUserIds,
    roleForSubject,
    roleForHeadscaleUser,
    transferOwnership,
    reassignUser,
    pruneExpiredSessions,
    start,
    stop,
  };
}
