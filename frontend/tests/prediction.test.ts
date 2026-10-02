import { afterEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import {
  POST,
  allowedPath,
  mutationOriginAllowed,
} from "../app/api/v1/[...path]/route";
import {
  ApiError,
  apiErrorMessage,
  predictionOrderIntent,
  retryableMutationError,
} from "../lib/api";
import { vi } from "vitest";

const uuid = "123e4567-e89b-12d3-a456-426614174000";
afterEach(() => vi.restoreAllMocks());

describe("prediction proxy boundaries", () => {
  it.each([
    ["prediction", "orders"],
    ["prediction", "markets", "demo-launch", "settle"],
  ])("checks JSON, origin, and size before forwarding %j", async (...path) => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    for (const [headers, body, expected] of [
      [{ origin: "http://localhost:3000" }, "{}", 415],
      [
        {
          origin: "https://foreign.invalid",
          "content-type": "application/json",
        },
        "{}",
        403,
      ],
      [
        { origin: "http://localhost:3000", "content-type": "application/json" },
        "x".repeat(4097),
        413,
      ],
    ] as const) {
      const request = new NextRequest(
        `http://localhost:3000/api/v1/${path.join("/")}`,
        {
          method: "POST",
          headers: { host: "localhost:3000", ...headers },
          body,
        },
      );
      const response = await POST(request, {
        params: Promise.resolve({ path }),
      });
      expect(response.status).toBe(expected);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("forwards a prediction order body and its idempotency key unchanged", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}", { status: 201 }));
    const body = JSON.stringify({
      market_id: "demo-launch",
      outcome: "YES",
      quantity: 3,
    });
    const request = new NextRequest(
      "http://localhost:3000/api/v1/prediction/orders",
      {
        method: "POST",
        body,
        headers: {
          host: "localhost:3000",
          origin: "http://localhost:3000",
          "content-type": "application/json",
          "idempotency-key": "same-intent",
        },
      },
    );
    const result = await POST(request, {
      params: Promise.resolve({ path: ["prediction", "orders"] }),
    });
    expect(result.status).toBe(201);
    const init = fetchSpy.mock.calls[0]?.[1];
    expect(init?.body).toBe(body);
    expect(new Headers(init?.headers).get("idempotency-key")).toBe(
      "same-intent",
    );
  });

  it("allows only the documented prediction routes", () => {
    expect(allowedPath(["prediction", "dashboard"])).toBe(true);
    expect(allowedPath(["prediction", "orders"])).toBe(true);
    expect(allowedPath(["prediction", "orders", uuid, "fill"])).toBe(true);
    expect(
      allowedPath(["prediction", "markets", "demo-launch", "settle"]),
    ).toBe(true);
    expect(allowedPath(["prediction", "markets", "other", "settle"])).toBe(
      false,
    );
    expect(allowedPath(["prediction", "orders", "not-an-id", "cancel"])).toBe(
      false,
    );
  });

  it("requires a same-origin mutation", () => {
    const request = (origin: string) =>
      new Request("http://localhost:3000/api/v1/prediction/orders", {
        method: "POST",
        headers: { origin, host: "localhost:3000" },
      });
    expect(
      mutationOriginAllowed(request("http://localhost:3000") as never),
    ).toBe(true);
    expect(
      mutationOriginAllowed(request("https://evil.invalid") as never),
    ).toBe(false);
  });
});

describe("safe API errors", () => {
  it("extracts string and validation-array details without exposing raw payloads", () => {
    expect(apiErrorMessage({ detail: "Market is settled" })).toBe(
      "Market is settled",
    );
    expect(
      apiErrorMessage({
        detail: [
          { loc: ["body"], msg: "Invalid outcome", type: "value_error" },
        ],
      }),
    ).toBe("Invalid outcome");
    expect(apiErrorMessage({ detail: [{ bad: "secret" }] })).toBe(
      "Request failed.",
    );
  });
});

describe("prediction request idempotency", () => {
  it("retains uncertain intent failures but clears definitive validation failures", () => {
    expect(retryableMutationError(new TypeError("network unavailable"))).toBe(
      true,
    );
    for (const status of [408, 425, 429, 500, 502, 504]) {
      expect(retryableMutationError(new ApiError("unconfirmed", status))).toBe(
        true,
      );
    }
    for (const status of [400, 403, 404, 409, 422]) {
      expect(retryableMutationError(new ApiError("rejected", status))).toBe(
        false,
      );
    }
  });
  it("preserves the same key and payload when an intent is retried", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: uuid, status: "SUBMITTED" }), {
        status: 201,
      }),
    );
    await predictionOrderIntent("demo-launch", "YES", 7, "retry-key");
    await predictionOrderIntent("demo-launch", "YES", 7, "retry-key");
    const first = fetchSpy.mock.calls[0]?.[1];
    const second = fetchSpy.mock.calls[1]?.[1];
    expect(new Headers(first?.headers).get("idempotency-key")).toBe(
      "retry-key",
    );
    expect(new Headers(second?.headers).get("idempotency-key")).toBe(
      "retry-key",
    );
    expect(first?.body).toBe(second?.body);
    vi.restoreAllMocks();
  });
});
