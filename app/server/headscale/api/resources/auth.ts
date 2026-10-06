import type { Capabilities } from "../capabilities";
import type { Transport } from "../transport";

export interface AuthApi {
  /**
   * Approve a pending Headscale authentication request.
   * Used by the Headplane agent to auto-approve its own registration.
   */
  approve(authId: string): Promise<void>;

  /**
   * Reject a pending Headscale authentication request, addressed by the same
   * auth ID {@link approve} takes. Only present when
   * `capabilities.authRequestsCanBeRejected` is true (Headscale 0.29+).
   */
  reject?: (authId: string) => Promise<void>;
}

export function makeAuthApi(
  transport: Transport,
  capabilities: Capabilities,
  apiKey: string,
): AuthApi {
  const api: AuthApi = {
    approve: async (authId) => {
      await transport.request({
        method: "POST",
        path: "v1/auth/approve",
        apiKey,
        body: { authId },
      });
    },
  };

  if (capabilities.authRequestsCanBeRejected) {
    api.reject = async (authId) => {
      // POST /api/v1/auth/reject { authId } -> {}
      await transport.request({
        method: "POST",
        path: "v1/auth/reject",
        apiKey,
        body: { authId },
      });
    };
  }

  return api;
}
