"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, orderIntent, retryableMutationError } from "../lib/api";
import type { DashboardData, Order, Side, SymbolCode } from "../lib/types";
import s from "./BrokerageDashboard.module.css";

const usd = (v: string | number | undefined) =>
  v === undefined
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
      }).format(Number(v));
const clock = (v: string) =>
  new Date(v).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  });
type Intent = {
  key: string;
  label: string;
  strategy: boolean;
  symbol: SymbolCode;
  side: Side;
  quantity: number;
};

export default function BrokerageDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [updated, setUpdated] = useState<string | null>(null);
  const [stream, setStream] = useState("Connecting");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Intent | null>(null);
  const [symbol, setSymbol] = useState<SymbolCode>("DEMO");
  const [side, setSide] = useState<Side>("BUY");
  const [quantity, setQuantity] = useState("1");
  const lock = useRef(false);
  const refresh = useCallback(async () => {
    try {
      setData(await api<DashboardData>("dashboard"));
      setError(null);
      setUpdated(new Date().toISOString());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Demo API unavailable.");
    }
  }, []);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(
      () => void refresh(),
      0,
    );
    const source = new EventSource("/api/v1/events/stream");
    const changed = () => {
      setStream("Connected");
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 150);
    };
    source.addEventListener("domain", changed);
    source.addEventListener("heartbeat", () => setStream("Connected"));
    source.onopen = changed;
    source.onerror = () => setStream("Reconnecting");
    return () => {
      clearTimeout(timer);
      source.close();
    };
  }, [refresh]);
  const unavailable = !data || Boolean(error);
  const submit = async (strategy = false) => {
    if (lock.current || unavailable) return;
    const n = Number(quantity);
    if (
      !pending &&
      !strategy &&
      (!Number.isSafeInteger(n) || n < 1 || n > 1000000)
    ) {
      setNotice("Enter a whole quantity between 1 and 1,000,000.");
      return;
    }
    const intent: Intent = pending ?? {
      key: crypto.randomUUID(),
      strategy,
      symbol,
      side,
      quantity: strategy ? 1 : n,
      label: strategy ? "ExampleStrategy" : `${side} ${n} ${symbol}`,
    };
    lock.current = true;
    setBusy(true);
    setNotice(null);
    try {
      const result = intent.strategy
        ? await api<Order>("strategies/example/run", {
            method: "POST",
            headers: { "Idempotency-Key": intent.key },
          })
        : await orderIntent(
            intent.symbol,
            intent.side,
            intent.quantity,
            intent.key,
          );
      setPending(null);
      setNotice(
        result.status === "REJECTED"
          ? `${intent.label} rejected: ${result.rejection_reason}.`
          : `${intent.label}: ${result.status.toLowerCase()}.`,
      );
      await refresh();
    } catch (e) {
      setPending(retryableMutationError(e) ? intent : null);
      setNotice(
        retryableMutationError(e)
          ? "Response uncertain. Retry the same request; its key and details are preserved."
          : e instanceof Error
            ? e.message
            : "Request failed.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const mutate = async (order: Order, action: "fill" | "cancel") => {
    if (lock.current || unavailable || pending) return;
    lock.current = true;
    setBusy(true);
    try {
      await api<Order>(`orders/${order.id}/${action}`, { method: "POST" });
      setNotice(`Mock order ${action === "fill" ? "filled" : "cancelled"}.`);
      await refresh();
    } catch (e) {
      setNotice(
        e instanceof Error ? e.message : "Refresh the ledger before retrying.",
      );
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const positions = data?.positions ?? [];
  const holdings = positions.reduce(
    (total, p) => total + Number(p.market_value),
    0,
  );
  const equity = Number(data?.account.equity ?? 0);
  const cashPercent =
    equity > 0 ? (Number(data?.account.cash ?? 0) / equity) * 100 : 0;
  return (
    <main className={s.page}>
      <div className={s.shell}>
        <header className={s.header}>
          <div className={s.brandRow}>
            <div className={s.brand}>
              <Image
                src="/caterium-logo.png"
                alt="Caterium"
                width={632}
                height={388}
                sizes="70px"
                unoptimized
              />
              <div>
                <p className={s.eyebrow}>Caterium Brokerage</p>
                <h1>Paper Strategy Testing</h1>
              </div>
            </div>
            <nav className={s.workspaceNav} aria-label="Caterium workspaces">
              <Link href="/brokerage" aria-current="page">
                Brokerage
              </Link>
              <Link href="/kalshi">Kalshi ↗</Link>
            </nav>
          </div>
          <nav className={s.sectionNav} aria-label="Brokerage sections">
            {["Overview", "Accounts", "Strategies", "Orders", "Events"].map(
              (name) => (
                <a key={name} href={`#${name.toLowerCase()}`}>
                  {name}
                </a>
              ),
            )}
          </nav>
        </header>
        <div className={s.demoNotice}>
          <i />
          Public demo · Synthetic balances and mock fills. Alpaca is not
          connected.
        </div>
        <section className={s.intro} id="overview">
          <div>
            <p className={s.eyebrow}>Command center</p>
            <h2>Portfolio overview</h2>
            <p>
              An Alpaca-based equities brokerage for testing ideas and following
              every order.
            </p>
          </div>
          <span className={s.badge}>PAPER ENVIRONMENT</span>
        </section>
        <section className={s.statusPanel} aria-label="Connection status">
          <div>
            <strong>
              {error
                ? "Connection needs attention"
                : data
                  ? "Demo account synchronized"
                  : "Connecting to demo API…"}
            </strong>
            <p>
              {updated ? `Last updated ${clock(updated)} · ` : ""}Fixed quotes ·
              Event stream: {stream.toLowerCase()}
            </p>
          </div>
          <button onClick={() => void refresh()}>Refresh now ↻</button>
        </section>
        {error && (
          <div role="alert" className={s.error}>
            {error} Displayed figures may be stale; mutations are disabled.
          </div>
        )}
        {notice && (
          <div role="status" className={s.notice}>
            {notice}
          </div>
        )}
        <section className={s.metrics} aria-label="Account metrics">
          <Metric
            label="Accounts"
            value={data ? "01" : "—"}
            detail="Isolated demo account"
          />
          <Metric
            label="Total equity"
            value={usd(data?.account.equity)}
            detail="Fictional USD"
            gold
          />
          <Metric
            label="Total return"
            value={data ? `${((equity / 10000 - 1) * 100).toFixed(2)}%` : "—"}
            detail="Fixed quotes · zero fees"
          />
          <Metric
            label="Available cash"
            value={usd(data?.account.available_cash)}
            detail={`${usd(data?.account.reserved_cash)} reserved`}
          />
          <Metric
            label="Market data"
            value="Synthetic"
            detail="DEMO $100 · SAMPLE $25"
          />
        </section>
        <div className={s.twoColumns}>
          <section className={s.card}>
            <Title eyebrow="Allocation" title="Portfolio composition" />
            <div className={s.balance}>
              {usd(data?.account.equity)}
              <span>Current account value</span>
            </div>
            <div
              className={s.allocation}
              aria-label={`Cash ${cashPercent.toFixed(1)} percent`}
            >
              <span style={{ width: `${cashPercent}%` }} />
            </div>
            <div className={s.legend}>
              <span>
                <i />
                Cash <strong>{usd(data?.account.cash)}</strong>
              </span>
              <span>
                <i />
                Holdings <strong>{data ? usd(holdings) : "—"}</strong>
              </span>
            </div>
            <p className={s.small}>
              Current API state, not an invented performance history. Fixed
              quotes keep the demonstration reproducible.
            </p>
          </section>
          <section className={s.card} id="strategies">
            <Title eyebrow="Linked strategies" title="A transparent example" />
            <div className={s.strategyRow}>
              <span className={s.strategyIcon}>✦</span>
              <div>
                <strong>{data?.strategy.name ?? "ExampleStrategy"}</strong>
                <p>Constant action · BUY 1 DEMO</p>
              </div>
              <span className={s.badge}>DEMO ONLY</span>
            </div>
            <p className={s.small}>
              Demonstrates the order lifecycle through a deliberately trivial
              rule. No private strategy or investment signal is included.
            </p>
            <button
              className={s.goldButton}
              disabled={busy || unavailable || Boolean(pending)}
              onClick={() => void submit(true)}
            >
              Run ExampleStrategy →
            </button>
            <p className={s.small}>
              For prediction-market research, visit the{" "}
              <Link href="/kalshi">Kalshi paper-testing console ↗</Link>
            </p>
          </section>
        </div>
        <section className={s.card} id="accounts">
          <Title eyebrow="Accounts" title="Account summary" />
          <div className={s.tableWrap}>
            <table>
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Cash</th>
                  <th>Available</th>
                  <th>Holdings</th>
                  <th>Equity</th>
                  <th>Quote state</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>{data?.account.id ?? "Loading…"}</td>
                  <td>{usd(data?.account.cash)}</td>
                  <td>{usd(data?.account.available_cash)}</td>
                  <td>{data ? usd(holdings) : "—"}</td>
                  <td className={s.gold}>{usd(data?.account.equity)}</td>
                  <td>
                    <span className={s.badge}>FIXED / MOCK</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
        <div className={s.orderGrid} id="orders">
          <section className={s.card}>
            <Title eyebrow="Mock execution" title="Try an equity order" />
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <fieldset
                disabled={busy || unavailable || Boolean(pending)}
                className={s.fields}
              >
                <label>
                  Side
                  <select
                    value={side}
                    onChange={(e) => setSide(e.target.value as Side)}
                  >
                    <option>BUY</option>
                    <option>SELL</option>
                  </select>
                </label>
                <label>
                  Symbol
                  <select
                    value={symbol}
                    onChange={(e) => setSymbol(e.target.value as SymbolCode)}
                  >
                    <option value="DEMO">DEMO · $100</option>
                    <option value="SAMPLE">SAMPLE · $25</option>
                  </select>
                </label>
                <label>
                  Quantity
                  <input
                    aria-label="Order quantity"
                    type="number"
                    value={quantity}
                    min="1"
                    max="1000000"
                    step="1"
                    onChange={(e) => setQuantity(e.target.value)}
                    required
                  />
                </label>
              </fieldset>
              <button
                className={s.goldButton}
                disabled={busy || unavailable}
                type="submit"
              >
                {busy
                  ? "Working…"
                  : pending
                    ? `Retry ${pending.label}`
                    : "Submit mock order →"}
              </button>
              {pending && (
                <button
                  disabled={busy}
                  type="button"
                  onClick={() => {
                    setPending(null);
                    setNotice(
                      "Unresolved request dismissed. Check the ledger before starting another.",
                    );
                  }}
                >
                  Dismiss unresolved request
                </button>
              )}
            </form>
            <p className={s.small}>
              Cash or shares are reserved first. Use Fill or Cancel in the
              ledger to complete the simulation.
            </p>
          </section>
          <section className={s.card}>
            <Title eyebrow="Orders" title="Recent order activity" />
            <div className={s.tableWrap}>
              <table>
                <thead>
                  <tr>
                    <th>Instrument</th>
                    <th>Size / price</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data?.orders.slice(0, 12).map((order) => (
                    <tr key={order.id}>
                      <td>
                        <strong>{order.symbol}</strong>
                        <small>
                          {order.side} · {clock(order.created_at)}
                        </small>
                      </td>
                      <td>
                        {order.quantity} @ {usd(order.price)}
                      </td>
                      <td>
                        <span className={s.badge}>{order.status}</span>
                        {order.rejection_reason && (
                          <small>{order.rejection_reason}</small>
                        )}
                      </td>
                      <td>
                        {order.status === "SUBMITTED" ? (
                          <div className={s.rowActions}>
                            <button
                              disabled={busy || unavailable || Boolean(pending)}
                              onClick={() => void mutate(order, "fill")}
                            >
                              Fill
                            </button>
                            <button
                              disabled={busy || unavailable || Boolean(pending)}
                              onClick={() => void mutate(order, "cancel")}
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!data?.orders.length && (
                <Empty text="No orders yet. Submit a mock order to begin." />
              )}
            </div>
            <p className={s.small}>Latest 12 of up to 100 recent orders.</p>
          </section>
        </div>
        <div className={s.twoColumns}>
          <section className={s.card}>
            <Title eyebrow="Inventory" title="Open positions" />
            <div className={s.tableWrap}>
              <table>
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Quantity</th>
                    <th>Avg / mark</th>
                    <th>Value</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((p) => (
                    <tr key={p.symbol}>
                      <td>{p.symbol}</td>
                      <td>
                        {p.quantity}
                        <small>{p.reserved_quantity} reserved</small>
                      </td>
                      <td>
                        {usd(p.average_price)} / {usd(p.market_price)}
                      </td>
                      <td>{usd(p.market_value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!positions.length && (
                <Empty text="Mock fills will appear here." />
              )}
            </div>
          </section>
          <section className={s.card} id="events">
            <Title eyebrow="Observability" title="Recent system events" />
            <div className={s.events}>
              {data?.events.slice(0, 5).map((event) => (
                <div className={s.event} key={event.id}>
                  <i />
                  <div>
                    <strong>{event.type.replaceAll("_", " ")}</strong>
                    <p>{event.message}</p>
                  </div>
                  <time>{clock(event.created_at)}</time>
                </div>
              ))}
            </div>
            {!data?.events.length && (
              <Empty text="Waiting for the first committed event." />
            )}
          </section>
        </div>
        <footer className={s.footer}>
          <span>CATERIUM · PUBLIC ENGINEERING DEMO</span>
          <span>Fictional data. No brokerage connection. No real orders.</span>
        </footer>
      </div>
    </main>
  );
}
function Metric({
  label,
  value,
  detail,
  gold = false,
}: {
  label: string;
  value: string;
  detail: string;
  gold?: boolean;
}) {
  return (
    <div className={s.metric}>
      <p>{label}</p>
      <strong className={gold ? s.gold : undefined}>{value}</strong>
      <small>{detail}</small>
    </div>
  );
}
function Title({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className={s.sectionTitle}>
      <p className={s.eyebrow}>{eyebrow}</p>
      <h3>{title}</h3>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return <p className={s.empty}>{text}</p>;
}
