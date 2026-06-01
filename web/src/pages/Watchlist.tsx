import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { CRYPTO_OPTIONS } from "../lib/cryptoList";
import type { WatchlistRow, AssetType } from "../types";

const DEFAULT_SEED = {
  holdings: ["SOFI", "PLTR"],
  watch: ["NVDA", "GOOGL", "TSLA", "AAPL", "MSFT", "META", "AMZN", "AMD", "AVGO", "CRM", "HOOD", "ZS", "SOUN", "AI", "BBAI", "IONQ"],
  crypto: [{ symbol: "BTC", id: "bitcoin" }, { symbol: "ETH", id: "ethereum" }],
};

export function Watchlist() {
  const [rows, setRows] = useState<WatchlistRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [assetType, setAssetType] = useState<AssetType>("stock");
  const [symbol, setSymbol] = useState("");
  const [cryptoId, setCryptoId] = useState(CRYPTO_OPTIONS[0].id);
  const [isHolding, setIsHolding] = useState(false);
  const [err, setErr] = useState("");

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("watchlist")
      .select("*")
      .order("asset_type")
      .order("sort_order");
    setRows((data as WatchlistRow[]) || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    const sym = assetType === "crypto"
      ? (CRYPTO_OPTIONS.find((o) => o.id === cryptoId)?.symbol ?? cryptoId.toUpperCase())
      : symbol.trim().toUpperCase();
    if (!sym) return;
    const row = {
      symbol: sym,
      asset_type: assetType,
      coingecko_id: assetType === "crypto" ? cryptoId : null,
      is_holding: isHolding,
      priority: isHolding,
      sort_order: rows.length,
    };
    const { error } = await supabase.from("watchlist").insert(row);
    if (error) { setErr(error.message); return; }
    setSymbol(""); setIsHolding(false);
    load();
  }

  async function toggleHolding(r: WatchlistRow) {
    await supabase.from("watchlist").update({ is_holding: !r.is_holding, priority: !r.is_holding }).eq("id", r.id);
    load();
  }

  async function remove(id: number) {
    await supabase.from("watchlist").delete().eq("id", id);
    load();
  }

  async function seedDefaults() {
    const rowsToAdd = [
      ...DEFAULT_SEED.holdings.map((s, i) => ({ symbol: s, asset_type: "stock", coingecko_id: null, is_holding: true, priority: true, sort_order: i })),
      ...DEFAULT_SEED.watch.map((s, i) => ({ symbol: s, asset_type: "stock", coingecko_id: null, is_holding: false, priority: false, sort_order: 100 + i })),
      ...DEFAULT_SEED.crypto.map((c, i) => ({ symbol: c.symbol, asset_type: "crypto", coingecko_id: c.id, is_holding: false, priority: false, sort_order: 200 + i })),
    ];
    const { error } = await supabase.from("watchlist").insert(rowsToAdd);
    if (error) setErr(error.message);
    load();
  }

  const stocks = rows.filter((r) => r.asset_type === "stock");
  const cryptos = rows.filter((r) => r.asset_type === "crypto");

  return (
    <div>
      <h2 className="page-title">Watchlist</h2>
      <p className="sub" style={{ margin: "0 2px 16px" }}>
        The bots watch these tickers. Mark holdings to get tighter alert thresholds + SEC monitoring.
      </p>

      <div className="glass card">
        <form onSubmit={add}>
          <div className="row" style={{ gap: 8, marginBottom: 12 }}>
            <select value={assetType} onChange={(e) => setAssetType(e.target.value as AssetType)} style={{ maxWidth: 120 }}>
              <option value="stock">Stock</option>
              <option value="crypto">Crypto</option>
            </select>
            {assetType === "stock" ? (
              <input placeholder="Ticker (e.g. NVDA)" value={symbol} onChange={(e) => setSymbol(e.target.value)} />
            ) : (
              <select value={cryptoId} onChange={(e) => setCryptoId(e.target.value)}>
                {CRYPTO_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.symbol} — {o.name}</option>)}
              </select>
            )}
          </div>
          <div className="row between">
            <label className="toggle">
              <button type="button" className={`switch ${isHolding ? "on" : ""}`} onClick={() => setIsHolding(!isHolding)} />
              I hold this
            </label>
            <button className="btn btn-accent btn-sm">Add</button>
          </div>
          {err && <p className="error" style={{ marginTop: 10 }}>{err}</p>}
        </form>
      </div>

      {loading ? (
        <div className="spin">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="glass card" style={{ marginTop: 14, textAlign: "center" }}>
          <p className="sub" style={{ marginBottom: 14 }}>Your watchlist is empty.</p>
          <button className="btn btn-accent" onClick={seedDefaults}>Load my defaults</button>
        </div>
      ) : (
        <>
          {stocks.length > 0 && (
            <div className="glass card" style={{ marginTop: 14 }}>
              <div className="section-label">Stocks</div>
              {stocks.map((r) => (
                <div className="list-row" key={r.id}>
                  <div className="row" style={{ gap: 10 }}>
                    <strong>{r.symbol}</strong>
                    {r.is_holding && <span className="pill hold">holding</span>}
                  </div>
                  <div className="btn-row">
                    <button className="btn btn-sm" onClick={() => toggleHolding(r)}>{r.is_holding ? "Unhold" : "Hold"}</button>
                    <button className="btn btn-sm btn-danger" onClick={() => remove(r.id)}>Remove</button>
                  </div>
                </div>
              ))}
            </div>
          )}
          {cryptos.length > 0 && (
            <div className="glass card" style={{ marginTop: 14 }}>
              <div className="section-label">Crypto</div>
              {cryptos.map((r) => (
                <div className="list-row" key={r.id}>
                  <div className="row" style={{ gap: 10 }}>
                    <strong>{r.symbol}</strong><span className="dim">{r.coingecko_id}</span>
                  </div>
                  <button className="btn btn-sm btn-danger" onClick={() => remove(r.id)}>Remove</button>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
