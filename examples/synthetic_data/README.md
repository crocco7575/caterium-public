# A deliberately fictional fixture universe

The backend creates one account named `demo-account` with `10000.00` synthetic USD and no starting positions. It does not import account records or trade logs.

| Symbol | Fixed mock price | Source |
| --- | ---: | --- |
| DEMO | 100.00 | Constant authored for this demo |
| SAMPLE | 25.00 | Constant authored for this demo |

These symbols and prices are not market observations. Filling at a fixed quote demonstrates accounting transitions only. There is no slippage, fee model, liquidity model, order-book replay, profitability forecast, or hidden production strategy.

Tests construct their own isolated fixtures from scratch. The dashboard reads the running demo database; it does not fall back to fabricated success data if the API is unavailable.
