import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, retryableMutationError } from "../lib/api";
import { getPaperDashboard, runPaperStrategy } from "../lib/paper";

afterEach(() => vi.restoreAllMocks());

describe("paper strategy client contract", () => {
  it("reuses the exact idempotency key and payload for retries", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "run-1", status: "COMPLETED" }), {
          status: 200,
        }),
      );
    await runPaperStrategy("example-yes", "paper-retry-key");
    await runPaperStrategy("example-yes", "paper-retry-key");
    const first = fetchSpy.mock.calls[0]?.[1];
    const second = fetchSpy.mock.calls[1]?.[1];
    expect(new Headers(first?.headers).get("idempotency-key")).toBe(
      "paper-retry-key",
    );
    expect(new Headers(second?.headers).get("idempotency-key")).toBe(
      "paper-retry-key",
    );
    expect(first?.body).toBe(second?.body);
    expect(first?.body).toBe(JSON.stringify({ strategy_id: "example-yes" }));
  });

  it("keeps transport failures retryable but treats definitive responses as final", () => {
    expect(retryableMutationError(new TypeError("offline"))).toBe(true);
    expect(retryableMutationError(new ApiError("busy", 503))).toBe(true);
    expect(retryableMutationError(new ApiError("invalid strategy", 422))).toBe(
      false,
    );
    expect(retryableMutationError(new ApiError("conflict", 409))).toBe(false);
  });

  it("uses the paper dashboard route and preserves preview-only metadata", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          demo: true,
          mode: "synthetic_fixture",
          delivery: "preview_only",
          strategies: [],
          runs: [],
        }),
        { status: 200 },
      ),
    );
    const dashboard = await getPaperDashboard();
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("/api/v1/paper/dashboard");
    expect(dashboard.mode).toBe("synthetic_fixture");
    expect(dashboard.delivery).toBe("preview_only");
  });
});
