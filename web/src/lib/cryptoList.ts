// Curated symbol -> CoinGecko id map, so the UI can offer a dropdown instead of
// requiring users to know CoinGecko ids. Extend as needed.
export const CRYPTO_OPTIONS: { symbol: string; id: string; name: string }[] = [
  { symbol: "BTC", id: "bitcoin", name: "Bitcoin" },
  { symbol: "ETH", id: "ethereum", name: "Ethereum" },
  { symbol: "SOL", id: "solana", name: "Solana" },
  { symbol: "XRP", id: "ripple", name: "XRP" },
  { symbol: "ADA", id: "cardano", name: "Cardano" },
  { symbol: "DOGE", id: "dogecoin", name: "Dogecoin" },
  { symbol: "AVAX", id: "avalanche-2", name: "Avalanche" },
  { symbol: "LINK", id: "chainlink", name: "Chainlink" },
  { symbol: "MATIC", id: "matic-network", name: "Polygon" },
  { symbol: "DOT", id: "polkadot", name: "Polkadot" },
];

export function cgIdForSymbol(symbol: string): string | null {
  const hit = CRYPTO_OPTIONS.find((o) => o.symbol === symbol.toUpperCase());
  return hit ? hit.id : null;
}
