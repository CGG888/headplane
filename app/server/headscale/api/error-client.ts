import type { HeadscaleConnectionError } from "./error";

/**
 * Represents an error returned by the Headscale API.
 */
export interface HeadscaleAPIError {
  requestUrl: `${string} ${string}`;
  statusCode: number;
  /**
   * One sanitized line describing what the upstream said, produced by
   * `summarizeErrorBody` in `transport.ts`. The upstream body itself is
   * deliberately not part of the payload: it ends up in a browser, and a reverse
   * proxy in front of Headscale answers with its own HTML error page when the
   * backend is unreachable.
   */
  detail: string;
  data: Record<string, unknown> | null;
}

/**
 * Type guard to check if an error is a HeadscaleAPIError.
 * @param error - The error to check.
 * @returns True if the error is a HeadscaleAPIError, false otherwise.
 */
export function isApiError(error: unknown): error is HeadscaleAPIError {
  return (
    error != null &&
    typeof error === "object" &&
    "requestUrl" in error &&
    "statusCode" in error &&
    "detail" in error &&
    "data" in error
  );
}

/**
 * Type guard to check if an error is a HeadscaleConnectionError.
 * @param error - The error to check.
 * @returns True if the error is a HeadscaleConnectionError, false otherwise.
 */
export function isConnectionError(error: unknown): error is HeadscaleConnectionError {
  return (
    error != null &&
    typeof error === "object" &&
    "requestUrl" in error &&
    "errorCode" in error &&
    "errorMessage" in error &&
    "extraData" in error
  );
}

/**
 * Type guard to check if an error is a DataUnauthorizedError.
 * This checks if the error has a `data` property with a `statusCode` of 401.
 *
 * @param error - The error to check.
 * @returns True if the error is a DataUnauthorizedError, false otherwise.
 */
export function isDataUnauthorizedError(error: unknown): boolean {
  return (
    error != null &&
    typeof error === "object" &&
    "data" in error &&
    typeof error.data === "object" &&
    error.data != null &&
    "statusCode" in error.data &&
    error.data.statusCode === 401
  );
}

/**
 * Type guard to check if an error is a DataWithResponseInit wrapping a
 * HeadscaleAPIError. This is used in loaders/actions to handle errors thrown by
 * `data()` before they reach the ErrorBoundary.
 *
 * @param error - The error to check.
 * @returns True if the error is a DataWithResponseInit containing a
 * HeadscaleAPIError, false otherwise.
 */
export function isDataWithApiError(error: unknown): error is { data: HeadscaleAPIError } {
  return error != null && typeof error === "object" && "data" in error && isApiError(error.data);
}
