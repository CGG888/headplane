import type { ShouldRevalidateFunctionArgs } from "react-router";

/**
 * Revalidation policy for both machines pages (`/machines` and `/machines/:id`).
 *
 * Searching, filtering and sorting the machine list is entirely client side:
 * the page derives `filteredAndSortedNodes` from `loaderData.populatedNodes`,
 * and the controls only write their state to the query string (`?q=`, `?user=`,
 * `?tag=`, `?status=`, `?route=`) so a filtered list can be bookmarked and
 * shared. Neither loader reads the query string - `overview.tsx` and
 * `machine.tsx` only ever look at `params.id` - yet React Router revalidates a
 * route's loaders whenever the query string changes (`getMatchesToLoad` sets
 * `defaultShouldRevalidate = true` when `currentUrl.search !== nextUrl.search`,
 * `@react-router`'s `router.js`). Every filter click, every keystroke in the
 * search box and every "clear filters" press therefore re-ran the loader: a
 * policy fetch to Headscale, a nodes/users snapshot read and a full re-render of
 * the table for data that could not have changed.
 *
 * This keeps the URL contract and the loader's return shape exactly as they
 * were; it only declines the refetch for a change that is *only* view state.
 */
export function shouldRevalidateMachines(args: ShouldRevalidateFunctionArgs): boolean {
  const { currentUrl, nextUrl, formMethod, defaultShouldRevalidate } = args;

  // A form submission - the route's own action (rename, expire, bulk edits), a
  // dialog's fetcher or the relay "Re-resolve" fetcher - can change stored data,
  // so it keeps React Router's answer. The machines action only ever mutates;
  // there is no read-only `action_id` to special case.
  if (formMethod !== undefined) {
    return defaultShouldRevalidate;
  }

  // A navigation on the same pathname that only rewrites the query string is
  // view state on these pages, and nothing either loader reads.
  if (currentUrl.pathname === nextUrl.pathname && currentUrl.search !== nextUrl.search) {
    return false;
  }

  // Everything else - a different machine, another route, a programmatic
  // revalidation (live updates, the online handler) whose URLs match - is left
  // to React Router.
  return defaultShouldRevalidate;
}
