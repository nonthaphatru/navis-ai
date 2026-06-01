// ============================================
// Navis AI — Event Alerts
// ============================================
// Separate from the 30-min news digest. This ONLY pings you when something
// actionable happens:
//   • PRICE MOVES   — a holding/watchlist ticker moves past a % threshold
//   • SEC FILINGS   — a new 8-K / 10-Q / 10-K / Form 4 for your holdings
//   • EARNINGS      — an upcoming earnings report for a watched ticker
// Plus a `?mode=heartbeat` health check (run daily) that confirms the
// stock + crypto pipelines are still firing.
//
// All free: reuses the Finnhub key; SEC EDGAR needs no key.
// ============================================

/// <reference lib="deno.ns" />

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Configuration ──────────────────────────────────────────────────────────────

const FINNHUB_API_KEY = Deno.env.get("FINNHUB_API_KEY") ?? "";
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// Optional: if set, callers must send header `x-navis-secret: <value>`.
const TRIGGER_SECRET = Deno.env.get("TRIGGER_SECRET") ?? "";

// SEC requires a User-Agent that identifies you. Set SEC_CONTACT_EMAIL to your
// email as a secret; otherwise a generic placeholder is used.
const SEC_CONTACT_EMAIL = Deno.env.get("SEC_CONTACT_EMAIL") ?? "navis-ai@example.com";
const SEC_USER_AGENT = `NavisAI/1.0 (${SEC_CONTACT_EMAIL})`;

// ── Tickers ──────────────────────────────────────────────────────────────────
// Keep roughly in sync with WATCHED_TICKERS in analyze-stocks/index.ts.

// DEFAULTS — overwritten at runtime from the `watchlist` / `app_settings` tables
// (managed in the web UI). Used as-is when those tables are empty.

// Your actual holdings — smaller move threshold + SEC monitoring.
const DEFAULT_HOLDINGS = ["SOFI", "PLTR"];

// Broader watchlist — only alerted on bigger moves.
const DEFAULT_WATCHLIST = [
  "NVDA", "GOOGL", "TSLA", "AAPL", "MSFT", "META", "AMZN", "AMD", "AVGO", "CRM",
  "HOOD", "ZS", "SOUN", "AI", "BBAI", "IONQ",
];

// Mutable — populated by loadConfig() at the start of each run.
let HOLDINGS: string[] = [...DEFAULT_HOLDINGS];
let WATCHLIST: string[] = [...DEFAULT_WATCHLIST];

// ── Thresholds (defaults; overridden by app_settings) ───────────────────────────

let HOLDING_MOVE_PCT = 4;  // alert when a holding moves >= this % intraday
let WATCH_MOVE_PCT = 7;    // alert when a watchlist name moves >= this %
let SEC_ALERTS_ENABLED = true;
let EARNINGS_ALERTS_ENABLED = true;

/**
 * Load holdings/watchlist from `watchlist` and thresholds/toggles from
 * `app_settings`. Falls back to the hardcoded defaults when tables are empty.
 */
async function loadConfig(supabase: any): Promise<void> {
  try {
    const { data: wl } = await supabase
      .from("watchlist")
      .select("symbol, is_holding")
      .eq("asset_type", "stock")
      .order("sort_order", { ascending: true });
    if (wl && wl.length > 0) {
      const syms = wl.map((r: any) => ({ s: String(r.symbol).toUpperCase(), h: !!r.is_holding }));
      HOLDINGS = syms.filter((x) => x.h).map((x) => x.s);
      WATCHLIST = syms.filter((x) => !x.h).map((x) => x.s);
      if (HOLDINGS.length === 0) { HOLDINGS = WATCHLIST.slice(0, 2); WATCHLIST = WATCHLIST.slice(2); }
      console.log(`📋 watchlist: ${HOLDINGS.length} holdings, ${WATCHLIST.length} watch`);
    } else {
      console.log("📋 watchlist empty — using defaults");
    }
  } catch (err) {
    console.error("loadConfig watchlist failed:", err);
  }
  try {
    const { data: s } = await supabase
      .from("app_settings")
      .select("holding_move_pct, watch_move_pct, sec_alerts_enabled, earnings_alerts_enabled")
      .limit(1)
      .maybeSingle();
    if (s) {
      if (typeof s.holding_move_pct === "number") HOLDING_MOVE_PCT = s.holding_move_pct;
      if (typeof s.watch_move_pct === "number") WATCH_MOVE_PCT = s.watch_move_pct;
      if (typeof s.sec_alerts_enabled === "boolean") SEC_ALERTS_ENABLED = s.sec_alerts_enabled;
      if (typeof s.earnings_alerts_enabled === "boolean") EARNINGS_ALERTS_ENABLED = s.earnings_alerts_enabled;
      console.log(`⚙️ settings: hold>=${HOLDING_MOVE_PCT}% watch>=${WATCH_MOVE_PCT}% sec=${SEC_ALERTS_ENABLED} earn=${EARNINGS_ALERTS_ENABLED}`);
    }
  } catch (err) {
    console.error("loadConfig settings failed:", err);
  }
}

