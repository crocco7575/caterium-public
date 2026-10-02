import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  GET,
  POST,
  allowedPath,
  mutationOriginAllowed,
} from "../app/api/v1/[...path]/route";

const orderId = "123e4567-e89b-12d3-a456-426614174000";
const context = (path: string[]) => ({ params: Promise.resolve({ path }) });
type NextInit = {
  method?: string;
  headers?: HeadersInit;
  body?: BodyInit | null;
  signal?: AbortSignal;
};
const request = (url: string, init?: NextInit) =>
  new NextRequest(`http://localhost:3000${url}`, {
    ...init,
    headers: { Host: "localhost:3000", ...(init?.headers ?? {}) },
  });
const origin = { Origin: "http://localhost:3000" };

beforeEach(() => vi.restoreAllMocks());

describe("proxy guards", () => {
  it("allows documented reads and strict order actions only", () => {
    expect(allowedPath(["dashboard"])).toBe(true);
    expect(allowedPath(["events", "stream"])).toBe(true);
    expect(allowedPath(["orders", orderId, "fill"])).toBe(true);
    expect(allowedPath(["orders", "not-an-id", "fill"])).toBe(false);
    expect(allowedPath(["private", "config"])).toBe(false);
    expect(allowedPath(["paper", "dashboard"])).toBe(true);
    expect(allowedPath(["paper", "runs"])).toBe(true);
    expect(allowedPath(["paper", "send-email"])).toBe(false);
  });

  it("guards paper tests with origin, JSON, and bounded body checks", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const options = { method: "POST", body: "{}" };
    const missingOrigin = await POST(
      request("/api/v1/paper/runs", options),
      context(["paper", "runs"]),
    );
    const missingJson = await POST(
      request("/api/v1/paper/runs", { ...options, headers: origin }),
      context(["paper", "runs"]),
    );
    const oversized = await POST(
      request("/api/v1/paper/runs", {
        ...options,
        headers: { ...origin, "content-type": "application/json" },
        body: "x".repeat(4097),
      }),
      context(["paper", "runs"]),
    );
    expect(missingOrigin.status).toBe(403);
    expect(missingJson.status).toBe(415);
    expect(oversized.status).toBe(413);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects mutation methods and remote origins before upstream fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const methodResponse = await POST(
      request("/api/v1/orders", { method: "PUT", headers: origin }),
      context(["orders"]),
    );
    const originResponse = await POST(
      request("/api/v1/orders", {
        method: "POST",
        headers: {
          ...origin,
          Origin: "https://remote.invalid",
          "content-type": "application/json",
        },
        body: "{}",
      }),
      context(["orders"]),
    );
    expect(methodResponse.status).toBe(405);
    expect(originResponse.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(
      mutationOriginAllowed(
        request("/api/v1/orders", { method: "POST", headers: origin }),
      ),
    ).toBe(true);
    expect(
      mutationOriginAllowed(
        request("/api/v1/orders", {
          method: "POST",
          headers: { Origin: "http://evil.test", Host: "localhost:3000" },
        }),
      ),
    ).toBe(false);
  });

  it("rejects order bodies without JSON content type", async () => {
    const response = await POST(
      request("/api/v1/orders", {
        method: "POST",
        headers: origin,
        body: "{}",
      }),
      context(["orders"]),
    );
    expect(response.status).toBe(415);
  });

  it("bounds streamed request bodies at 4 KiB", async () => {
    const response = await POST(
      request("/api/v1/orders", {
        method: "POST",
        headers: { ...origin, "content-type": "application/json" },
        body: "x".repeat(4097),
      }),
      context(["orders"]),
    );
    expect(response.status).toBe(413);
  });

  it("rejects an oversized declared body before forwarding", async () => {
    const response = await POST(
      request("/api/v1/orders", {
        method: "POST",
        headers: {
          ...origin,
          "content-type": "application/json",
          "content-length": "4097",
        },
        body: "{}",
      }),
      context(["orders"]),
    );
    expect(response.status).toBe(413);
  });
});

describe("proxy upstream behavior", () => {
  it("forwards Last-Event-ID and returns SSE", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("event: heartbeat\n\n", {
        headers: { "content-type": "text/event-stream" },
      }),
    );
    const response = await GET(
      request("/api/v1/events/stream", { headers: { "Last-Event-ID": "42" } }),
      context(["events", "stream"]),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const forwarded = fetchSpy.mock.calls[0]?.[1]?.headers as Headers;
    expect(forwarded.get("last-event-id")).toBe("42");
  });

  it("sanitizes upstream failures", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("private host and credentials"),
    );
    const response = await GET(
      request("/api/v1/dashboard"),
      context(["dashboard"]),
    );
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Backend unavailable" });
  });

  it("aborts upstream work when the client aborts", async () => {
    let signal: AbortSignal | undefined;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>(() => undefined);
    });
    const controller = new AbortController();
    const pending = GET(
      new Request("http://localhost:3000/api/v1/events/stream", {
        signal: controller.signal,
      }) as unknown as NextRequest,
      context(["events", "stream"]),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(signal?.aborted).toBe(true);
    void pending;
  });
});
