import { NextRequest } from "next/server";

const API_BASE_URL = process.env.API_BASE_URL ?? "http://localhost:8000";
const MAX_BODY_BYTES = 4096;
const REST_TIMEOUT_MS = 10000;
const ALLOWED_PATHS = new Set([
  "health",
  "dashboard",
  "account",
  "positions",
  "orders",
  "events",
  "events/stream",
  "strategies",
  "strategies/example/run",
  "prediction/dashboard",
  "prediction/markets",
  "prediction/orders",
  "paper/dashboard",
  "paper/runs",
]);

export function allowedPath(path: string[]) {
  const normalized = path.join("/");
  return (
    ALLOWED_PATHS.has(normalized) ||
    /^orders\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/(fill|cancel)$/i.test(
      normalized,
    ) ||
    /^prediction\/orders\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/(fill|cancel)$/i.test(
      normalized,
    ) ||
    /^prediction\/markets\/(demo-launch|demo-rain)\/settle$/.test(normalized)
  );
}

async function readBoundedBody(request: NextRequest) {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES)
    throw new Error("payload too large");
  const reader = request.body?.getReader();
  if (!reader) return undefined;
  const chunks: Uint8Array[] = [];
  let total = 0;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void reader.cancel();
  }, REST_TIMEOUT_MS);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) throw new Error("payload too large");
      chunks.push(value);
    }
    if (timedOut) throw new Error("request body timeout");
  } catch (error) {
    await reader.cancel();
    throw error;
  } finally {
    clearTimeout(timer);
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

export function mutationOriginAllowed(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  if (process.env.PUBLIC_ORIGIN) return origin === process.env.PUBLIC_ORIGIN;
  const host = request.headers.get("host");
  if (!host) return false;
  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(origin);
  } catch {
    return false;
  }
  if (parsedOrigin.protocol !== "http:" || parsedOrigin.host !== host)
    return false;
  return ["localhost", "127.0.0.1", "[::1]"].includes(parsedOrigin.hostname);
}

export async function proxy(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params;
  if (!allowedPath(path))
    return Response.json({ error: "Not found" }, { status: 404 });
  const isStream = path.join("/") === "events/stream";
  const isMutation = request.method !== "GET" && request.method !== "HEAD";
  if (isMutation && request.method !== "POST")
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  if (isMutation && !mutationOriginAllowed(request))
    return Response.json({ error: "Origin not allowed" }, { status: 403 });
  if (
    isMutation &&
    (["orders", "prediction/orders", "paper/runs"].includes(path.join("/")) ||
      /^prediction\/markets\/(demo-launch|demo-rain)\/settle$/.test(
        path.join("/"),
      )) &&
    request.headers.get("content-type")?.split(";")[0] !== "application/json"
  )
    return Response.json({ error: "JSON required" }, { status: 415 });
  let body: string | undefined;
  try {
    body = await readBoundedBody(request);
  } catch {
    return Response.json({ error: "Payload too large" }, { status: 413 });
  }
  const upstream = new URL(
    `${API_BASE_URL.replace(/\/$/, "")}/api/v1/${path.join("/")}`,
  );
  new URL(request.url).searchParams.forEach((value, key) =>
    upstream.searchParams.set(key, value),
  );
  const headers = new Headers();
  for (const name of [
    "accept",
    "content-type",
    "idempotency-key",
    "last-event-id",
  ]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const controller = new AbortController();
  request.signal.addEventListener("abort", () => controller.abort(), {
    once: true,
  });
  const timeout = isStream
    ? undefined
    : setTimeout(() => controller.abort(), REST_TIMEOUT_MS);
  try {
    const response = await fetch(upstream, {
      method: request.method,
      headers,
      body,
      signal: controller.signal,
      cache: "no-store",
    });
    const outputHeaders = new Headers();
    for (const name of ["content-type", "cache-control"]) {
      const value = response.headers.get(name);
      if (value) outputHeaders.set(name, value);
    }
    return new Response(response.body, {
      status: response.status,
      headers: outputHeaders,
    });
  } catch {
    if (controller.signal.aborted && request.signal.aborted)
      return new Response(null, { status: 499 });
    return Response.json({ error: "Backend unavailable" }, { status: 502 });
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export const GET = proxy;
export const POST = proxy;
