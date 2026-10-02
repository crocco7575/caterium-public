import type { Order } from "./types";

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1/${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), accept: "application/json" },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw new ApiError(body.error || "Request failed.", response.status);
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
