/**
 * React Router aborts every "single fetch" action (any client-side form
 * submission) when the browser's `Origin` header does not match the origin it
 * derived for the request.
 *
 * A reverse proxy that terminates TLS and rewrites `Host` makes the app see an
 * internal address while the browser reports the public one, so Headplane would
 * reject every save with "Unexpected Server Error". The operator-declared
 * public URL (`server.base_url`) and any explicit
 * `server.allowed_action_origins` entries are added to React Router's allow
 * list so those deployments keep working. This stays a strict allow list: only
 * hosts named in the configuration are accepted, never wildcards or arbitrary
 * values from the request.
 */
export function allowedActionOrigins(
  existing: readonly string[] | undefined,
  ...candidates: (string | undefined | null)[]
): string[] {
  const origins = new Set((existing ?? []).filter((origin): origin is string => Boolean(origin)));

  for (const candidate of candidates) {
    const value = candidate?.trim();
    if (!value) {
      continue;
    }

    // Configuration usually holds a full URL (`https://host:port/admin`), but
    // a bare `host:port` (or one with a path) is accepted too. React Router
    // compares hosts, so only the host part is kept.
    origins.add(value.includes("://") ? hostOf(value) : value.split("/")[0]!);
  }

  return [...origins];
}

function hostOf(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return value.split("/")[0]!;
  }
}
