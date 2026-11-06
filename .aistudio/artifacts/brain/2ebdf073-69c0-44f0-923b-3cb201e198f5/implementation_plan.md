# NPR Currency Synchronization Across Chart Overlays & Trade Panel

Unifies currency formatting across the live candlestick chart overlays, settlement result cards, and the trade execution panel so that when NPR (`Rs`) is selected, all trade pills, live return badges, and payout calculations display in Nepalese Rupees (`Rs`) rather than hardcoded US Dollars (`$`), and lowers the NPR minimum trade stake to `Rs 100`.

### User Review & Critical Decisions

> [!IMPORTANT]
> The following decisions were confirmed during interactive clarification and govern this implementation:

- **Confirmed Decision 1 — Full NPR Display Across Chart & Trade Panels**: All active trade pills on the candlestick chart (`↑ Rs 1,345 00:12`), the floating open-return badge in the instrument selector, the on-chart `RESULT (P/L)` settlement badge, the bottom-left settlement summary card, and the trade investment/payout controls will dynamically format values in `NPR (Rs)` whenever NPR mode is active.
- **Confirmed Decision 2 — Rs 100 Minimum Investment in NPR Mode**: When trading in NPR mode, the minimum investment threshold is `Rs 100` (with preset quick-select buttons starting at `Rs 100`), immediately calculating and displaying the live NPR payout (`Rs 185.00` at 85% payout) instead of `Rs 0.00`.

---

### 1. Overview & Core Concept

- **What It Does**: Eliminates hardcoded `$` suffixes on the trading chart's coordinate-synced open-trade pills and settlement overlays, connecting them to the centralized `CurrencyProvider` (`formatMoney`) and trade-level currency snapshots (`displayCurrency` and `fxRateUsed`). Additionally, updates the trade panel's validation and database/server settlement flow so `Rs 100` trades calculate live payouts and execute seamlessly in NPR mode.
- **Target Audience / Persona**: Traders using the platform in Nepalese Rupees (`NPR`) on mobile and desktop who expect consistent `Rs` formatting from initial stake entry through on-chart tracking and trade settlement.
- **Key Value**: Removes confusing currency mismatches (such as seeing `10 $` on the chart and `Rs 0.00` payout while the account header and investment box are set to `NPR`).

---

### 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Entering a Trade in NPR Mode**: When a user switches to `NPR` (or loads the terminal with `NPR` saved), the Investment input defaults to a valid NPR amount (e.g., `Rs 100` or `Rs 1,345`), the Payout line immediately displays the calculated return (`Rs 185.00` for a `Rs 100` stake at `85%`), and quick-amount buttons offer clean NPR presets (`Rs 100`, `Rs 500`, `Rs 1,345`, `Rs 6,725`).
  2. **Tracking Active Trades on the Candlestick Chart**: As soon as a Buy (`CALL`) or Sell (`PUT`) position is opened, the coordinate-synced pill anchored to the entry price line renders `[ ↑ Rs 100.00 | 00:12 ]` (or whole-number `Rs 1,345` when appropriate) in crisp monospace tabular numerals (`JetBrains Mono`, `tabular-nums`).
  3. **Live Open Return & Settlement Popups**: Both the floating asset header badge and the 1.5-second `RESULT (P/L)` candle popup / bottom-left summary card display `+Rs 185.00` (for winning trades) or `Rs 0.00` (for lost trades) when `NPR` is active.
- **Visual Identity & Theme**:
  - *Aesthetic Direction*: High-density, low-latency financial trading terminal following SaaS & Dashboard discipline.
  - *Color Palette & Mood*: Deep slate canvas (`#171a23` / `#1c202e`), structural hairline borders (`#2a3042`), semantic emerald (`#22ab68`) for bullish `CALL` / positive payout states, and semantic crimson (`#e34c3b`) for bearish `PUT` / loss states.
  - *Typography & Hierarchy*: `Plus Jakarta Sans` for UI labels paired with `JetBrains Mono` (`font-mono tabular-nums`) on all price levels, countdown timers, stake pills, and payout figures to prevent horizontal layout jitter during 60fps chart updates.
