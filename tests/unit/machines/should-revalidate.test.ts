import type { ShouldRevalidateFunctionArgs } from "react-router";
import { describe, expect, test } from "vitest";

import { shouldRevalidateMachines } from "~/routes/machines/should-revalidate";

const LIST = "https://headplane.example/machines";
const DETAIL = `${LIST}/7`;

/**
 * A plain GET navigation - what `setSearchParams`, a filter click or a `Link`
 * produces - carries no form submission, so `formMethod`/`formData` stay absent
 * exactly as React Router leaves them. React Router hands the route
 * `defaultShouldRevalidate: true` whenever the query string changes, which is
 * the decision these pages override.
 */
function navigation(
  from: string,
  to: string,
  defaultShouldRevalidate = true,
): ShouldRevalidateFunctionArgs {
  return {
    currentUrl: new URL(from),
    currentParams: {},
    nextUrl: new URL(to),
    nextParams: {},
    defaultShouldRevalidate,
  };
}

/** A form or fetcher submission; the URL is unchanged by a submission. */
function submission(
  url: string,
  formData: FormData,
  defaultShouldRevalidate = true,
  formAction = url,
): ShouldRevalidateFunctionArgs {
  return {
    currentUrl: new URL(url),
    currentParams: {},
    nextUrl: new URL(url),
    nextParams: {},
    formAction,
    formData,
    formMethod: "POST",
    defaultShouldRevalidate,
  };
}

describe("machines revalidation", () => {
  test("a filter, search or page reset is view state and revalidates nothing", () => {
    expect(shouldRevalidateMachines(navigation(LIST, `${LIST}?q=web`))).toBe(false);
    expect(shouldRevalidateMachines(navigation(LIST, `${LIST}?user=alice`))).toBe(false);
    expect(shouldRevalidateMachines(navigation(LIST, `${LIST}?tag=tag:server`))).toBe(false);
    expect(shouldRevalidateMachines(navigation(LIST, `${LIST}?status=online`))).toBe(false);
    expect(shouldRevalidateMachines(navigation(LIST, `${LIST}?route=exit-node`))).toBe(false);

    // Typing replaces the previous value, and "clear filters" drops it entirely.
    expect(shouldRevalidateMachines(navigation(`${LIST}?q=we`, `${LIST}?q=web`))).toBe(false);
    expect(shouldRevalidateMachines(navigation(`${LIST}?status=online`, LIST))).toBe(false);

    // The detail page is keyed by params.id, never by the query string.
    expect(shouldRevalidateMachines(navigation(DETAIL, `${DETAIL}?relay=1`))).toBe(false);
  });

  test("a programmatic revalidation of the same URL is left alone", () => {
    // Live updates and the online handler revalidate without moving the URL.
    expect(shouldRevalidateMachines(navigation(LIST, LIST))).toBe(true);
    expect(shouldRevalidateMachines(navigation(LIST, LIST, false))).toBe(false);
  });

  test("real navigation still consults React Router", () => {
    // Clicking a machine, or going back to the list, is a new route instance.
    expect(shouldRevalidateMachines(navigation(LIST, DETAIL))).toBe(true);
    expect(shouldRevalidateMachines(navigation(DETAIL, LIST))).toBe(true);
    expect(shouldRevalidateMachines(navigation(LIST, `${LIST}/7?tab=tags`))).toBe(true);
    expect(shouldRevalidateMachines(navigation(LIST, DETAIL, false))).toBe(false);
  });

  test("a mutation revalidates, because it can change the listed machines", () => {
    const formData = new FormData();
    formData.append("action_id", "bulk_delete");

    expect(shouldRevalidateMachines(submission(LIST, formData))).toBe(true);

    // The relay "Re-resolve" fetcher posts to its own resource route.
    const refresh = new FormData();
    refresh.append("action_id", "refresh_relay_dns");

    expect(
      shouldRevalidateMachines(submission(DETAIL, refresh, true, "/settings/headscale/relay-dns")),
    ).toBe(true);
  });

  test("anything unrecognised follows defaultShouldRevalidate", () => {
    expect(shouldRevalidateMachines(navigation(LIST, `${LIST}#top`))).toBe(true);
    expect(shouldRevalidateMachines(navigation(LIST, `${LIST}#top`, false))).toBe(false);

    const formData = new FormData();
    expect(shouldRevalidateMachines(submission(LIST, formData, false))).toBe(false);
  });
});
