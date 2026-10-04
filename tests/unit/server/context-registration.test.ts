import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

// A context that is created but never registered on the router context throws
// "No value found for context" at request time, and React Router turns that into
// "Unexpected Server Error" in production. That is exactly how the audit log,
// the snapshots pages and the API key actions shipped broken while every unit
// test — which mocks the context — stayed green. This test is the tripwire.

async function exportedContexts(): Promise<string[]> {
  const source = await readFile("app/server/context.ts", "utf8");
  const names = [...source.matchAll(/export const (\w+Context) = createContext</g)].map(
    (match) => match[1],
  );

  return [...new Set(names)].sort();
}

async function registeredContexts(): Promise<string[]> {
  const source = await readFile("app/server/app.ts", "utf8");
  const names = [...source.matchAll(/routerContext\.set\((\w+Context),/g)].map((match) => match[1]);

  return [...new Set(names)].sort();
}

describe("router context registration", () => {
  test("every context the app exports is registered for requests", async () => {
    const exported = await exportedContexts();

    // Guard against the regexes silently matching nothing.
    expect(exported.length).toBeGreaterThan(5);

    expect(await registeredContexts()).toEqual(exported);
  });
});