- **Interactive Feedback & Motion**: Smooth 180ms opacity transition when toggling between `USDT` and `NPR`, instant payout recalculation on keystroke or `+`/`-` stepper tap, and zero-latency coordinate updates on the chart canvas.

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1 — Respecting Trade-Time FX Snapshots vs. Active Display Currency**:
  - *Chosen Approach*: Pass `formatMoney` from `CurrencyProvider` into the chart component along with optional `displayCurrency` and `fxRateUsed` fields on `ActiveTradeOverlay` and `SettledTradeResultOverlay`. When `currency === 'NPR'`, amounts convert using the trade's locked FX rate (if present) or the active exchange rate.
  - *Why*: Ensures that the on-chart trade pill (`Rs 1,345` or `Rs 100`) matches the exact NPR stake the user typed when placing the trade.
  - *Alternatives Considered*: Multiplying raw numbers inline inside the chart component was rejected to avoid floating-point rounding drift and duplicated logic.
- **Decision 2 — Supporting Rs 100 Minimum Investment Across Client & Server**:
  - *Chosen Approach*: Update the NPR minimum stake validation in the trade panel so `Rs 100` (approx. `$0.74` USDT at `134.50`) is accepted as a valid stake in `NPR` mode, and add a server-assisted trade placement fallback + updated SQL migration threshold (`p_amount >= 0.50` base USDT) so trades between `Rs 100` and `Rs 135` succeed even if the database RPC previously enforced `$1.00` USDT.
  - *Why*: Guarantees both the live `Payout` preview (`Rs 185.00` instead of `Rs 0.00`) and actual trade execution work reliably at `Rs 100`.

---

### 4. Technical Architecture & Data Strategy *(Technical Reference)*

- **Architecture & Component Diagram**:

```
┌──────────────────────────────────────────────────────────────────────────┐
│                     CurrencyProvider (Context State)                     │
│  • currency: 'USDT' | 'NPR'          • rate: numeric(12,4) (e.g. 134.50) │
│  • formatMoney(baseUsdt, options)    • toBase(displayInput)              │
└───────────────────┬──────────────────────────────────┬───────────────────┘
                    │                                  │
                    ▼                                  ▼
┌──────────────────────────────────────┐  ┌────────────────────────────────┐
│         TradePanel Component         │  │      PriceChart Component      │
│  • Investment Input (NPR / USDT)     │  │  • Active Trade Entry Pills    │
│  • Min Limit: Rs 100 (NPR) / $1 (USD)│  │    [ ↑ Rs 1,345  00:12 ]       │
│  • Live Payout Line (formatMoney)    │  │  • Asset Header Open Return    │
│  • Quick Presets (Rs 100, Rs 500...) │  │  • RESULT (P/L) Candle Popup   │
│  • Trade Execution Handler           │  │  • Bottom-Left Result Summary  │
└───────────────────┬──────────────────┘  └────────────────▲───────────────┘
                    │                                      │
                    ▼                                      │
┌──────────────────────────────────────────────────────────┴───────────────┐
│              TradingTerminal & Server Trade Placement Route              │
│  • Maps TradeRow (amount, display_currency, fx_rate_used) to Overlays    │
│  • Executes place_trade RPC / Server Fallback for sub-$1 (Rs 100) stakes │
└──────────────────────────────────────────────────────────────────────────┘
```

- **Data Model & State**:
  - `ActiveTradeOverlay`: Extended with optional `displayCurrency?: CurrencyCode` and `fxRateUsed?: number` so each open trade pill on the chart knows the exact rate at which it was opened.
  - `SettledTradeResultOverlay`: Extended with optional `displayCurrency?: CurrencyCode` and `fxRateUsed?: number` so the 1.5-second settlement popup formats `totalPayout` accurately in `NPR` or `USDT`.
- **Interactive Component & State Mapping**:
  - **Currency Toggle (`USDT` ↔ `NPR`)**: Switching currency converts the current `amountInput` in the trade panel, updates the minimum investment floor (`Rs 100` in NPR mode, `$1` in USDT mode), and immediately re-renders all active chart pills, open-return badges, and payout previews in the selected currency.
  - **Investment Input & Stepper (`-` / `+` / Quick Presets)**: Typing `100` in NPR mode passes validation (`parsedDisplayAmount >= 100`), computes `totalPayoutBaseUsdt`, and displays `Rs 185.00` (at 85% payout) on the Payout row.
  - **Buy (`CALL`) / Sell (`PUT`) Execution**: Submits the base USDT equivalent to `place_trade` (with an automatic server-side fallback endpoint if the database RPC rejects base amounts between `$0.50` and `$0.99` USDT), attaches the resulting trade to the chart overlay, and displays the confirmation toast in NPR.
