import type { User } from "~/types";

import type { Capabilities } from "../capabilities";
import type { Transport } from "../transport";

export interface CreateUserOptions {
  name: string;
  email?: string;
  displayName?: string;
  pictureUrl?: string;
}

export interface ListUsersFilter {
  id?: string;
  name?: string;
  email?: string;
}

export interface UserApi {
  list(filter?: ListUsersFilter): Promise<User[]>;
  create(opts: CreateUserOptions): Promise<User>;
  delete(id: string): Promise<void>;
  rename(id: string, newName: string): Promise<void>;
}

/** A headscale user ID as it appears in the REST path: a decimal `uint64`. */
const USER_ID_PATTERN = /^\d{1,20}$/;

/**
 * Build a `v1/user/<id>...` path, refusing anything that is not a plain
 * decimal ID. See `nodePath` in `resources/nodes.ts`: `new URL()` collapses
 * `..` segments, so an ID like `../apikey` would otherwise reach a sibling
 * endpoint while riding on the panel's own API key.
 */
function userPath(id: string, suffix = ""): `v1/user/${string}` {
  const value = String(id).trim();
  if (!USER_ID_PATTERN.test(value)) {
    throw new Error(`Invalid user ID: ${JSON.stringify(String(id))}`);
  }
  return `v1/user/${value}${suffix}`;
}

export function makeUserApi(
  transport: Transport,
  _capabilities: Capabilities,
  apiKey: string,
): UserApi {
  return {
    list: async (filter) => {
      const { id, name, email } = filter ?? {};
      const moreThanOneFilter = [id, name, email].filter((v) => v !== undefined).length > 1;
      if (moreThanOneFilter) {
        throw new Error("Only one of id, name, or email filters can be provided");
      }
      const { users } = await transport.request<{ users: User[] }>({
        method: "GET",
        path: "v1/user",
        apiKey,
        query: { id, name, email },
      });
      return users;
    },
    create: async ({ name, email, displayName, pictureUrl }) => {
      const { user } = await transport.request<{ user: User }>({
        method: "POST",
        path: "v1/user",
        apiKey,
        body: { name, email, displayName, pictureUrl },
      });
      return user;
    },
    delete: async (id) => {
      await transport.request({ method: "DELETE", path: userPath(id), apiKey });
    },
    rename: async (id, newName) => {
      await transport.request({
        method: "POST",
        path: userPath(id, `/rename/${encodeURIComponent(newName)}`),
        apiKey,
      });
    },
  };
}
