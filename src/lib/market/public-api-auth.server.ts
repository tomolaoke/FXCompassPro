/**
 * Guards the agent/MCP-integration endpoints under /api/public/*.
 *
 * These endpoints are OFF by default. Setting PUBLIC_API_TOKEN turns them on
 * and requires every caller to present it. Without this, an SSE feed that
 * opens a Twelve Data poll per connection is reachable by anyone who finds the
 * URL — which on a deployed app burns the free daily credit quota for
 * everyone else using it. See docs/environment.md.
 */

function configuredToken(): string | undefined {
  const raw = process.env["PUBLIC_API_TOKEN"];
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

function allowedOrigins(): string[] {
  const raw = process.env["PUBLIC_API_ALLOWED_ORIGINS"];
  if (!raw) return [];
  return raw
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
}

/** Constant-time-ish comparison; timing leaks on a bearer token are not worth optimising away here, but avoid the obvious short-circuit. */
function tokensMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export interface PublicApiAuthResult {
  readonly ok: boolean;
  /** Present when ok is false — return this response directly. */
  readonly response?: Response;
  /** CORS headers to merge into a successful response. Never "*" when a token is configured. */
  readonly corsHeaders: Record<string, string>;
}

export function checkPublicApiAuth(request: Request): PublicApiAuthResult {
  const token = configuredToken();
  const origins = allowedOrigins();
  const requestOrigin = request.headers.get("origin");
  const originHeader =
    origins.length > 0
      ? requestOrigin && origins.includes(requestOrigin)
        ? requestOrigin
        : origins[0]!
      : token
        ? "" // a token is set but no explicit origin allowlist: same-origin only, never "*"
        : "*"; // no token configured means these endpoints are disabled anyway; value is unused

  const corsHeaders: Record<string, string> = {
    "access-control-allow-headers": "content-type, authorization",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    ...(originHeader ? { "access-control-allow-origin": originHeader } : {}),
  };

  if (!token) {
    return {
      ok: false,
      corsHeaders,
      response: Response.json(
        {
          error:
            "This endpoint is disabled. Set PUBLIC_API_TOKEN to enable it — see docs/environment.md.",
        },
        { status: 404, headers: corsHeaders },
      ),
    };
  }

  const authHeader = request.headers.get("authorization") ?? "";
  const presented = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length) : null;

  if (!presented || !tokensMatch(presented, token)) {
    return {
      ok: false,
      corsHeaders,
      response: Response.json(
        { error: "Missing or invalid bearer token." },
        { status: 401, headers: corsHeaders },
      ),
    };
  }

  return { ok: true, corsHeaders };
}
