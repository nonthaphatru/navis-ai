import type { TradeRow, PositionSummary } from "../types";

/**
 * Webull Thailand fee structure for US stocks.
 * Source: webull.co.th/pricing
 *
 * ── BUY & SELL ──
 *   Commission:       0.10% of trade value
 *   VAT on commission: 7% of commission
 *
 * ── SELL ONLY (US regulatory pass-through) ──
 *   SEC Fee:    0.0000278 × trade value  (min $0.01)
 *   FINRA TAF:  0.000195 × shares        (min $0.01, max $9.79)
 *   FINRA CAT:  0.000024 × shares
 */

const COMMISSION_RATE = 0.001;         // 0.10%
const VAT_RATE = 0.07;                 // 7% on commission
const SEC_FEE_RATE = 0.0000278;        // per $ of sell value
const FINRA_TAF_PER_SHARE = 0.000195;  // per share sold
const FINRA_TAF_MAX = 9.79;
const FINRA_CAT_PER_SHARE = 0.000024;  // per share sold

/** Calculate Webull Thailand fees for a single trade */
export function calcTradeFee(side: "buy" | "sell", quantity: number, price: number): number {
  const tradeValue = quantity * price;

  // Commission + VAT (both buy and sell)
  const commission = tradeValue * COMMISSION_RATE;
  const vat = commission * VAT_RATE;
  let total = commission + vat;

  // Sell-only regulatory fees
  if (side === "sell") {
    const secFee = Math.max(0.01, tradeValue * SEC_FEE_RATE);
    const finraTaf = Math.min(FINRA_TAF_MAX, Math.max(0.01, quantity * FINRA_TAF_PER_SHARE));
    const finraCat = quantity * FINRA_CAT_PER_SHARE;
    total += secFee + finraTaf + finraCat;
  }

  return total;
}

/**
 * Calculate position summary from trade history using Weighted Average Cost.
 * Includes Webull Thailand commission fees in P/L calculation.
 *
 * How it works:
 * - Each BUY adds to the cost pool: totalCost += qty * price + fees
 * - Each SELL uses the current average: realizedPL += qty * (sellPrice - avgCost) - fees
 */
export function calculatePosition(trades: TradeRow[]): Omit<PositionSummary, "symbol" | "asset_type" | "coingecko_id" | "trades" | "firstTrade" | "lastTrade"> {
  const sorted = [...trades].sort(
    (a, b) => new Date(a.traded_at).getTime() - new Date(b.traded_at).getTime()
  );

  let totalShares = 0;
  let totalCost = 0;
  let realizedPL = 0;
  let totalFees = 0;

  for (const t of sorted) {
    const fee = calcTradeFee(t.side, t.quantity, t.price);
    totalFees += fee;

    if (t.side === "buy") {
      // Include buy fees in cost basis (raises avg cost)
      totalCost += t.quantity * t.price + fee;
      totalShares += t.quantity;
    } else {
      // Sell: P/L = proceeds - cost - sell fees
      const avgCost = totalShares > 0 ? totalCost / totalShares : 0;
      const proceeds = t.quantity * t.price - fee;
      realizedPL += proceeds - (t.quantity * avgCost);
      totalCost -= t.quantity * avgCost;
      totalShares -= t.quantity;
    }
  }

  // Guard against floating point negatives near zero
  if (totalShares < 0.0001) {
    totalShares = 0;
    totalCost = 0;
  }

  const avgCost = totalShares > 0 ? totalCost / totalShares : 0;

  return { totalShares, avgCost, totalCost, realizedPL, totalFees };
}

/**
 * Group trades by symbol and compute position summaries.
 * Returns sorted: open positions first (by value desc), then closed (by last trade desc).
 */
export function buildPositions(trades: TradeRow[]): PositionSummary[] {
  const grouped = new Map<string, TradeRow[]>();

  for (const t of trades) {
    const key = `${t.asset_type}:${t.symbol}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(t);
  }

  const positions: PositionSummary[] = [];

  for (const [, group] of grouped) {
    const first = group[0];
    const calc = calculatePosition(group);
    const dates = group.map((t) => t.traded_at).sort();

    positions.push({
      symbol: first.symbol,
      asset_type: first.asset_type,
      coingecko_id: first.coingecko_id,
      ...calc,
      trades: [...group].sort(
        (a, b) => new Date(b.traded_at).getTime() - new Date(a.traded_at).getTime()
      ),
      firstTrade: dates[0],
      lastTrade: dates[dates.length - 1],
    });
  }

  // Open positions first, then closed; within each group sort by symbol
  return positions.sort((a, b) => {
    if (a.totalShares > 0 && b.totalShares <= 0) return -1;
    if (a.totalShares <= 0 && b.totalShares > 0) return 1;
    return a.symbol.localeCompare(b.symbol);
  });
}
