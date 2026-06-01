import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import { fetchQuotes } from "../lib/quotes";
import type { PositionRow } from "../types";

const usd = (n: number) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

interface LogRow { summary: string | null; sentiment: string | null; run_at: string; }
interface Filing { ticker: string | null; form_type: string | null; filed_at: string | null; title: string | null; }

function sentimentColor(s: string | null): string {
  const v = (s || "").toUpperCase();
  if (v.includes("BULL")) return "var(--green)";
  if (v.includes("BEAR")) return "var(--red)";
  return "var(--text-dim)";
}

export function Dashboard() {
  const [log, setLog] = useState<LogRow | null>(null);
  const [filings, setFilings] = useState<Filing[]>([]);
  const [total, setTotal] = useState<{ mkt: number; pl: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [{ data: logs }, { data: f }, { data: pos }] = await Promise.all([
        supabase.from("analysis_log").select("summary, sentiment, run_at").order("run_at", { ascending: false }).limit(1),
        supabase.from("seen_filings").select("ticker, form_type, filed_at, title").order("created_at", { ascending: false }).limit(5),
        supabase.from("positions").select("*"),
      ]);
      setLog((logs?.[0] as LogRow) ?? null);
      setFilings((f as Filing[]) ?? []);

      const positions = (pos as PositionRow[]) ?? [];
      if (positions.length > 0) {
        const stocks = positions.filter((p) => p.asset_type === "stock").map((p) => p.symbol);
        const cryptoIds = positions.filter((p) => p.asset_type === "crypto" && p.coingecko_id).map((p) => p.coingecko_id as string);
        const q = await fetchQuotes(stocks, cryptoIds);
        let mkt = 0, costPriced = 0;
        for (const p of positions) {
          const key = p.asset_type === "crypto" ? (p.coingecko_id ?? "") : p.symbol.toUpperCase();
          const price = q[key]?.price;
          if (price != null) { mkt += price * p.quantity; costPriced += p.avg_buy_price * p.quantity; }
        }
        setTotal({ mkt, pl: mkt - costPriced });
      }
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="spin">Loading…</div>;

  return (
    <div>
      <h2 className="page-title">Dashboard</h2>

      {/* {total && (
        <div className="glass card">
          <div className="section-label">Portfolio value</div>
          <div className="row between">
            <span className="big-number mono">{usd(total.mkt)}</span>
            <span className={`mono ${total.pl >= 0 ? "pos" : "neg"}`}>
              {total.pl >= 0 ? "▲" : "▼"} {usd(Math.abs(total.pl))}
            </span>
          </div>
        </div>
      )} */}

      <div className="glass card" style={{ marginTop: 14 }}>
        <div className="row between" style={{ marginBottom: 8 }}>
          <div className="section-label" style={{ margin: 0 }}>Latest AI summary</div>
          {log?.sentiment && (
            <span className="pill" style={{ color: sentimentColor(log.sentiment), borderColor: sentimentColor(log.sentiment) }}>
              {log.sentiment}
            </span>
          )}
        </div>
        {log?.summary ? (
          <>
            <div className="wrap-pre" style={{ maxHeight: 360, overflow: "auto" }}>{log.summary}</div>
            <div className="updated" style={{ marginTop: 10 }}>
              {new Date(log.run_at).toLocaleString()}
            </div>
          </>
        ) : (
          <p className="sub">No analysis yet — the bot runs on a schedule.</p>
        )}
      </div>

      <div className="glass card" style={{ marginTop: 14 }}>
        <div className="section-label">Recent SEC filings</div>
        {filings.length === 0 ? (
          <p className="sub">None in the recent window.</p>
        ) : (
          filings.map((f, i) => (
            <div className="list-row" key={i}>
              <div className="row" style={{ gap: 8 }}>
                <strong>{f.ticker}</strong>
                <span className="dim">{f.form_type}</span>
              </div>
              <span className="updated">{f.filed_at}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
