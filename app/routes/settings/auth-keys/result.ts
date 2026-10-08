/**
 * The success responses and error codes the pre-auth key action returns. Kept
 * in its own module so client dialogs can recognise them without importing the
 * action (which pulls in server-only code).
 */
export const PRE_AUTH_KEY_EXPIRED = "Pre-auth key expired";

/** Why a pre-auth key deletion failed; the dialog maps each to a message. */
export type AuthKeyDeleteErrorCode = "invalidKeyId" | "notFound" | "unsupported";

export interface AuthKeyDeleteSuccess {
  success: true;
}

export interface AuthKeyDeleteFailure {
  success: false;
  errorCode: AuthKeyDeleteErrorCode;
}

export type AuthKeyDeleteResult = AuthKeyDeleteSuccess | AuthKeyDeleteFailure;

/**
 * Why a bulk delete of expired keys failed as a whole. The per-key codes are
 * the same ones a single deletion reports; `forbidden` covers a self-service
 * account whose own keys could not be resolved at all.
 */
export type AuthKeyBulkDeleteErrorCode = AuthKeyDeleteErrorCode | "forbidden";

export interface AuthKeyBulkDeleteSuccess {
  success: true;
  /** How many keys Headscale accepted as deleted. */
  deleted: number;
  /** How many deletions failed for a reason other than "already gone". */
  failed: number;
}

export interface AuthKeyBulkDeleteFailure {
  success: false;
  errorCode: AuthKeyBulkDeleteErrorCode;
}

export type AuthKeyBulkDeleteResult = AuthKeyBulkDeleteSuccess | AuthKeyBulkDeleteFailure;
