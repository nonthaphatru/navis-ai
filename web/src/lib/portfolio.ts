import type { TradeRow, PositionSummary } from "../types";

/**
 * Calculate position summary from trade history using Weighted Average Cost.
 * This is the same method used by Webull, Robinhood, etc.
 *
 * How it works:
 * - Each BUY adds to the cost pool: totalCost += qty * price
 * - Each SELL uses the current average: realizedPL += qty * (sellPrice - avgCost)
 *   and reduces the cost pool proportionally.
 */
export function calculatePosition(trades: TradeRow[]): Omit<PositionSummary, "symbol" | "asset_type" | "coingecko_id" | "trades" | "firstTrade" | "lastTrade"> {
  const sorted = [...trades].sort(
    (a, b) => new Date(a.traded_at).getTime() - new Date(b.traded_at).getTime()
  );

  let totalShares = 0;
  let totalCost = 0;
  let realizedPL = 0;

  for (const t of sorted) {
    if (t.side === "buy") {
      totalCost += t.quantity * t.price;
      totalShares += t.quantity;
    } else {
      // Sell at current weighted average
      const avgCost = totalShares > 0 ? totalCost / totalShares : 0;
      realizedPL += t.quantity * (t.price - avgCost);
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

  return { totalShares, avgCost, totalCost, realizedPL };
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
