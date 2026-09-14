import { createFileRoute } from "@tanstack/react-router";

/**
 * Server-sent-events live feed. Streams price snapshots for the requested
 * symbols plus every event published through /api/public/events.
 *
 * Gated by PUBLIC_API_TOKEN — see public-api-auth.server.ts. Without a
 * configured token this endpoint refuses every request: an open SSE stream
 * that polls the market-data provider every 20 seconds per connection is
 * exactly the kind of thing that drains a shared free-tier API quota if it's
 * reachable by anyone who finds the URL.
 */
export const Route = createFileRoute("/api/public/feed")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const { checkPublicApiAuth } = await import("@/lib/market/public-api-auth.server");
        const auth = checkPublicApiAuth(request);
        if (!auth.ok) return auth.response!;

        const url = new URL(request.url);
        const symbols = (url.searchParams.get("symbols") ?? "XAUUSD,EURUSD")
          .split(",")
          .map((s) => s.trim().toUpperCase())
          .filter((s) => /^[A-Z]{3,12}$/.test(s))
          .slice(0, 8);

        const { subscribe, recentEvents, publishEvent } =
          await import("@/lib/market/events.server");
        const { loadQuotes } = await import("@/lib/market/market.server");

        const encoder = new TextEncoder();
        let unsubscribe: (() => void) | null = null;
        let timer: ReturnType<typeof setInterval> | null = null;

        const stream = new ReadableStream({
          start(controller) {
            const send = (event: string, data: unknown) => {
              try {
                controller.enqueue(
                  encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
                );
              } catch {
                // stream already closed
              }
            };

            send("hello", {
              symbols,
              note: "Educational feed. Prices may be delayed or sample data — check each quote's kind.",
            });
            for (const event of recentEvents(20).reverse()) send("event", event);
            unsubscribe = subscribe((event) => send("event", event));

            const tick = async () => {
              try {
                const result = await loadQuotes(symbols);
                send("quotes", { at: Date.now(), real: result.real, quotes: result.quotes });
              } catch (error) {
                send("error", { message: (error as Error).message });
              }
            };
            void tick();
            timer = setInterval(() => {
              void tick();
            }, 20_000);

            request.signal.addEventListener("abort", () => {
              if (timer) clearInterval(timer);
              unsubscribe?.();
              try {
                controller.close();
              } catch {
                // already closed
              }
            });

            publishEvent({
              type: "feed.subscribed",
              source: "feed",
              payload: { symbols },
            });
          },
          cancel() {
            if (timer) clearInterval(timer);
            unsubscribe?.();
          },
        });

        return new Response(stream, {
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-cache, no-transform",
            connection: "keep-alive",
            ...auth.corsHeaders,
          },
        });
      },
    },
  },
});