const SEC_FORMS = ["8-K", "10-Q", "10-K", "4"];
const SEC_FORM_LABEL: Record<string, string> = {
  "8-K": "Material event (8-K)",
  "10-Q": "Quarterly report (10-Q)",
  "10-K": "Annual report (10-K)",
  "4": "Insider trade (Form 4)",
};
const SEC_LOOKBACK_HOURS = 26; // how far back to consider a filing "new"

const EARNINGS_LOOKAHEAD_DAYS = 2;

// Heartbeat: warn if a pipeline hasn't logged a run within this many hours.
const HEARTBEAT_MAX_AGE_HOURS = 2;

// ── Telegram ─────────────────────────────────────────────────────────────────

async function sendTelegram(text: string): Promise<boolean> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return false;
  const trimmed = text.length > 4090 ? text.slice(0, 4087) + "..." : text;
  try {
    const res = await fetch(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: TELEGRAM_CHAT_ID,
          text: trimmed,
          disable_web_page_preview: true,
        }),
      }
    );
    if (!res.ok) console.error(`Telegram error: ${res.status}`, (await res.text()).slice(0, 150));
    return res.ok;
  } catch (err) {
    console.error("Telegram failed:", err);
    return false;
  }
}

// ── Price-move alerts ─────────────────────────────────────────────────────────

async function checkPriceMoves(supabase: any): Promise<string[]> {
  if (!FINNHUB_API_KEY) return [];
  const today = new Date().toISOString().split("T")[0];
  const lines: string[] = [];

  const targets = [
    ...HOLDINGS.map((t) => ({ ticker: t, hold: true })),
    ...WATCHLIST.map((t) => ({ ticker: t, hold: false })),
  ];

  for (const { ticker, hold } of targets) {
    try {
      const res = await fetch(
        `https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${FINNHUB_API_KEY}`
      );
      if (!res.ok) continue;
      const q = await res.json();
      const dp = typeof q.dp === "number" ? q.dp : null;
      if (dp === null || !q.c) continue;

      const threshold = hold ? HOLDING_MOVE_PCT : WATCH_MOVE_PCT;
      if (Math.abs(dp) < threshold) continue;

      const direction = dp > 0 ? "up" : "down";

      // Skip if we already alerted this same direction today.
      const { data: prev } = await supabase
        .from("price_alert_state")
        .select("last_alert_date, last_direction")
        .eq("ticker", ticker)
        .maybeSingle();
      if (prev && prev.last_alert_date === today && prev.last_direction === direction) {
        continue;
      }

      const arrow = dp > 0 ? "🟢▲" : "🔴▼";
      const star = hold ? " ⭐" : "";
      lines.push(`• ${ticker}${star} ${arrow} ${dp > 0 ? "+" : ""}${dp.toFixed(1)}% → $${q.c.toFixed(2)}`);

      await supabase.from("price_alert_state").upsert({
        ticker,
        last_alert_date: today,
        last_direction: direction,
        last_pct: dp,
        updated_at: new Date().toISOString(),
      });

      await new Promise((r) => setTimeout(r, 120)); // respect Finnhub rate limit
    } catch (err) {
      console.error(`Price check failed for ${ticker}:`, err);
    }
  }
  console.log(`📉 Price alerts: ${lines.length}`);
  return lines;
}

// ── SEC EDGAR filing alerts ─────────────────────────────────────────────────

/**
 * Build a { TICKER: 10-digit-CIK } map from SEC's official ticker list.
 */
