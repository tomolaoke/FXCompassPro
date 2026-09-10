import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell, DataBadge, Panel } from "@/components/app-shell";
import { useSignalRun } from "@/lib/market/hooks";
import { fmtPrice, specFor } from "@/lib/market/instruments";
import { calculateRisk } from "@/lib/market/risk";
import { newId, useSettings, useSignalRecords } from "@/lib/market/store";

export const Route = createFileRoute("/plan")({
  validateSearch: (search: Record<string, unknown>) => ({
    symbol: typeof search["symbol"] === "string" ? search["symbol"].toUpperCase() : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Trade plan & position size — Caveman Markets" },
      {
        name: "description",
        content:
          "Enter your account size and risk percent to see the lot size, stop-loss and take-profit levels the deterministic engine derived. Educational only.",
      },
      { property: "og:title", content: "Trade plan & position size — Caveman Markets" },
      {
        property: "og:description",
        content:
          "Lot size, stop and targets worked out step by step from your own account size and risk percent.",
      },
    ],
  }),
  component: PlanPage;
});

function PlanPage() {
  return null;
}
