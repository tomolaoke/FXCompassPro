import { afterEach, describe, expect, it, vi } from "vitest";
import { checkPublicApiAuth } from "./public-api-auth.server";

function req(headers: Record<string, string> = {}): Request {
  return new Request("https://example.com/api/public/feed", { headers });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("checkPublicApiAuth — disabled by default", () => {
  it("refuses every request when PUBLIC_API_TOKEN is not set", () => {
    vi.stubEnv("PUBLIC_API_TOKEN", "");
    const result = checkPublicApiAuth(req());
    expect(result.ok).toBe(false);
    expect(result.response?.status).toBe(404);
  });

  it("refuses even a request that presents a bearer token, when none is configured", () => {
    vi.stubEnv("PUBLIC_API_TOKEN", "");
    const result = checkPublicApiAuth(req({ authorization: "Bearer anything" }));
    expect(result.ok).toBe(false);
  });
});

describe("checkPublicApiAuth — enabled with a token", () => {
  it("accepts the exact configured token", () => {
    vi.stubEnv("PUBLIC_API_TOKEN", "correct-horse-battery-staple");
    const result = checkPublicApiAuth(
      req({ authorization: "Bearer correct-horse-battery-staple" }),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a missing Authorization header", () => {
    vi.stubEnv("PUBLIC_API_TOKEN", "secret");
    const result = checkPublicApiAuth(req());
    expect(result.ok).toBe(false);
    expect(result.response?.status).toBe(401);
  });

  it("rejects a non-Bearer scheme", () => {
    vi.stubEnv("PUBLIC_API_TOKEN", "secret");
    const result = checkPublicApiAuth(req({ authorization: "Basic secret" }));
    expect(result.ok).toBe(false);
  });

  it("rejects a wrong token of the same length", () => {
    vi.stubEnv("PUBLIC_API_TOKEN", "aaaaaaaa");
    const result = checkPublicApiAuth(req({ authorization: "Bearer bbbbbbbb" }));
    expect(result.ok).toBe(false);
  });

  it("rejects a wrong token of a different length", () => {
    vi.stubEnv("PUBLIC_API_TOKEN", "aaaaaaaa");
    const result = checkPublicApiAuth(req({ authorization: "Bearer short" }));
    expect(result.ok).toBe(false);
  });

  it("never sets a wildcard CORS origin once a token is configured", () => {
    vi.stubEnv("PUBLIC_API_TOKEN", "secret");
    vi.stubEnv("PUBLIC_API_ALLOWED_ORIGINS", "");
    const result = checkPublicApiAuth(req({ authorization: "Bearer secret" }));
    expect(result.corsHeaders["access-control-allow-origin"]).not.toBe("*");
  });

  it("reflects an explicitly allowed origin", () => {
    vi.stubEnv("PUBLIC_API_TOKEN", "secret");
    vi.stubEnv(
      "PUBLIC_API_ALLOWED_ORIGINS",
      "https://myagent.example.com,https://other.example.com",
    );
    const result = checkPublicApiAuth(
      req({ authorization: "Bearer secret", origin: "https://myagent.example.com" }),
    );
    expect(result.corsHeaders["access-control-allow-origin"]).toBe("https://myagent.example.com");
  });

  it("does not reflect an origin outside the allowlist", () => {
    vi.stubEnv("PUBLIC_API_TOKEN", "secret");
    vi.stubEnv("PUBLIC_API_ALLOWED_ORIGINS", "https://myagent.example.com");
    const result = checkPublicApiAuth(
      req({ authorization: "Bearer secret", origin: "https://evil.example.com" }),
    );
    expect(result.corsHeaders["access-control-allow-origin"]).not.toBe("https://evil.example.com");
  });
});
