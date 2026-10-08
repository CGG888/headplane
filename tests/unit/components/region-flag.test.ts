import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import { RegionFlag } from "~/components/region-flag";

/** The image the component drew, or `undefined` when it drew none. */
function flagUrl(props: { code?: string; name?: string }): string | undefined {
  const markup = renderToStaticMarkup(createElement(RegionFlag, props));
  return /<img[^>]*src="([^"]+)"/.exec(markup)?.[1];
}

/**
 * The flag is decoration: it carries no text, so every assertion here is about
 * the image the browser draws (and about the cases where nothing is drawn at
 * all, which is what keeps a wrong flag off an unknown region).
 */
describe("the relay region flag", () => {
  test("draws the flag of the region's code", () => {
    const markup = renderToStaticMarkup(createElement(RegionFlag, { code: "hkg", name: "香港" }));

    expect(markup).toMatch(/<img[^>]*alt=""/);
    expect(markup).toMatch(/<img[^>]*aria-hidden="true"/);
    expect(flagUrl({ code: "hkg" })).toBeDefined();
  });

  test("reads the country from the name when no code is at hand", () => {
    // The lookup, not the asset pipeline, is what is under test: two regions in
    // two countries must not come out as the same picture.
    const japan = flagUrl({ name: "东京" });
    expect(japan).toBeDefined();
    expect(japan).not.toBe(flagUrl({ name: "香港" }));
  });

  test("draws nothing for a region no table knows, rather than a guess", () => {
    const unknown = renderToStaticMarkup(createElement(RegionFlag, { name: "Atlantis" }));
    const missing = renderToStaticMarkup(createElement(RegionFlag, {}));

    expect({ missing, unknown }).toEqual({ missing: "", unknown: "" });
  });
});
