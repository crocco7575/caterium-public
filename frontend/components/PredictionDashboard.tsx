"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  ApiError,
  predictionOrderIntent,
  retryableMutationError,
} from "../lib/api";
import type {
  PredictionDashboardData,
  PredictionMarket,
  PredictionOrder,
} from "../lib/types";

const money = (value?: string) =>
  value === undefined
    ? "—"
    : `$${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const price = (value: string) => `${Math.round(Number(value) * 100)}¢`;
const when = (value: string) =>
  new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));

export default function PredictionDashboard() {
  const [data, setData] = useState<PredictionDashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [marketId, setMarketId] = useState("demo-launch");
  const [outcome, setOutcome] = useState<"YES" | "NO">("YES");
  const [quantity, setQuantity] = useState(1);
  const [settleTarget, setSettleTarget] = useState<PredictionMarket | null>(
    null,
  );
  const [settleResult, setSettleResult] = useState<"YES" | "NO">("YES");
  const abortRef = useRef<AbortController | null>(null);
  const [pendingBuy, setPendingBuy] = useState<{
    key: string;
    marketId: string;
    outcome: "YES" | "NO";
    quantity: number;
  } | null>(null);
  const mutationBusy = useRef(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const refresh = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    try {
      const next = await api<PredictionDashboardData>("prediction/dashboard", {
        signal: controller.signal,
      });
      if (!controller.signal.aborted) {
        setData(next);
        setError(null);
      }
    } catch (e) {
      if (controller.signal.aborted) return;
      setError(
        e instanceof Error ? e.message : "Unable to reach the prediction demo.",
      );
    }
  }, []);

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => void refresh(), 0);
    const poll = () => {
      if (document.visibilityState === "visible" && !mutationBusy.current)
        void refresh();
    };
    const timer = window.setInterval(poll, 10000);
    document.addEventListener("visibilitychange", poll);
    return () => {
      window.clearTimeout(initialRefresh);
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
      abortRef.current?.abort();
    };
  }, [refresh]);

  useEffect(() => {
    if (!settleTarget) return;
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const focusable = () =>
      modalRef.current?.querySelectorAll<HTMLElement>(
        "button:not(:disabled), [href], input, select, textarea",
      ) ?? [];
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSettleTarget(null);
        return;
      }
      if (event.key !== "Tab") return;
      const nodes = Array.from(focusable());
      if (!nodes.length) return;
      const current = document.activeElement;
      const index = nodes.indexOf(current as HTMLElement);
      const next =
        nodes[
          (index + (event.shiftKey ? -1 : 1) + nodes.length) % nodes.length
        ];
      event.preventDefault();
      next?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      restoreFocusRef.current?.focus();
    };
  }, [settleTarget]);

  const selectedMarket = data?.markets.find((market) => market.id === marketId);
  const selectedPrice = selectedMarket
    ? Number(
        outcome === "YES" ? selectedMarket.yes_price : selectedMarket.no_price,
      )
    : 0;
  const positions = useMemo(
    () => data?.positions.filter((position) => position.quantity > 0) ?? [],
    [data],
  );

  const buy = async () => {
    if (mutationBusy.current) return;
    const existing = pendingBuy;
    if (
      error ||
      !data ||
      (!existing && (!selectedMarket || selectedMarket.status !== "OPEN"))
    ) {
      setNotice("Refresh the demo before submitting a mutation.");
      return;
    }
    const pending = existing ?? {
      key: crypto.randomUUID(),
      marketId,
      outcome,
      quantity,
    };
    if (
      !existing &&
      (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000000)
    ) {
      setNotice("Quantity must be a whole number from 1 to 1,000,000.");
      return;
    }
    setPendingBuy(pending);
    mutationBusy.current = true;
    abortRef.current?.abort();
    setBusy(true);
    setNotice(null);
    try {
      const result = await predictionOrderIntent(
        pending.marketId,
        pending.outcome,
        pending.quantity,
        pending.key,
      );
      setPendingBuy(null);
      setNotice(
        result.status === "REJECTED"
          ? `Rejected: ${result.rejection_reason ?? "business rule"}.`
          : `Order confirmed: ${result.status.toLowerCase()} · ${pending.quantity} ${pending.outcome} contract${pending.quantity === 1 ? "" : "s"}.`,
      );
      await refresh();
    } catch (e) {
      if (!retryableMutationError(e)) setPendingBuy(null);
      setNotice(
        retryableMutationError(e)
          ? "The result is unconfirmed. Retry this same order; its key and quantity are preserved."
          : e instanceof ApiError
            ? e.message
            : "Order request failed.",
      );
    } finally {
      mutationBusy.current = false;
      setBusy(false);
    }
  };

  const action = async (order: PredictionOrder, verb: "fill" | "cancel") => {
    if (mutationBusy.current || pendingBuy) return;
    if (error || !data) {
      setNotice("Refresh the demo before changing an order.");
      return;
    }
    mutationBusy.current = true;
    abortRef.current?.abort();
    setBusy(true);
    setNotice(null);
    try {
      await api<PredictionOrder>(`prediction/orders/${order.id}/${verb}`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
      });
      setNotice(`Order ${verb} accepted.`);
      await refresh();
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : `Unable to ${verb} order.`);
    } finally {
      mutationBusy.current = false;
      setBusy(false);
    }
  };

  const settle = async () => {
    if (mutationBusy.current || pendingBuy) return;
    if (error || !data || !settleTarget) {
      setNotice("Refresh the demo before settling a market.");
      return;
    }
    mutationBusy.current = true;
    abortRef.current?.abort();
    setBusy(true);
    setNotice(null);
    try {
      await api<PredictionMarket>(
        `prediction/markets/${settleTarget.id}/settle`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ result: settleResult }),
        },
      );
      setNotice(
        `${settleTarget.title} settled ${settleResult}. Pending orders were cancelled.`,
      );
      setSettleTarget(null);
      await refresh();
    } catch (e) {
      setNotice(
        e instanceof ApiError ? e.message : "Settlement request failed.",
      );
    } finally {
      mutationBusy.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="prediction-view">
      <div className="prediction-heading">
        <div>
          <p className="eyebrow">
            PREDICTION MARKETS <span>•</span> SYNTHETIC ACCOUNT
          </p>
          <h1>Make a call.</h1>
          <p className="lede">
            Buy fixed-price YES or NO contracts in two fictional markets.
          </p>
        </div>
        <div className="demo-chip">
          KALSHI-STYLE DEMO
          <br />
          <small>BUY-ONLY · NO FEES · FIXED QUOTES</small>
        </div>
      </div>
      <div className="prediction-disclaimer" role="note">
        <strong>SIMULATION ONLY</strong>
        <span>
          These markets, quotes, balances, fills, and outcomes are fictional.
          Nothing connects to Kalshi, Alpaca, a broker, or live market data.
        </span>
      </div>
      {error && (
        <div className="error-state">
          <strong>Prediction demo unavailable</strong>
          <span>{error}</span>
          <button onClick={() => void refresh()}>Retry</button>
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
      <div className="prediction-metrics">
        <Metric
          label="AVAILABLE CASH"
          value={money(data?.account.available_cash)}
          sub={`${money(data?.account.reserved_cash)} reserved`}
        />
        <Metric
          label="ACCOUNT EQUITY"
          value={money(data?.account.equity)}
          sub="Fictional USD"
        />
        <Metric
          label="REALIZED P&L"
          value={money(data?.realized_pnl)}
          sub="Synthetic settlement results"
        />
        <Metric
          label="OPEN POSITIONS"
          value={String(
            positions.filter((position) => !position.settled).length,
          ).padStart(2, "0")}
          sub="Winning contracts pay $1"
        />
      </div>
      <div className="prediction-market-grid">
        <section className="panel prediction-markets">
          <PanelTitle title="Markets" label="FIXED SYNTHETIC QUOTES" />
          {data?.markets.map((market) => (
            <button
              disabled={busy || Boolean(pendingBuy)}
              key={market.id}
              className={`market-card ${market.id === marketId ? "selected" : ""}`}
              onClick={() => setMarketId(market.id)}
              aria-pressed={market.id === marketId}
            >
              <span className="market-status">
                {market.status === "OPEN" ? "OPEN" : `SETTLED ${market.result}`}
              </span>
              <strong>{market.title}</strong>
              <small>{market.id}</small>
              <div className="market-prices">
                <span>
                  <b>YES</b>
                  {price(market.yes_price)}
                </span>
                <span>
                  <b>NO</b>
                  {price(market.no_price)}
                </span>
              </div>
            </button>
          )) ?? <Empty text="Loading fictional markets…" />}
        </section>
        <section className="panel prediction-ticket">
          <PanelTitle title="Buy contracts" label="MUTATION SURFACE" />
          <p className="ticket-market">
            {selectedMarket?.title ?? "Select a market"}
          </p>
          <div className="outcome-buttons">
            <button
              className={outcome === "YES" ? "selected yes" : ""}
              onClick={() => setOutcome("YES")}
              disabled={
                selectedMarket?.status !== "OPEN" || busy || Boolean(pendingBuy)
              }
            >
              YES{" "}
              <b>{selectedMarket ? price(selectedMarket.yes_price) : "—"}</b>
            </button>
            <button
              className={outcome === "NO" ? "selected no" : ""}
              onClick={() => setOutcome("NO")}
              disabled={
                selectedMarket?.status !== "OPEN" || busy || Boolean(pendingBuy)
              }
            >
              NO <b>{selectedMarket ? price(selectedMarket.no_price) : "—"}</b>
            </button>
          </div>
          <label>
            QUANTITY
            <div className="quantity">
              <button
                disabled={busy || Boolean(pendingBuy)}
                aria-label="Decrease quantity"
                onClick={() => setQuantity(Math.max(1, quantity - 1))}
              >
                −
              </button>
              <input
                disabled={busy || Boolean(pendingBuy)}
                aria-label="Prediction contract quantity"
                type="number"
                min="1"
                max="1000000"
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
              />
              <button
                disabled={busy || Boolean(pendingBuy)}
                aria-label="Increase quantity"
                onClick={() => setQuantity(Math.min(1000000, quantity + 1))}
              >
                +
              </button>
            </div>
          </label>
          <div className="ticket-total">
            <span>ESTIMATED COST</span>
            <strong>{money((selectedPrice * quantity).toFixed(2))}</strong>
          </div>
          <button
            className="primary-action"
            disabled={
              busy ||
              Boolean(error) ||
              (!pendingBuy && selectedMarket?.status !== "OPEN")
            }
            onClick={() => void buy()}
          >
            {pendingBuy
              ? busy
                ? "Confirming order…"
                : `Retry ${pendingBuy.outcome} order`
              : selectedMarket?.status === "SETTLED"
                ? "Market settled"
                : busy
                  ? "Working…"
                  : `Buy ${outcome} contracts`}{" "}
            <span>↗</span>
          </button>
          <p className="idempotency">
            {pendingBuy
              ? "Retry keeps the same key and payload until a definitive response."
              : "A fresh idempotency key protects each submitted intent. Quotes are fixed for this demo."}
          </p>
        </section>
      </div>
      <div className="prediction-lower-grid">
        <section className="panel">
          <PanelTitle title="Positions" label="PAYOUT AT SETTLEMENT" />
          {positions.length ? (
            <div className="prediction-list">
              {positions.map((position) => (
                <div
                  className="prediction-row"
                  key={`${position.market_id}-${position.outcome}`}
                >
                  <div>
                    <strong>
                      {position.outcome} · {position.market_id}
                    </strong>
                    <small>
                      {position.quantity} contracts · basis{" "}
                      {money(position.cost_basis)}
                    </small>
                  </div>
                  <b>
                    {position.settled
                      ? `Payout ${money(position.payout)}`
                      : `Value ${money(position.market_value)}`}
                  </b>
                </div>
              ))}
            </div>
          ) : (
            <Empty text="No contracts held yet." />
          )}
        </section>
        <section className="panel">
          <PanelTitle
            title="Outcome simulator"
            label="PERMANENT LOCAL ACTION"
          />
          <p className="muted">
            Choose an outcome only when you want to demonstrate settlement. It
            cancels pending orders and cannot be undone.
          </p>
          {data?.markets
            .filter((m) => m.status === "OPEN")
            .map((market) => (
              <div className="settle-row" key={market.id}>
                <span>{market.id}</span>
                <button
                  disabled={busy || Boolean(error) || Boolean(pendingBuy)}
                  onClick={() => {
                    setSettleTarget(market);
                    setSettleResult("YES");
                  }}
                >
                  Simulate settlement
                </button>
              </div>
            ))}
        </section>
      </div>
      <section className="panel orders-panel">
        <PanelTitle title="Prediction order ledger" label="NEWEST FIRST" />
        {data?.orders.length ? (
          <div className="orders-list">
            {data.orders.map((order) => (
              <div className="order-row" key={order.id}>
                <div className="order-main">
                  <span
                    className={`side-tag ${order.outcome === "YES" ? "buy" : "sell"}`}
                  >
                    {order.outcome}
                  </span>
                  <strong>
                    {order.quantity} · {order.market_id}
                  </strong>
                  <span className="order-price">at {price(order.price)}</span>
                  {order.rejection_reason && (
                    <span className="order-price">
                      · {order.rejection_reason}
                    </span>
                  )}
                </div>
                <div className="order-actions">
                  <span className={`state ${order.status.toLowerCase()}`}>
                    {order.status}
                  </span>
                  {order.status === "SUBMITTED" && (
                    <>
                      <button
                        disabled={busy || Boolean(error) || Boolean(pendingBuy)}
                        onClick={() => void action(order, "fill")}
                      >
                        Fill
                      </button>
                      <button
                        disabled={busy || Boolean(error) || Boolean(pendingBuy)}
                        onClick={() => void action(order, "cancel")}
                      >
                        Cancel
                      </button>
                    </>
                  )}
                  <time>{when(order.updated_at)}</time>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty text="No prediction orders yet." />
        )}
      </section>
      <section className="panel">
        <PanelTitle title="Persisted events" label="LOCAL DEMO HISTORY" />
        {data?.events.length ? (
          <div className="prediction-events">
            {data.events.slice(0, 8).map((event) => (
              <div key={event.id}>
                <span>#{event.id}</span>
                <p>
                  <strong>{event.type}</strong> {event.message}
                </p>
                <time>{when(event.created_at)}</time>
              </div>
            ))}
          </div>
        ) : (
          <Empty text="Waiting for prediction events." />
        )}
      </section>
      {settleTarget && (
        <div className="modal-backdrop" role="presentation">
          <div
            ref={modalRef}
            className="settle-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="settle-title"
          >
            <h2 id="settle-title">Simulate settlement?</h2>
            <p>
              This permanently settles <strong>{settleTarget.title}</strong> as
              a fictional local result. Pending orders will be cancelled and
              reservations released.
            </p>
            <div className="outcome-buttons">
              <button
                disabled={busy}
                className={settleResult === "YES" ? "selected yes" : ""}
                onClick={() => setSettleResult("YES")}
              >
                YES
              </button>
              <button
                disabled={busy}
                className={settleResult === "NO" ? "selected no" : ""}
                onClick={() => setSettleResult("NO")}
              >
                NO
              </button>
            </div>
            <div className="modal-actions">
              <button onClick={() => setSettleTarget(null)}>
                Keep market open
              </button>
              <button
                className="primary-action"
                disabled={busy || Boolean(error) || Boolean(pendingBuy)}
                onClick={() => void settle()}
              >
                SIMULATE SETTLEMENT
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Metric({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{sub}</small>
    </div>
  );
}
function PanelTitle({ title, label }: { title: string; label: string }) {
  return (
    <div className="panel-title">
      <h2>{title}</h2>
      <small>{label}</small>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="empty">
      <span>∅</span>
      <strong>{text}</strong>
    </div>
  );
}
