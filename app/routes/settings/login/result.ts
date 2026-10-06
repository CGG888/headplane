// MARK: Console-login action results
//
// The shape the route action answers with, kept apart from the route module so
// the form component and the action agree on it without either importing the
// other. It is dependency-free: types only.

import type {
  LoginLockoutReason,
  LoginOidcActionErrorCode,
  LoginOidcErrorCode,
  LoginOidcFieldId,
  LoginSignInPaths,
} from "./login-oidc";
import type { LoginSelfTestReport } from "./self-test";

export interface LoginActionFailure {
  success: false;
  errorCode: LoginOidcActionErrorCode | "forbidden";
  /** Every validation error, so the form can report more than the first one. */
  errors?: LoginOidcErrorCode[];
  /** Why the change needed an explicit confirmation. */
  reasons?: LoginLockoutReason[];
  /** What would still be available to sign in with. */
  remaining?: LoginSignInPaths;
}

export type LoginActionData =
  | { success: true; kind: "self_test"; report: LoginSelfTestReport }
  | { success: true; kind: "save"; changed: LoginOidcFieldId[] }
  | LoginActionFailure;
