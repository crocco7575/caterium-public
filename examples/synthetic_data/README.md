# A deliberately fictional fixture universe

The backend creates an equities account named `demo-account` with `10000.00` synthetic USD and a separate `prediction-demo-account` with `1000.00`. Both start without positions. It does not import account records or trade logs.

| Symbol | Fixed mock price | Source |
| --- | ---: | --- |
| DEMO | 100.00 | Constant authored for this demo |
| SAMPLE | 25.00 | Constant authored for this demo |

These symbols and prices are not market observations. Filling at a fixed quote demonstrates accounting transitions only. There is no slippage, fee model, liquidity model, order-book replay, profitability forecast, or hidden production strategy.

| Fictional market | YES | NO |
| --- | ---: | ---: |
| `demo-launch`: Will the demo rocket launch? | 0.40 | 0.60 |
| `demo-rain`: Will it rain in the demo city? | 0.55 | 0.45 |

These are not listed exchange contracts. The user manually selects an outcome to exercise settlement: winning contracts pay `1.00` each, losing contracts pay zero, and pending orders are cancelled. Any resulting P&L is fictional and cannot validate a strategy. Restarting preserves state rather than replenishing funds or reopening markets.

Tests construct their own isolated fixtures from scratch. The dashboard reads the running demo database; it does not fall back to fabricated success data if the API is unavailable.
