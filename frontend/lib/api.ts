import type { Order } from "./types";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export function apiErrorMessage(body: unknown): string {
  if (!body || typeof body !== "object") return "Request failed.";
  const payload = body as { error?: unknown; detail?: unknown };
  if (typeof payload.error === "string") return payload.error;
  if (typeof payload.detail === "string") return payload.detail;
  if (Array.isArray(payload.detail)) {
    const messages = payload.detail.flatMap((item) =>
      item && typeof item === "object" && typeof item.msg === "string"
        ? [item.msg]
        : [],
    );
    return messages.join("; ") || "Request failed.";
  }
  return "Request failed.";
}

export function retryableMutationError(error: unknown): boolean {
  return (
    !(error instanceof ApiError) ||
    error.status >= 500 ||
    [408, 425, 429].includes(error.status)
  );
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1/${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), accept: "application/json" },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(apiErrorMessage(body), response.status);
  }
  return body as T;
}

export function orderIntent(
  symbol: "DEMO" | "SAMPLE",
  side: "BUY" | "SELL",
  quantity: number,
  key: string,
) {
  return api<Order>("orders", {
    method: "POST",
    headers: { "Idempotency-Key": key, "content-type": "application/json" },
    body: JSON.stringify({ symbol, side, quantity }),
  });
}

export function predictionOrderIntent(
  marketId: string,
  outcome: "YES" | "NO",
  quantity: number,
  key: string,
) {
  return api<import("./types").PredictionOrder>("prediction/orders", {
    method: "POST",
    headers: { "Idempotency-Key": key, "content-type": "application/json" },
    body: JSON.stringify({ market_id: marketId, outcome, quantity }),
  });
}
