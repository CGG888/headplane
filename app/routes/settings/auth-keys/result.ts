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
