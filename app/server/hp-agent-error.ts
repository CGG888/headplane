/**
 * Readable text for whatever the Headplane Agent reported.
 *
 * The agent is a separate process and reports problems as JSON, so the value
 * here is often an object rather than a string. Storing it verbatim made the
 * settings page render `[object Object]` (and the logs were no better), which
 * hid the only clue an operator has for fixing the agent.
 */

/** Longest message Headplane keeps; agent errors can embed whole stack traces. */
export const MAX_AGENT_ERROR_LENGTH = 1000;

const MESSAGE_KEYS = ["message", "error", "reason", "detail", "msg"];

/**
 * Failures worth explaining differently from a raw message.
 *
 * `apiKeyRejected` is the one operators hit most: the API key in Headplane's own
 * configuration is not the key they signed in with, so the UI keeps working
 * while the agent (and anything else running without a session) gets a 401.
 */
export type AgentErrorCode = "apiKeyRejected";

export function classifyAgentError(value: unknown): AgentErrorCode | undefined {
  const status = extractStatusCode(value);
  if (status === 401 || status === 403) {
    return "apiKeyRejected";
  }

  return undefined;
}

/** Finds the HTTP status in the various shapes an error can arrive in. */
function extractStatusCode(value: unknown, depth = 0): number | undefined {
  if (value == null || typeof value !== "object" || depth > 4) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const direct = record.statusCode;
  if (typeof direct === "number") {
    return direct;
  }

  for (const key of ["data", "error", "response", "cause"]) {
    const nested = extractStatusCode(record[key], depth + 1);
    if (nested !== undefined) {
      return nested;
    }
  }

  return undefined;
}

export function describeAgentError(value: unknown, depth = 0): string {
  if (value == null) {
    return "";
  }

  if (typeof value === "string") {
    return truncate(value.trim());
  }

  if (value instanceof Error) {
    return truncate(value.message.trim() || value.name);
  }

  if (typeof value !== "object") {
    return truncate(String(value));
  }

  const record = value as Record<string, unknown>;

  // A string under one of the usual keys is the message itself; an object there
  // is a nested error worth looking inside.
  if (depth < 3) {
    for (const key of MESSAGE_KEYS) {
      const candidate = record[key];
      if (candidate === undefined) {
        continue;
      }

      if (typeof candidate === "string" && candidate.trim().length > 0) {
        return truncate(candidate.trim());
      }

      if (typeof candidate === "object" && candidate !== null) {
        const nested = describeAgentError(candidate, depth + 1);
        if (nested.length > 0) {
          return nested;
        }
      }
    }
  }

  return truncate(safeStringify(record) ?? Object.prototype.toString.call(value));
}

function safeStringify(value: unknown): string | undefined {
  try {
    return JSON.stringify(value);
  } catch {
    return undefined;
  }
}

function truncate(text: string): string {
  if (text.length <= MAX_AGENT_ERROR_LENGTH) {
    return text;
  }

  return `${text.slice(0, MAX_AGENT_ERROR_LENGTH - 1)}…`;
}
