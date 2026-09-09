import { useMemo } from "react";
import { stochastic } from "@/lib/market/indicators";
import { fmtPrice } from "@/lib/market/instruments";
import type { Candle } from "@/lib/market/types";

export interface ChartOverlay {
  label: string;
  price: number;
  tone: "bull" | "bear" | "warn" | "neutral";
}

const TONE: Record<ChartOverlay["tone"], string> = {
  bull: "var(--bull)",
  bear: "var(--bear)",
  warn: "var(--warn)",
  neutral: "var(--neutral)",
};

export function CandleChart({
  candles,
  symbol,
  overlays = [],
  zone = null,
  visible = 90,
}: {
  candles: Candle[];
  symbol: string;
  overlays?: ChartOverlay[];
  zone?: [number, number] | null;
  visible?: number;
}) {
  const view = useMemo(() => candles.slice(-visible), [candles, visible]);
  const stoch = useMemo(
    () => (candles.length >= 30 ? stochastic(candles, 25, 2, 4).slice(-visible) : []),
    [candles, visible],
  );

  if (!view.length) {
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">No candles available.</p>
    );
  }

  const W = 720;
  const H = 260;
  const SH = 90;
  const prices = [
    ...view.flatMap((c) => [c.h, c.l]),
    ...overlays.map((o) => o.price),
    ...(zone ?? []),
  ].filter((v) => Number.isFinite(v));
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const pad = (max - min) * 0.06 || 0.0001;
  const lo = min - pad;
  const hi = max + pad;
  const y = (p: number) => H - ((p - lo) / (hi - lo)) * H;
  const step = W / view.length;
  const bodyW = Math.max(1.5, step * 0.6);

  const sy = (v: number) => SH - (v / 100) * SH;
  const line = (get: (i: number) => number | null) =>
    stoch
      .map((_, i) => {
        const v = get(i);
        return v === null ? null : `${i * (W / Math.max(stoch.length, 1)) + step / 2},${sy(v)}`;
      })
      .filter((p): p is string => p !== null)
      .join(" ");

  return (
    <div className="space-y-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`${symbol} candles`}>
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={0}
            x2={W}
            y1={H * f}
            y2={H * f}
            stroke="var(--grid)"
            strokeWidth={1}
          />
        ))}
        {zone && (
          <rect
            x={0}
            width={W}
            y={y(Math.max(zone[0], zone[1]))}
            height={Math.max(2, Math.abs(y(zone[1]) - y(zone[0])))}
            fill="var(--primary)"
            opacity={0.14}
          />
        )}
        {overlays.map((o) => (
          <g key={`${o.label}-${o.price}`}>
            <line
              x1={0}
              x2={W}
              y1={y(o.price)}
              y2={y(o.price)}
              stroke={TONE[o.tone]}
              strokeWidth={1}
              strokeDasharray="5 4"
            />
            <text x={4} y={y(o.price) - 4} fill={TONE[o.tone]} fontSize={11}>
              {o.label} {fmtPrice(o.price, symbol)}
            </text>
          </g>
        ))}
        {view.map((c, i) => {
          const x = i * step + step / 2;
          const up = c.c >= c.o;
          const color = up ? "var(--bull)" : "var(--bear)";
          const top = y(Math.max(c.o, c.c));
          const height = Math.max(1, Math.abs(y(c.o) - y(c.c)));
          return (
            <g key={c.t}>
              <line x1={x} x2={x} y1={y(c.h)} y2={y(c.l)} stroke={color} strokeWidth={1} />
              <rect x={x - bodyW / 2} y={top} width={bodyW} height={height} fill={color} />
            </g>
          );
        })}
      </svg>

      {stoch.length > 0 && (
        <div>
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
            Stochastic 25, 2, 4
          </p>
          <svg viewBox={`0 0 ${W} ${SH}`} className="w-full" role="img" aria-label="Stochastic">
            {[20, 50, 80].map((lvl) => (
              <line
                key={lvl}
                x1={0}
                x2={W}
                y1={sy(lvl)}
                y2={sy(lvl)}
                stroke="var(--grid)"
                strokeWidth={1}
              />
            ))}
            <polyline
              points={line((i) => stoch[i]?.k ?? null)}
              fill="none"
              stroke="var(--chart-1)"
              strokeWidth={1.6}
            />
            <polyline
              points={line((i) => stoch[i]?.d ?? null)}
              fill="none"
              stroke="var(--chart-4)"
              strokeWidth={1.6}
            />
          </svg>
        </div>
      )}
    </div>
  );
}
