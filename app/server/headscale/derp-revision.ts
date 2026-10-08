/**
 * A counter that changes every time HeadplaneCN forgets its DERP caches.
 *
 * The live store polls this instead of the Headscale API: the DERP cards read
 * local files and remote maps, so there is no endpoint whose response would
 * change when a map is saved. Bumping this counter is what tells every open
 * page to load its DERP data again.
 *
 * Kept in a module with no imports of its own so the live store can read it
 * without pulling the map readers (and their network stack) into its graph.
 */
let revision = 0;

/** The current DERP revision; only ever grows within a process. */
export function getDerpRevision(): number {
  return revision;
}

/** Records that the DERP data on disk changed; returns the new revision. */
export function bumpDerpRevision(): number {
  revision += 1;
  return revision;
}

/** Test helper: forget every bump this process has made. */
export function resetDerpRevision(): void {
  revision = 0;
}
