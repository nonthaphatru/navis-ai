import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { fetchQuotes } from "../lib/quotes";
import { CRYPTO_OPTIONS } from "../lib/cryptoList";
import type { PositionRow, AssetType, Quote } from "../types";

const usd = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;

export function Portfolio() {
  const [rows, setRows] = useState<PositionRow[]>([]);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [loading, setLoading] = useState(true);
  const [updated, setUpdated] = useState<Date | null>(null);
  const [showForm, setShowForm] = useState(false);

  // form state
  const [assetType, setAssetType] = useState<AssetType>("stock");
  const [symbol, setSymbol] = useState("");
  const [cryptoId, setCryptoId] = useState(CRYPTO_OPTIONS[0].id);
  const [qty, setQty] = useState("");
  const [buy, setBuy] = useState("");
  const [err, setErr] = useState("");

  const rowsRef = useRef<PositionRow[]>([]);
  rowsRef.current = rows;

  async function load() {
    const { data } = await supabase.from("positions").select("*").order("created_at");
    setRows((data as PositionRow[]) || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function refreshQuotes() {
    const r = rowsRef.current;
    if (r.length === 0) return;
    const stocks = r.filter((x) => x.asset_type === "stock").map((x) => x.symbol);
    const cryptoIds = r.filter((x) => x.asset_type === "crypto" && x.coingecko_id).map((x) => x.coingecko_id as string);
    const q = await fetchQuotes(stocks, cryptoIds);
    setQuotes(q);
    setUpdated(new Date());
  }

  // poll every 20s while positions exist
  useEffect(() => {
    refreshQuotes();
    const t = setInterval(refreshQuotes, 20000);
    return () => clearInterval(t);
  }, [rows.length]);

  function priceFor(p: PositionRow): number | null {
    const key = p.asset_type === "crypto" ? (p.coingecko_id ?? "") : p.symbol.toUpperCase();
    const q = quotes[key];
    return q ? q.price : null;
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    const sym = assetType === "crypto"
      ? (CRYPTO_OPTIONS.find((o) => o.id === cryptoId)?.symbol ?? cryptoId.toUpperCase())
      : symbol.trim().toUpperCase();
    const q = parseFloat(qty), b = parseFloat(buy);
    if (!sym || !(q > 0) || !(b > 0)) { setErr("Enter a symbol, quantity, and buy price."); return; }
    const { error } = await supabase.from("positions").insert({
      symbol: sym, asset_type: assetType,
      coingecko_id: assetType === "crypto" ? cryptoId : null,
      quantity: q, avg_buy_price: b,
    });
    if (error) { setErr(error.message); return; }
    setSymbol(""); setQty(""); setBuy(""); setShowForm(false);
    await load();
    refreshQuotes();
  }

  async function remove(id: number) {
    await supabase.from("positions").delete().eq("id", id);
    load();
  }

  // totals (P&L computed only over positions we have a live price for)
  let mktTotal = 0, costAll = 0, costPriced = 0;
  for (const p of rows) {
    const price = priceFor(p);
    const cost = p.avg_buy_price * p.quantity;
    costAll += cost;
    if (price != null) { mktTotal += price * p.quantity; costPriced += cost; }
  }
  const plTotal = mktTotal - costPriced;
  const plPctTotal = costPriced > 0 ? (plTotal / costPriced) * 100 : 0;

  return (
    <div>
      <h2 className="page-title">Portfolio</h2>

      <div className="glass card">
        <div className="section-label">Total value</div>
        <div className="big-number mono">{usd(mktTotal)}</div>
        <div className="row between" style={{ marginTop: 6 }}>
          <span className={`mono ${plTotal >= 0 ? "pos" : "neg"}`}>
            {plTotal >= 0 ? "▲" : "▼"} {usd(Math.abs(plTotal))} ({pct(plPctTotal)})
          </span>
          <span className="updated">
            {updated ? `updated ${updated.toLocaleTimeString()}` : "fetching…"}
          </span>
        </div>
        <div className="sub" style={{ marginTop: 6 }}>Cost basis {usd(costAll)}</div>
      </div>

      <div className="row between" style={{ margin: "16px 2px 8px" }}>
        <div className="section-label" style={{ margin: 0 }}>Positions</div>
        <button className="btn btn-sm btn-accent" onClick={() => setShowForm((s) => !s)}>
          {showForm ? "Cancel" : "+ Add"}
        </button>
      </div>

      {showForm && (
        <div className="glass card">
          <form onSubmit={add}>
            <div className="row" style={{ gap: 8, marginBottom: 12 }}>
              <select value={assetType} onChange={(e) => setAssetType(e.target.value as AssetType)} style={{ maxWidth: 120 }}>
                <option value="stock">Stock</option>
                <option value="crypto">Crypto</option>
              </select>
              {assetType === "stock" ? (
                <input placeholder="Ticker" value={symbol} onChange={(e) => setSymbol(e.target.value)} />
              ) : (
                <select value={cryptoId} onChange={(e) => setCryptoId(e.target.value)}>
                  {CRYPTO_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.symbol}</option>)}
                </select>
              )}
            </div>
            <div className="row" style={{ gap: 8, marginBottom: 12 }}>
              <div className="field" style={{ flex: 1, margin: 0 }}>
                <label>Quantity</label>
                <input type="number" step="any" value={qty} onChange={(e) => setQty(e.target.value)} />
              </div>
              <div className="field" style={{ flex: 1, margin: 0 }}>
                <label>Avg buy price (USD)</label>
                <input type="number" step="any" value={buy} onChange={(e) => setBuy(e.target.value)} />
              </div>
            </div>
            {err && <p className="error" style={{ marginBottom: 10 }}>{err}</p>}
            <button className="btn btn-accent" style={{ width: "100%" }}>Save position</button>
          </form>
        </div>
      )}

      {loading ? (
        <div className="spin">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="glass card" style={{ textAlign: "center" }}>
          <p className="sub">No positions yet. Tap “+ Add” to track your first one.</p>
        </div>
      ) : (
        <div className="glass card">
          {rows.map((p) => {
            const price = priceFor(p);
            const cost = p.avg_buy_price * p.quantity;
            const mkt = price != null ? price * p.quantity : null;
            const pl = mkt != null ? mkt - cost : null;
            const plPct = mkt != null ? (mkt / cost - 1) * 100 : null;
            return (
              <div className="list-row" key={p.id}>
                <div>
                  <div className="row" style={{ gap: 8 }}>
                    <strong>{p.symbol}</strong>
                    <span className="dim">{p.quantity} @ {usd(p.avg_buy_price)}</span>
                  </div>
                  <div className="sub mono">
                    {price != null ? `now ${usd(price)} · ${usd(mkt!)}` : "price…"}
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  {pl != null ? (
                    <>
                      <div className={`mono ${pl >= 0 ? "pos" : "neg"}`}>{pl >= 0 ? "+" : ""}{usd(pl)}</div>
                      <div className={`sub mono ${pl >= 0 ? "pos" : "neg"}`}>{pct(plPct!)}</div>
                    </>
                  ) : <span className="dim">—</span>}
                  <button className="btn btn-sm btn-danger" style={{ marginTop: 6 }} onClick={() => remove(p.id)}>Remove</button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
