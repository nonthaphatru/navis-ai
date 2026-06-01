export type AssetType = "stock" | "crypto";

export interface WatchlistRow {
  id: number;
  symbol: string;
  asset_type: AssetType;
  coingecko_id: string | null;
  is_holding: boolean;
  priority: boolean;
  sort_order: number;
}

export interface PositionRow {
  id: number;
  symbol: string;
  asset_type: AssetType;
  coingecko_id: string | null;
  quantity: number;
  avg_buy_price: number;
  opened_at: string | null;
  note: string | null;
}

export interface AppSettings {
  holding_move_pct: number;
  watch_move_pct: number;
  sec_alerts_enabled: boolean;
  earnings_alerts_enabled: boolean;
}

export interface Quote {
  price: number;
  changePct: number | null;
}
