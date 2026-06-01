// ============================================
// Navis AI -- Live Quotes (browser-facing)
// ============================================
// Returns realtime prices for the web app's portfolio P&L. Keeps the Finnhub
// key server-side. Stocks via Finnhub, crypto via CoinGecko (no key).
//
// Called from the browser via supabase.functions.invoke('quotes', { body }),
// which attaches the logged-in user's JWT -> only authenticated users can call.
//
// Request body: { stocks?: string[], crypto?: { id: string }[] }
// Response: { "SOFI": { price, changePct }, "bitcoin": { price, changePct } }
// ============================================

/// <reference lib="deno.ns" />

const FINNHUB_API_KEY = Deno.env.get("FINNHUB_API_KEY") ?? "";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

interface Quote {
  price: number;
  changePct: number | null;
}

async function fetchStockQuotes(symbols: string[]): Promise<Record<string, Quote>> {
  const out: Record<string, Quote> = {};
  if (!FINNHUB_API_KEY) return out;
  for (const raw of symbols) {
    const symbol = raw.toUpperCase().trim();
    if (!symbol) continue;
    try {
      const res = await fetch(
        `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_API_KEY}`
      );
      if (!res.ok) continue;
      const q = await res.json();
      if (typeof q.c === "number" && q.c > 0) {
        out[symbol] = { price: q.c, changePct: typeof q.dp === "number" ? q.dp : null };
      }
      await new Promise((r) => setTimeout(r, 90)); // respect rate limits
    } catch (err) {
      console.error(`quote ${symbol} failed:`, err);
    }
  }
  return out;
}

async function fetchCryptoQuotes(ids: string[]): Promise<Record<string, Quote>> {
  const out: Record<string, Quote> = {};
  const clean = ids.map((i) => i.toLowerCase().trim()).filter(Boolean);
  if (clean.length === 0) return out;
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${clean.join(",")}&sparkline=false`
    );
    if (!res.ok) return out;
    const data = await res.json();
    for (const c of data || []) {
      out[c.id] = {
        price: c.current_price,
        changePct: typeof c.price_change_percentage_24h === "number" ? c.price_change_percentage_24h : null,
      };
    }
  } catch (err) {
    console.error("crypto quotes failed:", err);
  }
  return out;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "Use POST" }, 405);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const stocks: string[] = Array.isArray(body?.stocks) ? body.stocks : [];
    const cryptoIds: string[] = Array.isArray(body?.crypto)
      ? body.crypto.map((c: any) => (typeof c === "string" ? c : c?.id)).filter(Boolean)
      : [];

    const [stockQuotes, cryptoQuotes] = await Promise.all([
      fetchStockQuotes(stocks),
      fetchCryptoQuotes(cryptoIds),
    ]);

    return json({ ...stockQuotes, ...cryptoQuotes });
  } catch (err) {
    console.error("quotes error:", err);
    return json({ error: String(err) }, 500);
  }
});
