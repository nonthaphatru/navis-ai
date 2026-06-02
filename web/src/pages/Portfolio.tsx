import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import { fetchQuotes } from "../lib/quotes";
import { buildPositions } from "../lib/portfolio";
import { CRYPTO_OPTIONS } from "../lib/cryptoList";
import type { TradeRow, PositionSummary, AssetType, TradeSide, Quote } from "../types";

// ── Currency helpers ──
type Currency = "USD" | "THB";
const FMT: Record<Currency, (n: number) => string> = {
  USD: (n) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }),
  THB: (n) => "฿" + n.toLocaleString("en-US", { maximumFractionDigits: 0 }),
};
const pct = (n: number) => `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
const fmtDate = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

// ── Sorting ──
type SortKey = "name" | "value" | "pl" | "pl_pct" | "realized" | "trades";
const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "name", label: "Name A→Z" },
  { key: "value", label: "Value ↓" },
  { key: "pl", label: "P/L ↓" },
  { key: "pl_pct", label: "P/L % ↓" },
  { key: "realized", label: "Realized ↓" },
  { key: "trades", label: "# Trades ↓" },
];

export function Portfolio() {
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [positions, setPositions] = useState<PositionSummary[]>([]);
  const [quotes, setQuotes] = useState<Record<string, Quote>>({});
  const [loading, setLoading] = useState(true);
  const [updated, setUpdated] = useState<Date | null>(null);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [sortBy, setSortBy] = useState<SortKey>("name");

  // Currency
  const [currency, setCurrency] = useState<Currency>("USD");
  const [thbRate, setThbRate] = useState<number | null>(null);

  // Add trade form
  const [showForm, setShowForm] = useState(false);
  const [formSymbol, setFormSymbol] = useState("");
  const [formAsset, setFormAsset] = useState<AssetType>("stock");
  const [formCrypto, setFormCrypto] = useState(CRYPTO_OPTIONS[0].id);
  const [formSide, setFormSide] = useState<TradeSide>("buy");
  const [formQty, setFormQty] = useState("");
  const [formPrice, setFormPrice] = useState("");
  const [formDate, setFormDate] = useState(new Date().toISOString().split("T")[0]);
  const [formNote, setFormNote] = useState("");
  const [formErr, setFormErr] = useState("");
  const [formTarget, setFormTarget] = useState<string | null>(null);

  // Edit mode
  const [editId, setEditId] = useState<number | null>(null);

  const posRef = useRef<PositionSummary[]>([]);
  posRef.current = positions;

  // ── Currency conversion ──
  const c = (usdVal: number) => {
    if (currency === "THB" && thbRate) return FMT.THB(usdVal * thbRate);
    return FMT.USD(usdVal);
  };

  useEffect(() => {
    // Fetch THB rate once
    fetch("https://api.frankfurter.dev/v1/latest?base=USD&symbols=THB")
      .then((r) => r.json())
      .then((d) => { if (d?.rates?.THB) setThbRate(d.rates.THB); })
      .catch(() => {});
  }, []);

  // ── Load trades ──
  async function loadTrades() {
    const { data } = await supabase
      .from("trades")
      .select("*")
      .order("traded_at", { ascending: false });
    const all = (data as TradeRow[]) || [];
    setTrades(all);
    setPositions(buildPositions(all));
    setLoading(false);
  }

  useEffect(() => { loadTrades(); }, []);

  // ── Live quotes ──
  async function refreshQuotes() {
    const p = posRef.current;
    if (p.length === 0) return;
    const stocks = p.filter((x) => x.asset_type === "stock" && x.totalShares > 0).map((x) => x.symbol);
    const cryptoIds = p.filter((x) => x.asset_type === "crypto" && x.coingecko_id && x.totalShares > 0).map((x) => x.coingecko_id as string);
    const q = await fetchQuotes(stocks, cryptoIds);
    setQuotes(q);
    setUpdated(new Date());
  }

  useEffect(() => {
    refreshQuotes();
    const t = setInterval(refreshQuotes, 20000);
    return () => clearInterval(t);
  }, [positions.length]);

  function priceFor(p: PositionSummary): number | null {
    const key = p.asset_type === "crypto" ? (p.coingecko_id ?? "") : p.symbol.toUpperCase();
    return quotes[key]?.price ?? null;
  }

  function toggle(symbol: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(symbol) ? next.delete(symbol) : next.add(symbol);
      return next;
    });
  }

  // ── Add/Edit trade ──
  function openAddForm(symbol?: string, assetType?: AssetType) {
    setEditId(null);
    setFormTarget(symbol ?? null);
    setFormSymbol(symbol ?? "");
    setFormAsset(assetType ?? "stock");
    setFormSide("buy");
    setFormQty("");
    setFormPrice("");
    setFormDate(new Date().toISOString().split("T")[0]);
    setFormNote("");
    setFormErr("");
    setShowForm(true);
  }

  function openEditForm(trade: TradeRow) {
    setEditId(trade.id);
    setFormTarget(trade.symbol);
    setFormSymbol(trade.symbol);
    setFormAsset(trade.asset_type);
    setFormSide(trade.side);
    setFormQty(String(trade.quantity));
    setFormPrice(String(trade.price));
    setFormDate(trade.traded_at);
    setFormNote(trade.note ?? "");
    setFormErr("");
    setShowForm(true);
  }

  async function submitTrade(e: React.FormEvent) {
    e.preventDefault();
    setFormErr("");

    const sym = formAsset === "crypto"
      ? (CRYPTO_OPTIONS.find((o) => o.id === formCrypto)?.symbol ?? formCrypto.toUpperCase())
      : formSymbol.trim().toUpperCase();
    const q = parseFloat(formQty);
    const p = parseFloat(formPrice);

    if (!sym) { setFormErr("Enter a ticker symbol."); return; }
    if (!(q > 0)) { setFormErr("Quantity must be greater than 0."); return; }
    if (!(p >= 0)) { setFormErr("Price must be 0 or greater."); return; }
    if (!formDate) { setFormErr("Select a date."); return; }

    if (formSide === "sell" && !editId) {
      const pos = positions.find((x) => x.symbol === sym);
      if (!pos || pos.totalShares < q) {
        setFormErr(`Can't sell ${q} — you only hold ${pos?.totalShares ?? 0} shares.`);
        return;
      }
    }

    const row = {
      symbol: sym,
      asset_type: formAsset,
      coingecko_id: formAsset === "crypto" ? formCrypto : null,
      side: formSide,
      quantity: q,
      price: p,
      traded_at: formDate,
      note: formNote.trim() || null,
    };

    let error;
    if (editId) {
      ({ error } = await supabase.from("trades").update(row).eq("id", editId));
    } else {
      ({ error } = await supabase.from("trades").insert(row));
    }

    if (error) { setFormErr(error.message); return; }

    setShowForm(false);
    setEditId(null);
    await loadTrades();
    refreshQuotes();
  }

  async function deleteTrade(id: number) {
    await supabase.from("trades").delete().eq("id", id);
    await loadTrades();
  }

  // ── Filter + Sort ──
  const filtered = search.trim()
    ? positions.filter((p) => p.symbol.toLowerCase().includes(search.toLowerCase()))
    : positions;

  const sorted = [...filtered].sort((a, b) => {
    const priceA = priceFor(a);
    const priceB = priceFor(b);
    const mktA = priceA != null ? priceA * a.totalShares : 0;
    const mktB = priceB != null ? priceB * b.totalShares : 0;
    const plA = priceA != null ? mktA - a.totalCost : 0;
    const plB = priceB != null ? mktB - b.totalCost : 0;
    const plPctA = a.totalCost > 0 ? (plA / a.totalCost) * 100 : 0;
    const plPctB = b.totalCost > 0 ? (plB / b.totalCost) * 100 : 0;

    switch (sortBy) {
      case "name": return a.symbol.localeCompare(b.symbol);
      case "value": return mktB - mktA;
      case "pl": return plB - plA;
      case "pl_pct": return plPctB - plPctA;
      case "realized": return b.realizedPL - a.realizedPL;
      case "trades": return b.trades.length - a.trades.length;
      default: return 0;
    }
  });

  // ── Totals ──
  let mktTotal = 0, costTotal = 0, realizedTotal = 0;
  for (const p of positions) {
    if (p.totalShares <= 0) {
      realizedTotal += p.realizedPL;
      continue;
    }
    const price = priceFor(p);
    realizedTotal += p.realizedPL;
    if (price != null) {
      mktTotal += price * p.totalShares;
      costTotal += p.totalCost;
    }
  }
  const unrealizedPL = mktTotal - costTotal;
  const unrealizedPct = costTotal > 0 ? (unrealizedPL / costTotal) * 100 : 0;

  return (
    <div>
      {/* ── Title + Currency Toggle ── */}
      <div className="row between">
        <h2 className="page-title" style={{ margin: "4px 2px 16px" }}>Portfolio</h2>
        <button
          className="currency-toggle"
          onClick={() => setCurrency((prev) => prev === "USD" ? "THB" : "USD")}
          title={`Switch to ${currency === "USD" ? "THB" : "USD"}`}
        >
          <span className="currency-icon">{currency === "USD" ? "🇺🇸" : "🇹🇭"}</span>
          <span className="currency-label">{currency}</span>
        </button>
      </div>

      {/* ── Summary Card ── */}
      <div className="glass card">
        <div className="section-label">Total market value</div>
        <div className="big-number mono">{c(mktTotal)}</div>
        <div className="row between" style={{ marginTop: 6 }}>
          <span className={`mono ${unrealizedPL >= 0 ? "pos" : "neg"}`}>
            {unrealizedPL >= 0 ? "▲" : "▼"} {c(Math.abs(unrealizedPL))} ({pct(unrealizedPct)})
          </span>
          <span className="updated">
            {updated ? `updated ${updated.toLocaleTimeString()}` : "fetching…"}
          </span>
        </div>
        <div className="row between" style={{ marginTop: 8 }}>
          <span className="sub">Cost basis {c(costTotal)}</span>
          <span className={`sub mono ${realizedTotal >= 0 ? "pos" : "neg"}`}>
            Realized {realizedTotal >= 0 ? "+" : ""}{c(realizedTotal)}
          </span>
        </div>
        {currency === "THB" && thbRate && (
          <div className="sub" style={{ marginTop: 6 }}>Rate: 1 USD = {thbRate.toFixed(2)} THB</div>
        )}
      </div>

      {/* ── Search + Sort + Add ── */}
      <div className="row between" style={{ margin: "16px 2px 8px", gap: 8, flexWrap: "wrap" }}>
        <input
          id="portfolio-search"
          className="search-input"
          type="text"
          placeholder="🔍 Search tickers…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ flex: "1 1 140px" }}
        />
        <select
          className="sort-select"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortKey)}
        >
          {SORT_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>{o.label}</option>
          ))}
        </select>
        <button className="btn btn-sm btn-accent" onClick={() => openAddForm()}>
          + Add Trade
        </button>
      </div>

      {/* ── Add/Edit Trade Form ── */}
      {showForm && (
        <div className="glass card" style={{ marginBottom: 14 }}>
          <div className="section-label">{editId ? "Edit Trade" : "Log Trade"}</div>
          <form onSubmit={submitTrade}>
            <div className="row" style={{ gap: 8, marginBottom: 12 }}>
              <select value={formAsset} onChange={(e) => setFormAsset(e.target.value as AssetType)} style={{ maxWidth: 110 }}>
                <option value="stock">Stock</option>
                <option value="crypto">Crypto</option>
              </select>
              {formAsset === "stock" ? (
                <input
                  placeholder="Ticker (e.g. SOFI, MTS-GOLD)"
                  value={formSymbol}
                  onChange={(e) => setFormSymbol(e.target.value)}
                  disabled={!!formTarget}
                />
              ) : (
                <select value={formCrypto} onChange={(e) => setFormCrypto(e.target.value)}>
                  {CRYPTO_OPTIONS.map((o) => <option key={o.id} value={o.id}>{o.symbol}</option>)}
                </select>
              )}
            </div>

            <div className="row" style={{ gap: 8, marginBottom: 12 }}>
              <div className="side-toggle">
                <button
                  type="button"
                  className={`side-btn ${formSide === "buy" ? "active buy" : ""}`}
                  onClick={() => setFormSide("buy")}
                >BUY</button>
                <button
                  type="button"
                  className={`side-btn ${formSide === "sell" ? "active sell" : ""}`}
                  onClick={() => setFormSide("sell")}
                >SELL</button>
              </div>
            </div>

            <div className="row" style={{ gap: 8, marginBottom: 12 }}>
              <div className="field" style={{ flex: 1, margin: 0 }}>
                <label>Quantity</label>
                <input type="number" step="any" value={formQty} onChange={(e) => setFormQty(e.target.value)} />
              </div>
              <div className="field" style={{ flex: 1, margin: 0 }}>
                <label>Price (USD)</label>
                <input type="number" step="any" value={formPrice} onChange={(e) => setFormPrice(e.target.value)} />
              </div>
            </div>

            <div className="row" style={{ gap: 8, marginBottom: 12 }}>
              <div className="field" style={{ flex: 1, margin: 0 }}>
                <label>Date</label>
                <input type="date" value={formDate} onChange={(e) => setFormDate(e.target.value)} />
              </div>
              <div className="field" style={{ flex: 1, margin: 0 }}>
                <label>Note (optional)</label>
                <input value={formNote} onChange={(e) => setFormNote(e.target.value)} placeholder="e.g. Webull limit order" />
              </div>
            </div>

            {formQty && formPrice && (
              <div className="sub" style={{ marginBottom: 10 }}>
                Total: {c(parseFloat(formQty) * parseFloat(formPrice))}
              </div>
            )}

            {formErr && <p className="error" style={{ marginBottom: 10 }}>{formErr}</p>}

            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-accent" style={{ flex: 1 }}>
                {editId ? "Save Changes" : `Log ${formSide.toUpperCase()}`}
              </button>
              <button type="button" className="btn" style={{ flex: 0 }} onClick={() => { setShowForm(false); setEditId(null); }}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* ── Positions ── */}
      {loading ? (
        <div className="spin">Loading…</div>
      ) : sorted.length === 0 ? (
        <div className="glass card" style={{ textAlign: "center" }}>
          <p className="sub">
            {search ? `No tickers matching "${search}"` : 'No trades yet. Tap "+ Add Trade" to log your first one.'}
          </p>
        </div>
      ) : (
        sorted.map((pos) => {
          const price = priceFor(pos);
          const mkt = price != null ? price * pos.totalShares : null;
          const unrealized = mkt != null ? mkt - pos.totalCost : null;
          const unrealPct = pos.totalCost > 0 && unrealized != null ? (unrealized / pos.totalCost) * 100 : null;
          const isOpen = pos.totalShares > 0;
          const isExpanded = expanded.has(pos.symbol);

          return (
            <div key={pos.symbol} className={`glass card ticker-card ${!isOpen ? "closed" : ""}`}>
              {/* ── Header row ── */}
              <div className="ticker-header" onClick={() => toggle(pos.symbol)}>
                <div style={{ flex: 1 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <strong className="ticker-name">{pos.symbol}</strong>
                    {pos.asset_type === "crypto" && <span className="pill">CRYPTO</span>}
                    {!isOpen && <span className="pill closed-pill">CLOSED</span>}
                  </div>
                  {isOpen ? (
                    <div className="sub mono">
                      {pos.totalShares} shares @ {c(pos.avgCost)}
                      {price != null && ` · now ${c(price)}`}
                    </div>
                  ) : (
                    <div className="sub">Fully sold · {pos.trades.length} trades</div>
                  )}
                </div>
                <div style={{ textAlign: "right" }}>
                  {isOpen && unrealized != null ? (
                    <>
                      <div className={`mono ${unrealized >= 0 ? "pos" : "neg"}`}>
                        {unrealized >= 0 ? "+" : ""}{c(unrealized)}
                      </div>
                      <div className={`sub mono ${unrealized >= 0 ? "pos" : "neg"}`}>{pct(unrealPct!)}</div>
                    </>
                  ) : !isOpen ? (
                    <div className={`mono ${pos.realizedPL >= 0 ? "pos" : "neg"}`}>
                      {pos.realizedPL >= 0 ? "+" : ""}{c(pos.realizedPL)}
                    </div>
                  ) : (
                    <span className="dim">—</span>
                  )}
                </div>
                <div className={`chevron ${isExpanded ? "open" : ""}`}>▼</div>
              </div>

              {/* ── Realized P/L (for open positions) ── */}
              {isOpen && pos.realizedPL !== 0 && (
                <div className="sub" style={{ marginTop: 4 }}>
                  Realized P/L: <span className={`mono ${pos.realizedPL >= 0 ? "pos" : "neg"}`}>
                    {pos.realizedPL >= 0 ? "+" : ""}{c(pos.realizedPL)}
                  </span>
                </div>
              )}

              {/* ── Expanded: Trade History ── */}
              {isExpanded && (
                <div className="trade-history">
                  <div className="row between" style={{ marginBottom: 8 }}>
                    <span className="section-label" style={{ margin: 0 }}>
                      {pos.trades.length} trade{pos.trades.length !== 1 ? "s" : ""}
                    </span>
                    <button
                      className="btn btn-sm btn-accent"
                      onClick={(e) => { e.stopPropagation(); openAddForm(pos.symbol, pos.asset_type); }}
                    >+ Add</button>
                  </div>

                  {pos.trades.map((t) => (
                    <div key={t.id} className="trade-row">
                      <div className="row" style={{ gap: 8, flex: 1 }}>
                        <span className="trade-date">{fmtDate(t.traded_at)}</span>
                        <span className={`trade-side ${t.side}`}>{t.side.toUpperCase()}</span>
                        <span className="mono">{t.quantity} @ {c(t.price)}</span>
                        <span className="dim mono">{c(t.quantity * t.price)}</span>
                      </div>
                      <div className="row" style={{ gap: 4 }}>
                        {t.note && <span className="dim" title={t.note}>📝</span>}
                        <button className="btn btn-sm" onClick={() => openEditForm(t)} title="Edit">✏️</button>
                        <button className="btn btn-sm btn-danger" onClick={() => deleteTrade(t.id)} title="Delete">🗑</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}
