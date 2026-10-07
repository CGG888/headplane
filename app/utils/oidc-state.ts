import { createCookie } from "react-router";

import type { HeadplaneConfig } from "~/server/config/config-schema";

export interface OidcStateCookie {
  nonce: string;
  state: string;
  verifier: string;
  redirect_uri: string;
}

// The signed payload format. `v1` is written into every cookie this module
// emits, so a future change can be rolled out without guessing at the shape.
const STATE_VERSION = "v1";

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

// Returns `Uint8Array<ArrayBuffer>` rather than the wider `ArrayBufferLike`
// default so the result can be handed straight to `crypto.subtle.verify`.
function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function isOidcStateCookie(value: unknown): value is OidcStateCookie {
  if (value == null || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<Record<keyof OidcStateCookie, unknown>>;
  return (
    typeof candidate.nonce === "string" &&
    typeof candidate.state === "string" &&
    typeof candidate.verifier === "string" &&
    typeof candidate.redirect_uri === "string"
  );
}

export function createOidcStateCookie(config: HeadplaneConfig) {
  const cookie = createCookie("__oidc_state", {
    httpOnly: true,
    maxAge: 1800,
    secure: config.server.cookie_secure,
    domain: config.server.cookie_domain,
    path: `${__PREFIX__}/oidc/callback`,
  });

  // The cookie is scoped to the callback path and is only ever read there, but
  // it carries the PKCE verifier and the nonce: anything that can write cookies
  // for this origin (a sibling host on a shared parent domain, for example)
  // could otherwise pin both to attacker-known values. Signing with the same
  // secret the session cookie uses makes a forged state/verifier pair fail to
  // parse, which lands the user back on the login page instead of issuing a
  // session. Web Crypto keeps this module free of `node:*` imports.
  const secret = config.server.cookie_secret;

  async function importSigningKey(): Promise<CryptoKey | undefined> {
    if (typeof secret !== "string" || secret.length === 0) {
      return undefined;
    }

    return crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"],
    );
  }

  return {
    ...cookie,
    serialize: async (value: OidcStateCookie): Promise<string> => {
      const payload = toBase64Url(new TextEncoder().encode(JSON.stringify(value)));
      const key = await importSigningKey();
      if (!key) {
        return cookie.serialize(`${STATE_VERSION}.${payload}`);
      }

      const signature = new Uint8Array(
        await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload)),
      );

      return cookie.serialize(`${STATE_VERSION}.${payload}.${toBase64Url(signature)}`);
    },

    /**
     * The request that consumes this cookie is a redirect, so the state is
     * cleared with the same response that creates the session: a callback can
     * otherwise be replayed until the cookie's own max-age expires.
     */
    clear: async (): Promise<string> => {
      return cookie.serialize("", { expires: new Date(0), maxAge: 0 });
    },

    parse: async (cookieHeader: string | null): Promise<OidcStateCookie | null> => {
      const parsed = await cookie.parse(cookieHeader);
      if (typeof parsed !== "string") {
        return null;
      }

      const parts = parsed.split(".");
      const [version, payload, signature] = parts;
      if (version !== STATE_VERSION || !payload || parts.length > 3) {
        return null;
      }

      const key = await importSigningKey();
      if (signature && signature.length > 0) {
        if (!key) {
          return null;
        }

        const valid = await crypto.subtle.verify(
          "HMAC",
          key,
          fromBase64Url(signature),
          new TextEncoder().encode(payload),
        );

        if (!valid) {
          return null;
        }
      } else if (key) {
        // A secret is configured, so an unsigned cookie is stale (issued by an
        // older build) or forged. Either way it must not start a login.
        return null;
      }

      try {
        const decoded: unknown = JSON.parse(new TextDecoder().decode(fromBase64Url(payload)));
        return isOidcStateCookie(decoded) ? decoded : null;
      } catch {
        return null;
      }
    },
  };
}
