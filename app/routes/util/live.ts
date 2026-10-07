import { data } from "react-router";

import { headscaleLiveStoreContext, requestApiContext } from "~/server/context";
import { nodesResource, usersResource } from "~/server/headscale/live-store";
import log from "~/utils/log";

import type { Route } from "./+types/live";

/**
 * How many live streams this process serves at once. Every stream holds a store
 * subscription plus a queue that a slow (or half-open) client never drains, so
 * "one per open tab" needs a ceiling: without one, a client that reconnects
 * without ever disconnecting grows both without bound.
 */
export const MAX_LIVE_STREAMS = 32;

let activeStreams = 0;

export async function loader({ request, context }: Route.LoaderArgs) {
  if (activeStreams >= MAX_LIVE_STREAMS) {
    log.warn("sse", "Refusing a live connection: %d streams are already open", activeStreams);

    throw data("Too many live connections", { status: 429 });
  }

  const getRequestApi = context.get(requestApiContext);
  const headscaleLiveStore = context.get(headscaleLiveStoreContext);

  const { api } = await getRequestApi(request);

  // Ensure resources are loaded before streaming
  await Promise.all([
    headscaleLiveStore.get(nodesResource, api),
    headscaleLiveStore.get(usersResource, api),
  ]);

  let teardown = () => {};

  const stream = new ReadableStream({
    start(controller) {
      activeStreams += 1;

      let closed = false;
      let unsubscribe: (() => void) | undefined;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      const encoder = new TextEncoder();

      // The single exit: a closed socket, a failed write and a client cancel all
      // release the subscription, the timer and the slot. Each of them used to
      // be handled separately, and two of the paths (a failed `send`, a failed
      // heartbeat) only flipped a flag — the listener stayed registered and the
      // queue kept growing.
      teardown = () => {
        if (closed) return;
        closed = true;
        activeStreams -= 1;
        try {
          unsubscribe?.();
        } catch {}
        if (heartbeat !== undefined) {
          clearInterval(heartbeat);
        }
        try {
          controller.close();
        } catch {}
      };

      const send = (event: string, payload: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`),
          );
        } catch {
          teardown();
        }
      };

      unsubscribe = headscaleLiveStore.subscribe((resource, version) => {
        log.debug("sse", "Sending change event: %s v%s", resource, version);
        send("changed", { resource, version });
      });

      heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(": heartbeat\n\n"));
        } catch {
          teardown();
        }
      }, 30_000);

      const versions = headscaleLiveStore.getVersions();
      log.debug("sse", "Client connected, sending hello with versions: %o", versions);
      send("hello", versions);

      request.signal.addEventListener("abort", () => {
        log.debug("sse", "Client disconnected");
        teardown();
      });
    },

    // A consumer that cancels the body (the browser closing the page) never
    // fires the abort signal on every runtime, so the slot is released here too.
    cancel() {
      teardown();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
