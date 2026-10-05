/**
 * The one success response the pre-auth key action returns. Kept in its own
 * module so client dialogs can recognise it without importing the action
 * (which pulls in server-only code).
 */
export const PRE_AUTH_KEY_EXPIRED = "Pre-auth key expired";
