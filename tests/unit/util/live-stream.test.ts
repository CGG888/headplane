import { describe, expect, test } from "vitest";

import { MAX_LIVE_STREAMS, loader } from "~/routes/util/live";
import { headscaleLiveStoreContext, requestApiContext } from "~/server/context";

function createContext(onUnsubscribe?: () => void) {
  const store = {
    get: () => Promise.resolve({ data: [] }),
    subscribe: () => () => onUnsubscribe?.(),
    getVersions: () => ({ nodes: "1" }),
  };

  return {
    get: (context: unknown) => {
      if (context === requestApiContext) {
        return () => Promise.resolve({ principal: { kind: "api_key" }, api: {} });
      }

      if (context === headscaleLiveStoreContext) {
        return store;
      }

      return undefined;
    },
  };
}

function open(context: unknown) {
  return loader({
    request: new Request("https://headplane.example.com/events/live"),
    context,
    params: {},
  } as never);
}

// The stream counter is module state and the loader never closes on its own, so
// each case cancels everything it opened.
describe("live events stream", () => {
  test("a connection carries the hello event and releases its slot when cancelled", async () => {
    let unsubscribed = 0;
    const response = await open(createContext(() => unsubscribed++));

    expect(response.headers.get("Content-Type")).toBe("text/event-stream");

    const reader = response.body!.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain("event: hello");

    await reader.cancel();
    expect(unsubscribed).toBe(1);
  });

  test("the number of open streams is capped", async () => {
    const context = createContext();
    const opened: Response[] = [];
    for (let index = 0; index < MAX_LIVE_STREAMS; index++) {
      opened.push(await open(context));
    }

    try {
      let status: number | undefined;
      try {
        await open(context);
      } catch (thrown) {
        status = (thrown as { init?: { status: number } }).init?.status;
      }

      expect(status).toBe(429);
    } finally {
      for (const response of opened) {
        await response.body!.cancel();
      }
    }
  });

  test("cancelled streams free their slot for the next connection", async () => {
    const context = createContext();
    for (let index = 0; index < MAX_LIVE_STREAMS; index++) {
      const response = await open(context);
      await response.body!.cancel();
    }

    // Every slot was released by the cancellations above, so this one fits.
    const response = await open(context);
    expect(response).toBeInstanceOf(Response);
    await response.body!.cancel();
  });
});
