import type { Capabilities } from "../capabilities";
import type { Transport } from "../transport";

export interface PolicyApi {
  get(): Promise<{ policy: string; updatedAt: Date | null }>;
  /**
   * Validate a policy without storing it. Headscale replies `{}` when the
   * policy parses and throws the parser's own error when it does not.
   */
  check(policy: string): Promise<void>;
  set(policy: string): Promise<{ policy: string; updatedAt: Date | null }>;
}

/**
 * Headscale reports `updatedAt` as a string, but a partial response can omit it
 * (the old `updatedAt !== null` test let `undefined` through, and
 * `new Date(undefined)` is an invalid date whose `toISOString()` throws — a 500
 * on the policy pages). Anything unusable becomes `null` instead.
 */
function parseUpdatedAt(value: unknown): Date | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function makePolicyApi(
  transport: Transport,
  _capabilities: Capabilities,
  apiKey: string,
): PolicyApi {
  return {
    get: async () => {
      const { policy, updatedAt } = await transport.request<{
        policy: string;
        updatedAt?: string | null;
      }>({ method: "GET", path: "v1/policy", apiKey });
      return {
        policy,
        updatedAt: parseUpdatedAt(updatedAt),
      };
    },
    check: async (policy) => {
      await transport.request<Record<string, never>>({
        method: "POST",
        path: "v1/policy/check",
        apiKey,
        body: { policy },
      });
    },
    set: async (policy) => {
      const { policy: newPolicy, updatedAt } = await transport.request<{
        policy: string;
        updatedAt?: string | null;
      }>({ method: "PUT", path: "v1/policy", apiKey, body: { policy } });
      return { policy: newPolicy, updatedAt: parseUpdatedAt(updatedAt) };
    },
  };
}
