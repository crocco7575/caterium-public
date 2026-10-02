"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, ApiError, orderIntent } from "../lib/api";
import type { DashboardData, Order, SymbolCode, Side } from "../lib/types";

const money = (value?: string) =>
  value
    ? `$${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : "—";
const time = (value: string) =>
  new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(value));

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [symbol, setSymbol] = useState<SymbolCode>("DEMO");
  const [side, setSide] = useState<Side>("BUY");
  const [quantity, setQuantity] = useState(1);
  const [notice, setNotice] = useState<string | null>(null);
  const [sseState, setSseState] = useState<"connecting" | "live" | "offline">(
    "connecting",
  );
  const [lastEventId, setLastEventId] = useState(0);
  const [pendingLabel, setPendingLabel] = useState<string | null>(null);
  const lastEventRef = useRef(0);
  const pendingIntent = useRef<{
    key: string;
    label: string;
    run: () => Promise<Order>;
  } | null>(null);

  const refresh = useCallback(async () => {
    try {
      setData(await api<DashboardData>("dashboard"));
      setError(null);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to reach the demo backend.",
      );
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(timer);
  }, [refresh]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const source = new EventSource("/api/v1/events/stream");
    const schedule = (event: Event) => {
      const id = Number((event as MessageEvent).lastEventId || 0);
      if (id && id <= lastEventRef.current) return;
      if (id) {
        lastEventRef.current = id;
        setLastEventId(id);
      }
      setSseState("live");
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 250);
    };
    source.addEventListener("domain", schedule);
    source.addEventListener("heartbeat", () => setSseState("live"));
    source.onopen = () => {
      setSseState("live");
      void refresh();
    };
    source.onerror = () => {
      setSseState("offline");
      setError(
        "Live updates disconnected. Displayed values may be stale; reconnecting.",
      );
    };
    return () => {
      clearTimeout(timer);
      source.close();
    };
  }, [refresh]);

  const submit = async (strategy = false) => {
    setBusy(true);
    setNotice(null);
    const existing = pendingIntent.current;
    if (existing) {
      try {
        const result = await existing.run();
        pendingIntent.current = null;
        setPendingLabel(null);
        setNotice(
          result.status === "REJECTED"
            ? `${existing.label} rejected: ${result.rejection_reason ?? "business rule"}.`
            : `${existing.label} submitted.`,
        );
        await refresh();
      } catch (e) {
        if (!(e instanceof ApiError) || e.status < 500) {
          pendingIntent.current = null;
          setPendingLabel(null);
        }
        setNotice("Retry failed; the original intent remains unresolved.");
      } finally {
        setBusy(false);
      }
      return;
    }
    if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000000) {
      setNotice("Quantity must be a whole number from 1 to 1,000,000.");
      setBusy(false);
      return;
    }
    const label = strategy
      ? "ExampleStrategy"
      : `${side} ${quantity} ${symbol}`;
    try {
      const key = pendingIntent.current?.key ?? crypto.randomUUID();
      const run = () =>
        strategy
          ? api<Order>("strategies/example/run", {
              method: "POST",
              headers: { "Idempotency-Key": key },
            })
          : orderIntent(symbol, side, quantity, key);
      pendingIntent.current = { key, label, run };
      const result = await run();
      pendingIntent.current = null;
      setPendingLabel(null);
      setNotice(
        result.status === "REJECTED"
          ? `${label} rejected: ${result.rejection_reason ?? "business rule"}.`
          : `${label} submitted.`,
      );
      await refresh();
    } catch (e) {
      const definitive = e instanceof ApiError && e.status < 500;
      if (definitive) {
        pendingIntent.current = null;
        setPendingLabel(null);
      } else {
        setPendingLabel(label);
      }
      const message =
        e instanceof ApiError && e.status >= 500
          ? "Transport failed. Retry the same intent or start a new one."
          : e instanceof Error
            ? e.message
            : "Order request failed.";
      setNotice(message);
    } finally {
      setBusy(false);
    }
  };

  const dismissPending = () => {
    pendingIntent.current = null;
    setPendingLabel(null);
    setNotice(
      "Unresolved intent dismissed. Verify the ledger before submitting a new order.",
    );
  };

  const mutate = async (id: string, action: "fill" | "cancel") => {
    setBusy(true);
    setNotice(null);
    try {
      await api<Order>(`orders/${id}/${action}`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
      });
      setNotice(`Order ${action} request accepted.`);
      await refresh();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : `Unable to ${action} order.`);
    } finally {
      setBusy(false);
    }
  };

  const positions = useMemo(
    () =>
      data?.positions.filter((p) => p.quantity || p.reserved_quantity) ?? [],
    [data],
  );

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <Image
            src="/caterium-logo.png"
            alt="Caterium"
            width={632}
            height={388}
            sizes="58px"
            className="brand-logo"
            unoptimized
          />
          <span>
            CATERIUM<span className="brand-slash">/</span>PUBLIC
          </span>
        </div>
        <div className="top-meta">
          <span className="live-dot" /> DEMO ENVIRONMENT{" "}
          <span className="top-version">v0.1</span>
        </div>
      </header>
      <section className="notice-banner">
        <span className="notice-icon">◆</span>
        <div>
          <strong>SYNTHETIC DATA / NO REAL ORDERS</strong>
          <span>
            Every balance, quote, fill, and event below is fictional and
            isolated from any broker.
          </span>
        </div>
        <span className="notice-pill">READ ONLY MARKET</span>
      </section>
      <div className="workspace-heading">
        <div>
          <p className="eyebrow">
            ENGINEERING WORKSPACE <span>•</span> ACCOUNT{" "}
            {data?.account.id ?? "demo-account"}
          </p>
          <h1>Follow every order.</h1>
          <p className="lede">
            Place simulated trades and watch your demo portfolio update.
          </p>
        </div>
        <div className="connection">
          <span
            className={
              error
                ? "status-dot offline"
                : data
                  ? "status-dot online"
                  : "status-dot"
            }
          />{" "}
          {error
            ? "BACKEND OFFLINE"
            : data
              ? "BACKEND CONNECTED"
              : "CONNECTING"}
          <small>SSE: {sseState}</small>
        </div>
      </div>
      {error && (
        <div className="error-state">
          <strong>Connection needs attention</strong>
          <span>{error}</span>
          <button onClick={() => void refresh()}>Retry connection</button>
        </div>
      )}
      {notice && (
        <div className="toast" role="status">
          {notice}
        </div>
      )}
      <section className="quote-grid">
        <Quote symbol="DEMO" price="100.00" tone="teal" />
        <Quote symbol="SAMPLE" price="25.00" tone="amber" />
        <div className="quote-context">
          <span>FIXED SYNTHETIC QUOTES</span>
          <strong>Two symbols. Zero market noise.</strong>
          <p>
            These constants make the lifecycle easy to inspect and the result
            easy to reproduce.
          </p>
        </div>
      </section>
      <section className="metrics-grid">
        <Metric
          label="ACCOUNT EQUITY"
          value={money(data?.account.equity)}
          sub={data ? "Synthetic USD" : "Waiting for API"}
        />
        <Metric
          label="AVAILABLE CASH"
          value={money(data?.account.available_cash)}
          sub={
            data
              ? `${money(data.account.reserved_cash)} reserved`
              : "Waiting for API"
          }
        />
        <Metric
          label="OPEN POSITIONS"
          value={data ? String(positions.length).padStart(2, "0") : "—"}
          sub="Inventory-backed"
        />
        <Metric
          label="EVENT CURSOR"
          value={
            lastEventId
              ? `#${lastEventId}`
              : data?.events[0]
                ? `#${data.events[0].id}`
                : "—"
          }
          sub="Persisted domain events"
        />
      </section>
      <div className="content-grid">
        <section className="panel order-panel">
          <PanelTitle
            index="01"
            title="Order ticket"
            label="MUTATION SURFACE"
          />
          <div className="segmented">
            <button
              disabled={Boolean(pendingLabel)}
              className={side === "BUY" ? "selected buy" : ""}
              onClick={() => setSide("BUY")}
            >
              BUY
            </button>
            <button
              disabled={Boolean(pendingLabel)}
              className={side === "SELL" ? "selected sell" : ""}
              onClick={() => setSide("SELL")}
            >
              SELL
            </button>
          </div>
          <label>
            SYMBOL
            <select
              disabled={Boolean(pendingLabel)}
              value={symbol}
              onChange={(e) => setSymbol(e.target.value as SymbolCode)}
            >
              <option value="DEMO">DEMO — $100.00</option>
              <option value="SAMPLE">SAMPLE — $25.00</option>
            </select>
          </label>
          <label>
            QUANTITY
            <div className="quantity">
              <button
                disabled={Boolean(pendingLabel)}
                aria-label="Decrease quantity"
                onClick={() => setQuantity(Math.max(1, quantity - 1))}
              >
                −
              </button>
              <input
                disabled={Boolean(pendingLabel)}
                aria-label="Order quantity"
                type="number"
                min="1"
                max="1000000"
                step="1"
                value={quantity}
                onChange={(e) => setQuantity(Number(e.target.value))}
              />
              <button
                disabled={Boolean(pendingLabel)}
                aria-label="Increase quantity"
                onClick={() => setQuantity(Math.min(1000000, quantity + 1))}
              >
                +
              </button>
            </div>
          </label>
          <div className="ticket-total">
            <span>ESTIMATED NOTIONAL</span>
            <strong>
              {money(
                (
                  Number(symbol === "DEMO" ? 100 : 25) *
                  (Number.isFinite(quantity) ? quantity : 0)
                ).toFixed(2),
              )}
            </strong>
          </div>
          <button
            className="primary-action"
            disabled={busy}
            onClick={() => void submit()}
          >
            {busy
              ? "Working…"
              : pendingLabel
                ? `Retry ${pendingLabel}`
                : `Submit ${side} order`}{" "}
            <span>↗</span>
          </button>
          <button
            className="example-action"
            disabled={busy || Boolean(pendingLabel)}
            onClick={() => void submit(true)}
          >
            Run ExampleStrategy <span>→</span>
          </button>
          {pendingLabel && (
            <button
              className="dismiss-action"
              disabled={busy}
              onClick={dismissPending}
            >
              Dismiss unresolved intent
            </button>
          )}
          <p className="idempotency">
            ↳{" "}
            {pendingLabel
              ? "Retry reuses the same key; dismiss only after checking the ledger."
              : "A fresh idempotency key is issued for every intent."}
          </p>
        </section>
        <section className="panel account-panel">
          <PanelTitle
            index="02"
            title="Account state"
            label="LIVE PROJECTION"
          />
          <div className="account-total">
            <span>NET LIQUIDATION VALUE</span>
            <strong>{money(data?.account.equity)}</strong>
            <em>USD</em>
          </div>
          <div className="account-lines">
            <AccountLine label="Cash" value={money(data?.account.cash)} />
            <AccountLine
              label="Reserved cash"
              value={money(data?.account.reserved_cash)}
              accent
            />
            <AccountLine
              label="Available cash"
              value={money(data?.account.available_cash)}
            />
            <AccountLine
              label="Currency"
              value={data?.account.currency ?? "—"}
            />
          </div>
          <div className="mini-caption">
            Reservation is released on fill or cancel.
          </div>
        </section>
        <section className="panel positions-panel">
          <PanelTitle index="03" title="Positions" label="INVENTORY" />
          {positions.length ? (
            <div className="table">
              <div className="table-head">
                <span>SYMBOL</span>
                <span>QTY</span>
                <span>AVG / MARK</span>
                <span>VALUE</span>
              </div>
              {positions.map((p) => (
                <div className="table-row" key={p.symbol}>
                  <strong>{p.symbol}</strong>
                  <span>
                    {p.quantity}
                    <small> / {p.reserved_quantity} res.</small>
                  </span>
                  <span>
                    {money(p.average_price)}{" "}
                    <small>→ {money(p.market_price)}</small>
                  </span>
                  <b>{money(p.market_value)}</b>
                </div>
              ))}
            </div>
          ) : (
            <Empty
              label="No inventory held"
              detail="Filled demo orders will appear here."
            />
          )}
        </section>
      </div>
      <section className="panel orders-panel">
        <PanelTitle index="04" title="Order ledger" label="NEWEST FIRST" />
        {data?.orders.length ? (
          <div className="orders-list">
            {data.orders.map((o) => (
              <div className="order-row" key={o.id}>
                <div className="order-main">
                  <span className={`side-tag ${o.side.toLowerCase()}`}>
                    {o.side}
                  </span>
                  <strong>
                    {o.quantity} {o.symbol}
                  </strong>
                  <span className="order-price">at {money(o.price)}</span>
                  {o.rejection_reason && (
                    <span className="order-price">· {o.rejection_reason}</span>
                  )}
                </div>
                <div className="order-actions">
                  <span className={`state ${o.status.toLowerCase()}`}>
                    {o.status}
                  </span>
                  {o.status === "SUBMITTED" && (
                    <>
                      <button
                        disabled={busy}
                        onClick={() => void mutate(o.id, "fill")}
                      >
                        Fill
                      </button>
                      <button
                        disabled={busy}
                        onClick={() => void mutate(o.id, "cancel")}
                      >
                        Cancel
                      </button>
                    </>
                  )}
                  <time>{time(o.updated_at)}</time>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <Empty
            label="No orders yet"
            detail="Submit a synthetic order to inspect its lifecycle."
          />
        )}
      </section>
      <div className="lower-grid">
        <section className="panel events-panel">
          <PanelTitle index="05" title="Event stream" label="PERSISTED + SSE" />
          {data?.events.length ? (
            <div className="event-list">
              {data.events.slice(0, 8).map((event) => (
                <div className="event-row" key={event.id}>
                  <span className="event-id">#{event.id}</span>
                  <div>
                    <strong>{event.type}</strong>
                    <p>{event.message}</p>
                  </div>
                  <time>{time(event.created_at)}</time>
                </div>
              ))}
            </div>
          ) : (
            <Empty
              label="Waiting for domain events"
              detail="Lifecycle transitions will be projected here."
            />
          )}
        </section>
        <section className="panel strategy-panel">
          <PanelTitle
            index="06"
            title="Strategy descriptor"
            label="DEMO ONLY"
          />
          <div className="strategy-name">
            <span className="strategy-glyph">✦</span>
            <div>
              <strong>{data?.strategy.name ?? "ExampleStrategy"}</strong>
              <small>{data?.strategy.status ?? "DEMO_ONLY"}</small>
            </div>
          </div>
          <p>
            {data?.strategy.description ??
              "A deliberately trivial constant action for demonstrating the order service."}
          </p>
          <div className="strategy-rule">
            <span>RULE</span>
            <strong>BUY 1 DEMO</strong>
            <small>Not a trading signal.</small>
          </div>
        </section>
      </div>
      <footer>
        <span>CATERIUM / PUBLIC ENGINEERING WORKSPACE</span>
        <span>
          ALL OUTPUTS SYNTHETIC <i>•</i> NO BROKER CONNECTION
        </span>
      </footer>
    </main>
  );
}

function Quote({
  symbol,
  price,
  tone,
}: {
  symbol: string;
  price: string;
  tone: string;
}) {
  return (
    <div className={`quote-card ${tone}`}>
      <span className="quote-symbol">{symbol}</span>
      <strong>${price}</strong>
      <span className="quote-change">FIXED PRICE</span>
      <div className="flat-mark" aria-hidden="true" />
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
function PanelTitle({
  index,
  title,
  label,
}: {
  index: string;
  title: string;
  label: string;
}) {
  return (
    <div className="panel-title">
      <div>
        <span>{index}</span>
        <h2>{title}</h2>
      </div>
      <small>{label}</small>
    </div>
  );
}
function AccountLine({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className={accent ? "account-line accent" : "account-line"}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
function Empty({ label, detail }: { label: string; detail: string }) {
  return (
    <div className="empty">
      <span>∅</span>
      <strong>{label}</strong>
      <p>{detail}</p>
    </div>
  );
}
