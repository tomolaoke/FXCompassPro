import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const bodySchema = z.object({
  type: z.string().trim().min(1).max(40),
  symbol: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3,12}$/)
    .optional(),
  source: z.string().trim().max(40).optional(),
  payload: z.record(z.unknown()).optional(),
});

const cors = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET,POST,OPTIONS",
};

export const Route = createFileRoute("/api/public/events")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: cors }),
      GET: async ({ request }) => {
        const { recentEvents } = await import("@/lib/market/events.server");
        const url = new URL(request.url);
        const limit = Number(url.searchParams.get("limit") ?? 50);
        const symbol = url.searchParams.get("symbol");
        return Response.json(
          { events: recentEvents(Number.isFinite(limit) ? limit : 50, symbol) },
          { headers: cors },
        );
      },
      POST: async ({ request }) => {
        const parsed = bodySchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) {
          return Response.json(
            { error: "Invalid event body", issues: parsed.error.issues },
            { status: 400, headers: cors },
          );
        }
        const { publishEvent } = await import("@/lib/market/events.server");
        return Response.json({ event: publishEvent(parsed.data) }, { status: 201, headers: cors });
      },
    },
  },
});
