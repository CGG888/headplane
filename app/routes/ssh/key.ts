import { data } from "react-router";

import { agentsContext, authContext, requestApiContext } from "~/server/context";
import { findHeadscaleUserBySubject } from "~/server/web/headscale-identity";

import type { Route } from "./+types/key";
import { sshError } from "./errors";

/**
 * How long a console session's pre-auth key stays usable. The key is revoked
 * as soon as the console closes, so this is the fallback window for a browser
 * that disappears without running the revoke request.
 */
const SSH_PREAUTH_KEY_TTL_MS = 10 * 60 * 1000;

export interface ConsoleKeyPayload {
  key: string;
  id: string | null;
  ephemeralHostname: string;
}

function generateHostname(username: string) {
  const hex = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  return `ssh-${hex}-${username}`;
}

/**
 * Mints (and revokes) the pre-auth key a browser SSH session needs.
 *
 * This runs as an action rather than in the page loader: a key returned from
 * the loader is serialized into the server-rendered document, where it can
 * survive in caches, logs and browser history. Minting on demand keeps it out
 * of the HTML, and the matching `revoke` intent expires it when the console
 * closes instead of leaving it valid until its TTL runs out.
 */
export async function action({ request, params, context }: Route.ActionArgs) {
  const agents = context.get(agentsContext);
  if (agents.state !== "enabled") {
    return data(sshError("agentRequired"), { status: 400 });
  }

  const { principal, api } = await context.get(requestApiContext)(request);
  if (principal.kind === "api_key") {
    return data(sshError("oidcRequired"), { status: 403 });
  }

  const auth = context.get(authContext);
  const hostname = params.id;
  const nodes = await api.nodes.list();
  const node = nodes.find((candidate) => candidate.givenName === hostname);
  if (!node) {
    return data(sshError("nodeNotFound", { hostname }), { status: 404 });
  }

  // A console mints a key that joins the Tailnet as the signed-in user, so it
  // is limited to machines that user owns (or to an account with broader
  // machine rights).
  if (!auth.canManageNode(principal, node)) {
    return data({ localized: { key: "errors.permission.actOnMachine" } }, { status: 403 });
  }

  const users = await api.users.list();
  const hsUser = principal.user.headscaleUserId
    ? users.find((user) => user.id === principal.user.headscaleUserId)
    : findHeadscaleUserBySubject(users, principal.user.subject, principal.profile.email);

  if (!hsUser) {
    return data(sshError("userNotLinked"), { status: 404 });
  }

  const formData = await request.formData();

  if (formData.get("intent") === "revoke") {
    const key = formData.get("key");
    if (typeof key !== "string" || key.length === 0) {
      return data({ error: "missing key" }, { status: 400 });
    }

    // The key ID is looked up from the user's own keys rather than trusted from
    // the request, so this can only ever expire a key this user was issued.
    const keys = await api.preAuthKeys.listForUser(hsUser.id);
    const match = keys.find((candidate) => candidate.key === key);
    if (!match) {
      return data({ revoked: false });
    }

    await api.preAuthKeys.expire(match);
    return data({ revoked: true });
  }

  const username = formData.get("user");
  if (typeof username !== "string" || username.trim().length === 0) {
    return data({ error: "missing user" }, { status: 400 });
  }

  const preAuthKey = await api.preAuthKeys.create({
    user: hsUser.id,
    ephemeral: true,
    reusable: false,
    expiration: new Date(Date.now() + SSH_PREAUTH_KEY_TTL_MS),
    aclTags: null,
  });

  return data({
    key: preAuthKey.key,
    id: preAuthKey.id ?? null,
    ephemeralHostname: generateHostname(username.trim()),
  } satisfies ConsoleKeyPayload);
}
