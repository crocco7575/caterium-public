"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { retryableMutationError } from "../lib/api";
import {
  getPaperDashboard,
  runPaperStrategy,
  type PaperDashboard,
  type PaperLedgerRow,
  type PaperRun,
} from "../lib/paper";
import styles from "./KalshiDashboard.module.css";

type Tab = "Overview" | "Trades" | "Strategies" | "Alerts" | "System";

const cents = (value: number | null | undefined) =>
  value == null
    ? "—"
    : `${value < 0 ? "-" : ""}$${(Math.abs(value) / 100).toFixed(2)}`;
const pct = (value: number | null | undefined) =>
  value == null ? "—" : `${(value * 100).toFixed(1)}%`;
const when = (value: string) =>
  new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

function latestRuns(runs: PaperRun[]) {
  const map = new Map<string, PaperRun>();
  for (const run of runs)
    if (!map.has(run.strategy_id)) map.set(run.strategy_id, run);
  return map;
}

function curvePath(points: { index: number; pnl_cents: number }[]) {
  if (!points.length) return null;
  const values = points.map((point) => point.pnl_cents);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const span = Math.max(max - min, 1);
  const width = 620;
  const height = 160;
  return points
    .map((point, index) => {
      const x = points.length === 1 ? 0 : (index / (points.length - 1)) * width;
      const y = height - ((point.pnl_cents - min) / span) * height;
      return `${index ? "L" : "M"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

function Ledger({ rows }: { rows: PaperLedgerRow[] }) {
  const [status, setStatus] = useState<"ALL" | PaperLedgerRow["status"]>("ALL");
  const visible =
    status === "ALL" ? rows : rows.filter((row) => row.status === status);
  return (
    <>
      <div className={styles.filters}>
        <label className={styles.muted} htmlFor="ledger-status">
          Filter status
        </label>
        <select
          id="ledger-status"
          className={styles.select}
          value={status}
          onChange={(event) => setStatus(event.target.value as typeof status)}
        >
          <option value="ALL">All signals</option>
          <option value="FILLED">Filled</option>
          <option value="UNFILLED">Unfilled</option>
          <option value="SKIPPED">Skipped</option>
        </select>
      </div>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <caption className={styles.srOnly}>
            Synthetic strategy test ledger
          </caption>
          <thead>
            <tr>
              <th>Market</th>
              <th>Side</th>
              <th>Entry</th>
              <th>Result</th>
              <th>Status</th>
              <th>P&amp;L</th>
              <th>Decision note</th>
            </tr>
          </thead>
          <tbody>
            {visible.length ? (
              visible.map((row) => (
                <tr key={row.id}>
                  <td>{row.market}</td>
                  <td>{row.side}</td>
                  <td>{row.entry_cents}¢</td>
                  <td>{row.result}</td>
                  <td>
                    <span
                      className={`${styles.status} ${styles[row.status.toLowerCase()]}`}
                    >
                      {row.status}
                    </span>
                  </td>
                  <td
                    className={
                      row.pnl_cents != null && row.pnl_cents >= 0
                        ? styles.positive
                        : styles.negative
                    }
                  >
                    {cents(row.pnl_cents)}
                  </td>
                  <td className={styles.muted}>{row.reason}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={7} className={styles.muted}>
                  No signals match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function KalshiDashboard() {
  const [data, setData] = useState<PaperDashboard | null>(null);
  const [tab, setTab] = useState<Tab>("Overview");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<string | null>(null);
  const [retryStrategy, setRetryStrategy] = useState<string | null>(null);
  const pendingRef = useRef<{ strategyId: string; key: string } | null>(null);
  const mutationLock = useRef(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setData(await getPaperDashboard());
      setError(null);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unable to reach the paper testing service.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(timer);
  }, [refresh]);

  const latest = useMemo(() => latestRuns(data?.runs ?? []), [data?.runs]);
  const newest = useMemo(() => {
    const values = [...latest.values()];
    return (
      values.sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null
    );
  }, [latest]);
  const selected = selectedId
    ? ([...latest.values()].find((run) => run.id === selectedId) ?? newest)
    : newest;
  const run = async (strategyId: string) => {
    if (mutationLock.current || running || loading || error || !data) return;
    const pending = pendingRef.current;
    if (pending && pending.strategyId !== strategyId) return;
    mutationLock.current = true;
    const key =
      pending?.strategyId === strategyId ? pending.key : crypto.randomUUID();
    pendingRef.current = { strategyId, key };
    setRunning(strategyId);
    setNotice(null);
    try {
      const result = await runPaperStrategy(strategyId, key);
      pendingRef.current = null;
      setRetryStrategy(null);
      setSelectedId(result.id);
      setNotice(
        `${result.strategy_name} completed against the public synthetic fixture.`,
      );
      await refresh();
    } catch (err) {
      const retryable = retryableMutationError(err);
      if (!retryable) {
        pendingRef.current = null;
        setRetryStrategy(null);
      } else {
        setRetryStrategy(strategyId);
      }
      const message = retryable
        ? "The test request did not get a definitive response. Retry the same test to reuse its idempotency key."
        : err instanceof Error
          ? err.message
          : "Unable to run this paper test.";
      setNotice(message);
    } finally {
      mutationLock.current = false;
      setRunning(null);
    }
  };

  const rows = selected?.ledger ?? [];
  const summary = selected?.summary;
  const path = selected ? curvePath(selected.equity) : null;
  const content =
    tab === "Trades" ? (
      <div className={`${styles.card} ${styles.wide} ${styles.cardPad}`}>
        <div className={styles.sectionHeading}>
          <div>
            <h2>Paper strategy ledger</h2>
            <p>
              Every synthetic signal is visible, including unfilled and skipped
              decisions.
            </p>
          </div>
          {selected && (
            <span className={styles.muted}>{selected.strategy_name}</span>
          )}
        </div>
        {selected ? (
          <Ledger rows={rows} />
        ) : (
          <div className={styles.empty}>
            Run a sample strategy to populate the paper ledger.
          </div>
        )}
      </div>
    ) : tab === "Strategies" ? (
      <div className={`${styles.card} ${styles.wide} ${styles.cardPad}`}>
        <div className={styles.sectionHeading}>
          <div>
            <h2>Decision audit</h2>
            <p>
              Reasons are retained so a paper test can be reviewed rather than
              treated as a black box.
            </p>
          </div>
        </div>
        {selected ? (
          <div className={styles.audit}>
            {rows.map((row) => (
              <div className={styles.auditRow} key={row.id}>
                <div>
                  <strong>
                    {row.market} · {row.side} signal
                  </strong>
                  <span>{row.reason}</span>
                </div>
                <span
                  className={
                    row.status === "FILLED" ? styles.positive : styles.muted
                  }
                >
                  {row.status}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.empty}>No test audit yet.</div>
        )}
      </div>
    ) : tab === "Alerts" ? (
      <div className={`${styles.card} ${styles.wide} ${styles.cardPad}`}>
        <div className={styles.sectionHeading}>
          <div>
            <h2>Gmail alerting</h2>
            <p>
              Paper opportunities can produce a reviewable message before any
              delivery decision.
            </p>
          </div>
          <span className={styles.mode}>PREVIEW ONLY</span>
        </div>
        <div className={styles.callout}>
          New paper-trade notifications include strategy, market, side, price,
          and size. Stored IDs suppress repeat alerts. This public preview never
          connects to Gmail, stores credentials, or sends email.
        </div>
        <div style={{ marginTop: "14px" }}>
          {selected?.alerts?.length ? (
            selected.alerts.map((alert) => (
              <article className={styles.alert} key={alert.id}>
                <h3>{alert.subject}</h3>
                <p>{alert.body}</p>
                <div className={styles.alertMeta}>
                  <span>{alert.delivery}</span>
                  <span>Duplicate-safe preview</span>
                </div>
              </article>
            ))
          ) : (
            <div className={styles.empty}>
              Run a sample strategy to preview the alert shape.
            </div>
          )}
        </div>
      </div>
    ) : tab === "System" ? (
      <div className={`${styles.card} ${styles.wide} ${styles.cardPad}`}>
        <div className={styles.sectionHeading}>
          <div>
            <h2>Paper system</h2>
            <p>Boundaries and data provenance for this public workspace.</p>
          </div>
        </div>
        <div className={styles.audit}>
          <div className={styles.auditRow}>
            <div>
              <strong>Execution mode</strong>
              <span>
                No exchange routing, order submission, or settlement controls.
              </span>
            </div>
            <span className={styles.positive}>SAFE</span>
          </div>
          <div className={styles.auditRow}>
            <div>
              <strong>Fixture</strong>
              <span>
                {data?.runs[0]?.fixture_version ?? "public-v1"} · deterministic
                synthetic markets
              </span>
            </div>
            <span className={styles.positive}>READY</span>
          </div>
          <div className={styles.auditRow}>
            <div>
              <strong>Alerts</strong>
              <span>Gmail message previews only; delivery disabled.</span>
            </div>
            <span className={styles.positive}>PREVIEW</span>
          </div>
        </div>
      </div>
    ) : (
      <>
        <div className={styles.layout}>
          <div className={`${styles.card} ${styles.cardPad}`}>
            <div className={styles.sectionHeading}>
              <div>
                <h2>Paper equity curve</h2>
                <p>
                  {selected
                    ? `${selected.strategy_name} · synthetic fixture · ${when(selected.created_at)}`
                    : "Run a strategy to calculate the curve."}
                </p>
              </div>
              <label className={styles.muted} htmlFor="run-selection">
                Run{" "}
                <select
                  id="run-selection"
                  className={styles.select}
                  value={selected?.id ?? ""}
                  onChange={(event) =>
                    setSelectedId(event.target.value || null)
                  }
                  disabled={!latest.size}
                >
                  {[...latest.values()]
                    .sort((a, b) => b.created_at.localeCompare(a.created_at))
                    .map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.strategy_name} · {when(item.created_at)}
                      </option>
                    ))}
                </select>
              </label>
            </div>
            {path ? (
              <svg
                className={styles.curve}
                viewBox="0 0 620 180"
                role="img"
                aria-label="Synthetic paper equity curve"
              >
                <defs>
                  <linearGradient id="paperArea" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="#47dda5" stopOpacity=".28" />
                    <stop offset="100%" stopColor="#47dda5" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <line
                  className={styles.curveGrid}
                  x1="0"
                  x2="620"
                  y1="80"
                  y2="80"
                />
                <line
                  className={styles.curveGrid}
                  x1="0"
                  x2="620"
                  y1="160"
                  y2="160"
                />
                <text x="4" y="13" fill="#8ca99b" fontSize="10">
                  max{" "}
                  {cents(
                    Math.max(
                      ...selected!.equity.map((point) => point.pnl_cents),
                      0,
                    ),
                  )}
                </text>
                <text x="4" y="176" fill="#8ca99b" fontSize="10">
                  min{" "}
                  {cents(
                    Math.min(
                      ...selected!.equity.map((point) => point.pnl_cents),
                      0,
                    ),
                  )}
                </text>
                <text x="560" y="176" fill="#8ca99b" fontSize="10">
                  filled trades →
                </text>
                <path className={styles.curveLine} d={path} />
              </svg>
            ) : (
              <div className={styles.empty}>
                No run yet. The chart is calculated from the selected test
                output.
              </div>
            )}
          </div>
          <div className={`${styles.card} ${styles.cardPad}`}>
            <div className={styles.sectionHeading}>
              <div>
                <h2>Strategy readiness</h2>
                <p>Each run is isolated; reruns are not summed.</p>
              </div>
            </div>
            <div className={styles.strategyList}>
              {data?.strategies.map((strategy) => {
                const result = latest.get(strategy.id);
                return (
                  <div className={styles.strategy} key={strategy.id}>
                    <div className={styles.strategyMeta}>
                      <h3>{strategy.name}</h3>
                      <button
                        className={styles.button}
                        type="button"
                        onClick={() => void run(strategy.id)}
                        disabled={
                          running !== null ||
                          loading ||
                          Boolean(error) ||
                          (retryStrategy !== null &&
                            retryStrategy !== strategy.id)
                        }
                        aria-label={`Run paper test for ${strategy.name}`}
                      >
                        {running === strategy.id
                          ? "Running…"
                          : retryStrategy === strategy.id
                            ? "Retry same test"
                            : "Run sample test"}
                      </button>
                    </div>
                    <p>{strategy.description}</p>
                    {result ? (
                      <div className={styles.strategyStats}>
                        <span>
                          Win rate
                          <strong>{pct(result.summary.win_rate)}</strong>
                        </span>
                        <span>
                          Signals<strong>{result.summary.signals}</strong>
                        </span>
                        <span>
                          P&amp;L
                          <strong
                            className={
                              result.summary.pnl_cents >= 0
                                ? styles.positive
                                : styles.negative
                            }
                          >
                            {cents(result.summary.pnl_cents)}
                          </strong>
                        </span>
                      </div>
                    ) : (
                      <span className={styles.muted}>Not tested yet</span>
                    )}
                  </div>
                );
              }) ?? (
                <div className={styles.empty}>Loading strategy catalog…</div>
              )}
            </div>
          </div>
        </div>
        <div className={`${styles.card} ${styles.wide} ${styles.cardPad}`}>
          <div className={styles.sectionHeading}>
            <div>
              <h2>Latest paper ledger</h2>
              <p>
                Fixture outputs are synthetic and do not represent live exchange
                performance.
              </p>
            </div>
            <button
              className={`${styles.button} ${styles.buttonSecondary}`}
              type="button"
              onClick={() => setTab("Trades")}
              disabled={!selected}
            >
              View complete ledger
            </button>
          </div>
          {selected ? (
            <Ledger rows={rows.slice(0, 5)} />
          ) : (
            <div className={styles.empty}>
              Start with a sample strategy test above.
            </div>
          )}
        </div>
      </>
    );

  return (
    <main className={styles.root}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div className={styles.brand}>
            <Image
              className={styles.logo}
              src="/caterium-logo.png"
              alt="Caterium"
              width={632}
              height={388}
              sizes="44px"
              unoptimized
            />
            <div>
              <p className={styles.kicker}>Kalshi operations</p>
              <h1 className={styles.title}>Caterium Trading Console</h1>
            </div>
          </div>
          <div className={styles.headerActions}>
            <span className={styles.fresh}>
              <span className={styles.dot} />
              Paper service{" "}
              {loading ? "refreshing" : error || !data ? "offline" : "ready"}
            </span>
            <button
              className={styles.button}
              type="button"
              onClick={() => void refresh()}
              disabled={loading}
            >
              Refresh data
            </button>
          </div>
        </header>
        <nav className={styles.nav} aria-label="Primary navigation">
          <div className={styles.navLinks}>
            <Link className={styles.navLink} href="/brokerage">
              Brokerage
            </Link>
            <Link
              className={`${styles.navLink} ${styles.navActive}`}
              href="/kalshi"
              aria-current="page"
            >
              Kalshi testing
            </Link>
          </div>
          <div>
            <span className={styles.mode}>Paper testing · Active</span>
            <span
              className={`${styles.mode} ${styles.modeDisabled}`}
              style={{ marginLeft: "8px" }}
            >
              Live pilot · Disabled
            </span>
          </div>
        </nav>
        <section className={styles.banner}>
          <div>
            <strong>Paper-only strategy lab</strong>
            <span>
              Test ideas against a bounded synthetic fixture. Nothing here
              submits orders or routes to Kalshi. Results use a one-contract
              basis with zero demo fees.
            </span>
          </div>
          <span className={styles.pill}>PAPER ONLY</span>
        </section>
        <div
          className={styles.tabs}
          role="group"
          aria-label="Kalshi paper testing views"
        >
          {(
            ["Overview", "Trades", "Strategies", "Alerts", "System"] as Tab[]
          ).map((item) => (
            <button
              className={`${styles.tab} ${tab === item ? styles.tabActive : ""}`}
              key={item}
              type="button"
              aria-pressed={tab === item}
              onClick={() => setTab(item)}
            >
              {item}
            </button>
          ))}
        </div>
        {error && (
          <div className={styles.error} role="alert">
            {error}{" "}
            <button
              className={`${styles.button} ${styles.buttonSecondary}`}
              type="button"
              onClick={() => void refresh()}
            >
              Retry
            </button>
          </div>
        )}
        {notice && (
          <div
            className={styles.callout}
            role="status"
            style={{ marginBottom: "14px" }}
          >
            {notice}
          </div>
        )}
        {tab === "Overview" && (
          <div className={styles.metricGrid}>
            <div className={styles.metric}>
              <span className={styles.metricLabel}>Signals</span>
              <strong className={styles.metricValue}>
                {summary?.signals ?? "—"}
              </strong>
            </div>
            <div className={styles.metric}>
              <span className={styles.metricLabel}>Filled</span>
              <strong className={styles.metricValue}>
                {summary?.filled ?? "—"}
              </strong>
            </div>
            <div className={styles.metric}>
              <span className={styles.metricLabel}>Unfilled</span>
              <strong className={styles.metricValue}>
                {summary?.unfilled ?? "—"}
              </strong>
            </div>
            <div className={styles.metric}>
              <span className={styles.metricLabel}>Filled P&amp;L</span>
              <strong
                className={`${styles.metricValue} ${summary && summary.pnl_cents < 0 ? styles.negative : styles.positive}`}
              >
                {cents(summary?.pnl_cents)}
              </strong>
            </div>
            <div className={styles.metric}>
              <span className={styles.metricLabel}>Max drawdown</span>
              <strong className={`${styles.metricValue} ${styles.negative}`}>
                {cents(summary?.max_drawdown_cents)}
              </strong>
            </div>
            <div className={styles.metric}>
              <span className={styles.metricLabel}>Assumed-fill P&amp;L</span>
              <strong
                className={`${styles.metricValue} ${summary && summary.all_signal_pnl_cents < 0 ? styles.negative : styles.positive}`}
              >
                {cents(summary?.all_signal_pnl_cents)}
              </strong>
            </div>
          </div>
        )}
        {tab === "Overview" && (
          <p className={styles.footerNote}>
            Filled P&amp;L uses fixture fills only. Assumed-fill P&amp;L also
            treats every unfilled signal as filled at its listed entry price.
            Skipped markets are excluded from both.
          </p>
        )}
        {content}
        <p className={styles.footerNote}>
          Public synthetic fixture · results are illustrative, not exchange
          performance.
        </p>
      </div>
    </main>
  );
}