async function buildTickerCikMap(tickers: string[]): Promise<Record<string, string>> {
  try {
    const res = await fetch("https://www.sec.gov/files/company_tickers.json", {
      headers: { "User-Agent": SEC_USER_AGENT },
    });
    if (!res.ok) {
      console.error(`SEC ticker map error: ${res.status}`);
      return {};
    }
    const data = await res.json();
    const want = new Set(tickers.map((t) => t.toUpperCase()));
    const map: Record<string, string> = {};
    for (const key of Object.keys(data)) {
      const row = data[key];
      const sym = String(row?.ticker || "").toUpperCase();
      if (want.has(sym) && !map[sym]) {
        map[sym] = String(row.cik_str).padStart(10, "0");
      }
    }
    return map;
  } catch (err) {
    console.error("SEC ticker map failed:", err);
    return {};
  }
}

async function checkSecFilings(supabase: any): Promise<string[]> {
  const lines: string[] = [];
  const cikMap = await buildTickerCikMap(HOLDINGS);
  const cutoff = new Date(Date.now() - SEC_LOOKBACK_HOURS * 60 * 60 * 1000);

  for (const ticker of HOLDINGS) {
    const cik = cikMap[ticker];
    if (!cik) {
      console.log(`No CIK for ${ticker}, skipping SEC check`);
      continue;
    }
    try {
      const res = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, {
        headers: { "User-Agent": SEC_USER_AGENT },
      });
      if (!res.ok) {
        console.error(`SEC submissions error for ${ticker}: ${res.status}`);
        continue;
      }
      const data = await res.json();
      const recent = data?.filings?.recent;
      if (!recent?.form) continue;

      const forms: string[] = recent.form || [];
      const accs: string[] = recent.accessionNumber || [];
      const dates: string[] = recent.filingDate || [];
      const docs: string[] = recent.primaryDocument || [];
      const descs: string[] = recent.primaryDocDescription || [];

      for (let i = 0; i < forms.length && i < 40; i++) {
        const form = forms[i];
        if (!SEC_FORMS.includes(form)) continue;

        const filed = new Date(dates[i]);
        if (isNaN(filed.getTime()) || filed < cutoff) continue;

        const acc = accs[i];
        if (!acc) continue;

        // Dedupe by accession number.
        const { data: seen } = await supabase
          .from("seen_filings")
          .select("accession_no")
          .eq("accession_no", acc)
          .maybeSingle();
        if (seen) continue;

        const accNoDash = acc.replace(/-/g, "");
        const url = `https://www.sec.gov/Archives/edgar/data/${parseInt(cik, 10)}/${accNoDash}/${docs[i] || ""}`;
        lines.push(`• ${ticker} ⭐ ${SEC_FORM_LABEL[form] || form} — ${dates[i]}\n  ${url}`);

        await supabase.from("seen_filings").insert({
          accession_no: acc,
          ticker,
          form_type: form,
          filed_at: dates[i],
          title: descs[i] || null,
        });
      }
      await new Promise((r) => setTimeout(r, 150));
    } catch (err) {
      console.error(`SEC check failed for ${ticker}:`, err);
    }
  }
  console.log(`🏛️ SEC alerts: ${lines.length}`);
  return lines;
}

// ── Earnings reminders ─────────────────────────────────────────────────────

