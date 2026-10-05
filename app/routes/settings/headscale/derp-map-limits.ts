/**
 * Size limits and defaults shared by the DERP map validator, the editor, and the
 * server-side writer.
 *
 * Kept in its own module so the browser can read them without pulling in the
 * YAML parser: the validator is loaded on demand when an editor is opened, and
 * anything importing it statically would drag the parser into the page bundle.
 */

/**
 * Nothing larger than this is loaded into the editor or written back. The cap is
 * far above any hand-written map and matches what the server enforces.
 */
export const MAX_DERP_MAP_BYTES = 256 * 1024;

/**
 * A file with hundreds of problems is not worth listing: the editor reports the
 * first batch and the operator fixes them from the top down.
 */
export const MAX_DERP_MAP_ISSUES = 25;

/** `derpport` defaults to 443 when a node omits it, so an absent value is fine. */
export const DERP_DEFAULT_PORT = 443;
