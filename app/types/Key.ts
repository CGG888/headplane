export type Key = {
  id: string;
  prefix: string;
  /**
   * Headscale serializes its protobuf timestamps as RFC3339 strings, so these
   * are *not* `Date` objects despite what the field names suggest. Callers must
   * parse them before formatting (the API key row does exactly that).
   */
  expiration: string;
  createdAt: string;
  /** Empty string for a key that has never been used. */
  lastSeen: string;
};