async function checkEarnings(supabase: any): Promise<string[]> {
  if (!FINNHUB_API_KEY) return [];
  const lines: string[] = [];
  const from = new Date().toISOString().split("T")[0];
  const to = new Date(Date.now() + EARNINGS_LOOKAHEAD_DAYS * 86400000)
    .toISOString()
    .split("T")[0];

  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/calendar/earnings?from=${from}&to=${to}&token=${FINNHUB_API_KEY}`
    );
    if (!res.ok) {
      console.error(`Finnhub earnings calendar error: ${res.status}`);
      return [];
    }
    const data = await res.json();
    const watch = new Set([...HOLDINGS, ...WATCHLIST]);
    const events = data?.earningsCalendar || [];

    for (const e of events) {
      const sym = String(e.symbol || "").toUpperCase();
      if (!watch.has(sym)) continue;

      const { data: sent } = await supabase
        .from("sent_earnings_reminders")
        .select("id")
        .eq("ticker", sym)
        .eq("earnings_date", e.date)
        .maybeSingle();
      if (sent) continue;

      const hold = HOLDINGS.includes(sym);
      const when = e.hour === "amc" ? "after close" : e.hour === "bmo" ? "before open" : "";
      const epsEst = e.epsEstimate != null ? ` (EPS est $${e.epsEstimate})` : "";
      lines.push(`• ${sym}${hold ? " ⭐" : ""} reports ${e.date} ${when}${epsEst}`.trimEnd());

      await supabase
        .from("sent_earnings_reminders")
        .insert({ ticker: sym, earnings_date: e.date });
    }
  } catch (err) {
    console.error("Earnings check failed:", err);
  }
  console.log(`📅 Earnings reminders: ${lines.length}`);
  return lines;
}

// ── Heartbeat ─────────────────────────────────────────────────────────────

async function heartbeat(supabase: any): Promise<void> {
  const checks = [
    { table: "analysis_log", label: "📈 Stocks" },
    { table: "crypto_analysis_log", label: "🪙 Crypto" },
  ];
  const statusLines: string[] = [];
  let problems = 0;

  for (const c of checks) {
    const { data, error } = await supabase
      .from(c.table)
      .select("run_at")
      .order("run_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data?.run_at) {
      statusLines.push(`${c.label}: ⚠️ no runs found`);
      problems++;
      continue;
    }
    const ageH = (Date.now() - new Date(data.run_at).getTime()) / 3600000;
    if (ageH > HEARTBEAT_MAX_AGE_HOURS) {
      statusLines.push(`${c.label}: ⚠️ last run ${ageH.toFixed(1)}h ago`);
      problems++;
    } else {
      statusLines.push(`${c.label}: ✅ ${ageH.toFixed(1)}h ago`);
    }
  }

  const head = problems > 0 ? "⚠️ NAVIS HEARTBEAT — needs attention" : "✅ NAVIS HEARTBEAT — all good";
  await sendTelegram(`${head}\n\n${statusLines.join("\n")}`);
}

// ── Main Handler ─────────────────────────────────────────────────────────────

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  // Optional shared-secret gate.
  if (TRIGGER_SECRET && req.headers.get("x-navis-secret") !== TRIGGER_SECRET) {
    return new Response("Forbidden", { status: 403 });
  }

  const missing: string[] = [];
  if (!SUPABASE_URL) missing.push("SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) missing.push("TELEGRAM_BOT_TOKEN/CHAT_ID");
  if (missing.length > 0) {
    return json({ status: "error", error: `Missing env: ${missing.join(", ")}` }, 500);
  }

  const mode = new URL(req.url).searchParams.get("mode") || "alerts";
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    if (mode === "heartbeat") {
      await heartbeat(supabase);
      return json({ status: "ok", mode });
    }

    // Load watchlist + thresholds/toggles from the DB (web-UI managed).
    await loadConfig(supabase);

    // Run the enabled checks independently — one failing source can't kill the rest.
    const [priceR, secR, earnR] = await Promise.allSettled([
      checkPriceMoves(supabase),
      SEC_ALERTS_ENABLED ? checkSecFilings(supabase) : Promise.resolve([]),
      EARNINGS_ALERTS_ENABLED ? checkEarnings(supabase) : Promise.resolve([]),
    ]);

    const priceLines = priceR.status === "fulfilled" ? priceR.value : [];
    const secLines = secR.status === "fulfilled" ? secR.value : [];
    const earnLines = earnR.status === "fulfilled" ? earnR.value : [];

    const sections: string[] = [];
    if (priceLines.length) sections.push("📉 PRICE MOVES\n" + priceLines.join("\n"));
    if (secLines.length) sections.push("🏛️ SEC FILINGS\n" + secLines.join("\n"));
    if (earnLines.length) sections.push("📅 EARNINGS SOON\n" + earnLines.join("\n"));

    let sent = false;
    if (sections.length > 0) {
      sent = await sendTelegram("🚨 NAVIS ALERTS\n\n" + sections.join("\n\n"));
    }

    return json({
      status: "ok",
      mode,
      price: priceLines.length,
      sec: secLines.length,
      earnings: earnLines.length,
      sent,
    });
  } catch (err) {
    console.error("❌ Alerts function error:", err);
    await sendTelegram(`⚠️ Navis alerts function error:\n${String(err).slice(0, 300)}`);
    return json({ status: "error", error: String(err) }, 500);
  }
});
