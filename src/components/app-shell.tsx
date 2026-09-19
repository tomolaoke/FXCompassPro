import { Link } from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";
import { DISCLAIMER } from "@/lib/market/signal";
import type { Quote } from "@/lib/market/types";

const NAV = [
  { to: "/", label: "Dashboard" },
  { to: "/chart", label: "Chart" },
  { to: "/plan", label: "Trade plan" },
  { to: "/records", label: "Records" },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div>
            <p className="font-display text-base font-semibold tracking-tight">FX Compass Pro</p>
            <p className="text-[11px] text-muted-foreground">Educational market analysis</p>
          </div>
          <span className="rounded-full border border-warn/40 bg-warn/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-warn">
            Not financial advice
          </span>
        </div>
        <p className="border-t border-border bg-card/60 px-4 py-2 text-center text-[11px] leading-snug text-muted-foreground">
          {DISCLAIMER}
        </p>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-4">{children}</main>

      <nav className="fixed bottom-0 left-0 right-0 z-20 border-t border-border bg-background/95 backdrop-blur">
        <div className="mx-auto grid max-w-5xl grid-cols-4">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: item.to === "/" }}
              className="py-3 text-center text-xs font-medium text-muted-foreground transition-colors [&.active]:text-primary"
            >
              {item.label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}

export function DataBadge({ quote }: { quote: Quote | undefined }) {
  // Age is computed from Date.now(), which differs between the server-render
  // instant and the client-hydration instant by however long the request
  // took — rendering it on both sides produces two different strings for the
  // same markup and React (correctly) flags that as a hydration mismatch.
  // Committing to a value only after mount keeps server and client markup
  // identical on the first paint; the real age fills in a moment later.
  const [age, setAge] = useState<number | null>(null);

  useEffect(() => {
    if (!quote) return;
    setAge(Math.max(0, Math.round((Date.now() - quote.timestamp) / 60000)));
  }, [quote]);

  if (!quote) return null;
  const tone =
    quote.kind === "demo"
      ? "border-bear/40 bg-bear/10 text-bear"
      : quote.kind === "live"
        ? "border-bull/40 bg-bull/10 text-bull"
        : "border-warn/40 bg-warn/10 text-warn";
  return (
    <span
      className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${tone}`}
      title={quote.note ?? quote.provider}
    >
      {quote.kind === "demo" ? "No real data — sample" : quote.kind} · {quote.provider}
      {age !== null ? ` · ${age}m` : ""}
    </span>
  );
}

export function Panel({
  title,
  action,
  children,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="panel p-4">
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && (
            <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              {title}
            </h2>
          )}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
