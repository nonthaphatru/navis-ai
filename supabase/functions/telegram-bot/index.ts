/// <reference types="https://esm.sh/@anthropic-ai/sdk@0.24.0" />
/// <reference lib="deno.ns" />

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Configuration ──────────────────────────────────────────────────────────────

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID") ?? "";
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY") ?? "";
const FINNHUB_API_KEY = Deno.env.get("FINNHUB_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// ── AI Providers ───────────────────────────────────────────────────────────────

async function askGemini(prompt: string): Promise<string | null> {
  if (!GEMINI_API_KEY) return null;
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 2048,
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text || null;
  } catch {
    return null;
  }
}

async function askGroq(prompt: string): Promise<string | null> {
  if (!GROQ_API_KEY) return null;
  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${GROQ_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: "You are Navis AI, a concise financial analyst assistant. Answer questions about stocks, markets, and portfolio positions. Keep responses brief and mobile-friendly." },
          { role: "user", content: prompt },
        ],
        temperature: 0.4,
        max_tokens: 1500,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.choices?.[0]?.message?.content || null;
  } catch {
    return null;
  }
}

async function askAI(prompt: string): Promise<string> {
  const answer = await askGemini(prompt) || await askGroq(prompt);
  return answer || "⚠️ AI is currently unavailable. Try again in a moment.";
}

// ── Telegram Reply ─────────────────────────────────────────────────────────────

async function sendReply(chatId: number | string, text: string): Promise<void> {
  const trimmed = text.length > 4090 ? text.substring(0, 4087) + "..." : text;
  await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: trimmed,
      disable_web_page_preview: true,
    }),
  });
}

// ── Live Stock Lookup ─────────────────────────────────────────────────────────────

// Common words to NOT treat as tickers (excluding real tickers like NOW, AI, RUN, ALL)
const IGNORE_WORDS = new Set([
  "THE", "AND", "FOR", "ARE", "BUT", "NOT", "YOU", "CAN", "HAS", "HER",
  "WAS", "ONE", "OUR", "OUT", "DAY", "HAD", "HOT", "OIL", "SIT", "OLD",
  "DID", "GET", "HIM", "HIS", "HOW", "ITS", "LET", "SAY", "SHE", "TOO",
  "USE", "WAR", "WAY", "WHO", "BOY", "NEW", "BAD",
  "ANY", "WHY", "ASK", "MEN", "RED", "FAR", "SET",
  "WHAT", "WITH", "THAT", "THIS", "HAVE", "FROM", "THEY", "BEEN", "SOME", "WHEN",
  "WILL", "MORE", "MAKE", "LIKE", "JUST", "KNOW", "TAKE", "COME", "GOOD",
  "HOLD", "LONG", "HIGH", "LOOK", "WELL", "BACK", "MUCH", "THEN", "ALSO", "DOWN",
  "ABOUT", "WOULD", "THINK", "STOCK", "TODAY", "GOING", "TELL",
]);

// Popular company name → ticker map (instant, no API call) test
const COMPANY_TO_TICKER: Record<string, string> = {
  "apple": "AAPL", "google": "GOOGL", "alphabet": "GOOGL", "amazon": "AMZN",
  "microsoft": "MSFT", "meta": "META", "facebook": "META", "tesla": "TSLA",
  "nvidia": "NVDA", "netflix": "NFLX", "palantir": "PLTR", "sofi": "SOFI",
  "cloudflare": "NET", "crowdstrike": "CRWD", "snowflake": "SNOW",
  "datadog": "DDOG", "servicenow": "NOW", "salesforce": "CRM",
  "robinhood": "HOOD", "coinbase": "COIN", "shopify": "SHOP",
  "uber": "UBER", "airbnb": "ABNB", "spotify": "SPOT", "disney": "DIS",
  "amd": "AMD", "intel": "INTC", "broadcom": "AVGO", "zscaler": "ZS",
  "soundhound": "SOUN", "c3ai": "AI", "c3.ai": "AI", "bigbear": "BBAI",
  "bigbear.ai": "BBAI", "ionq": "IONQ", "ast spacemobile": "ASTS",
  "spacemobile": "ASTS", "rocketlab": "RKLB", "rocket lab": "RKLB",
  "supermicro": "SMCI", "arm": "ARM", "oracle": "ORCL", "ibm": "IBM",
  "adobe": "ADBE", "paypal": "PYPL", "block": "SQ", "square": "SQ",
  "snap": "SNAP", "snapchat": "SNAP", "pinterest": "PINS", "reddit": "RDDT",
  "rivian": "RIVN", "lucid": "LCID", "nio": "NIO", "boeing": "BA",
  "jpmorgan": "JPM", "goldman": "GS", "berkshire": "BRK.B",
};

/**
 * Search Finnhub for a company name → ticker
 */
async function searchTicker(query: string): Promise<string | null> {
  if (!FINNHUB_API_KEY) return null;
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/search?q=${encodeURIComponent(query)}&token=${FINNHUB_API_KEY}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    // Find first US stock result (no dots = not foreign)
    const match = data?.result?.find(
      (r: any) => r.type === "Common Stock" && !r.symbol.includes(".")
    );
    return match?.symbol || data?.result?.[0]?.symbol || null;
  } catch {
    return null;
  }
}

/**
 * Extract tickers from text — handles ticker symbols, company names, and dynamic search
 */
async function extractTickers(text: string): Promise<string[]> {
  const tickers: string[] = [];
  const lowerText = text.toLowerCase();
  const resolvedWords = new Set<string>();

  // 1. Check hardcoded company names first (multi-word names first)
  const sortedNames = Object.keys(COMPANY_TO_TICKER).sort((a, b) => b.length - a.length);
  for (const name of sortedNames) {
    if (lowerText.includes(name) && tickers.length < 3) {
      const ticker = COMPANY_TO_TICKER[name];
      if (!tickers.includes(ticker)) {
        tickers.push(ticker);
        // Mark words as resolved so we don't search them again
        name.split(/\s+/).forEach((w) => resolvedWords.add(w));
      }
    }
  }

  // 2. Extract uppercase ticker symbols (e.g., SOFI, PLTR)
  const words = text.toUpperCase().match(/\b[A-Z]{1,5}\b/g) || [];
  for (const w of words) {
    if (!IGNORE_WORDS.has(w) && !tickers.includes(w) && tickers.length < 3) {
      tickers.push(w);
      resolvedWords.add(w.toLowerCase());
    }
  }

  // 3. Find remaining unresolved words that could be company names
  if (tickers.length < 3) {
    const FILLER_WORDS = new Set([
      "what", "about", "how", "is", "the", "doing", "tell", "me", "stock",
      "price", "compare", "vs", "versus", "and", "or", "for", "with", "a",
      "an", "to", "of", "in", "on", "it", "be", "do", "my", "at", "by",
      "between", "should", "would", "could", "can", "will", "are", "was",
      "has", "have", "been", "being", "think", "buy", "sell", "hold", "look",
      "check", "show", "give", "update", "latest", "news", "today", "now",
      "performance", "analysis", "opinion", "thoughts", "good", "bad",
    ]);

    // Extract potential company name words (3+ chars, not filler, not already resolved)
    const potentialNames = lowerText
      .split(/[\s,;:!?()]+/)
      .filter((w) => w.length >= 3 && !FILLER_WORDS.has(w) && !resolvedWords.has(w) && !IGNORE_WORDS.has(w.toUpperCase()));

    if (potentialNames.length > 0 && tickers.length < 3) {
      // Search up to 2 unresolved terms in parallel
      const toSearch = potentialNames.slice(0, 2);
      console.log(`🔍 Searching Finnhub for: ${toSearch.join(", ")}`);
      const results = await Promise.all(toSearch.map((term) => searchTicker(term)));
      for (const found of results) {
        if (found && !tickers.includes(found) && tickers.length < 3) {
          tickers.push(found);
        }
      }
    }
  }

  return tickers.slice(0, 3);
}

/**
 * Fetch live quote + earnings + analyst sentiment + news from Finnhub
 */
async function fetchTickerData(ticker: string): Promise<string> {
  if (!FINNHUB_API_KEY) return "";

  try {
    const today = new Date().toISOString().split("T")[0];
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split("T")[0];
    const t = FINNHUB_API_KEY;

    // Fetch all data in parallel
    const [quoteRes, newsRes, earningsRes, recoRes, metricsRes] = await Promise.all([
      fetch(`https://finnhub.io/api/v1/quote?symbol=${ticker}&token=${t}`),
      fetch(`https://finnhub.io/api/v1/company-news?symbol=${ticker}&from=${weekAgo}&to=${today}&token=${t}`),
      fetch(`https://finnhub.io/api/v1/stock/earnings?symbol=${ticker}&limit=4&token=${t}`),
      fetch(`https://finnhub.io/api/v1/stock/recommendation?symbol=${ticker}&token=${t}`),
      fetch(`https://finnhub.io/api/v1/stock/metric?symbol=${ticker}&metric=all&token=${t}`),
    ]);

    let info = `\n📊 LIVE DATA for ${ticker}:\n`;

    // Price quote
    if (quoteRes.ok) {
      const q = await quoteRes.json();
      if (q.c && q.c > 0) {
        const change = q.dp ? `${q.dp > 0 ? "+" : ""}${q.dp.toFixed(2)}%` : "N/A";
        info += `💰 Price: $${q.c.toFixed(2)} | Day: ${change} | High: $${q.h?.toFixed(2)} | Low: $${q.l?.toFixed(2)}\n`;
      } else {
        info += `No quote data (ticker may be invalid).\n`;
        return info;
      }
    }

    // Basic financials
    if (metricsRes.ok) {
      const m = await metricsRes.json();
      const met = m?.metric;
      if (met) {
        const parts = [];
        if (met.marketCapitalization) parts.push(`MCap: $${(met.marketCapitalization / 1000).toFixed(1)}B`);
        if (met.peBasicExclExtraTTM) parts.push(`P/E: ${met.peBasicExclExtraTTM.toFixed(1)}`);
        if (met["52WeekHigh"]) parts.push(`52w High: $${met["52WeekHigh"].toFixed(2)}`);
        if (met["52WeekLow"]) parts.push(`52w Low: $${met["52WeekLow"].toFixed(2)}`);
        if (parts.length > 0) info += `📈 ${parts.join(" | ")}\n`;
      }
    }

    // Earnings (last 2 quarters)
    if (earningsRes.ok) {
      const earnings = await earningsRes.json();
      if (earnings?.length > 0) {
        info += `💵 Recent Earnings:\n`;
        for (const e of earnings.slice(0, 2)) {
          const beat = e.actual > e.estimate ? "✅ BEAT" : e.actual < e.estimate ? "❌ MISS" : "➡️ MET";
          info += `  Q${e.quarter || "?"} ${e.year || ""}: EPS $${e.actual?.toFixed(2) ?? "?"} vs est $${e.estimate?.toFixed(2) ?? "?"} ${beat}\n`;
        }
      }
    }

    // Analyst recommendations
    if (recoRes.ok) {
      const recs = await recoRes.json();
      if (recs?.length > 0) {
        const latest = recs[0];
        info += `🎯 Analyst Consensus: ${latest.strongBuy || 0} Strong Buy | ${latest.buy || 0} Buy | ${latest.hold || 0} Hold | ${latest.sell || 0} Sell | ${latest.strongSell || 0} Strong Sell\n`;
      }
    }

    // News headlines
    if (newsRes.ok) {
      const news = await newsRes.json();
      if (news?.length > 0) {
        info += `📰 Headlines:\n`;
        for (const n of news.slice(0, 4)) {
          info += `• ${n.headline} (${n.source})\n`;
        }
      }
    }

    return info;
  } catch {
    return "";
  }
}

// ── Main Handler ───────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("OK", { status: 200 });
  }

  try {
    const update = await req.json();
    const message = update?.message;
    if (!message?.text || !message?.chat?.id) {
      return new Response("OK", { status: 200 });
    }

    const chatId = message.chat.id;
    const userText = message.text.trim();

    // Security: only respond to the authorized user
    if (String(chatId) !== TELEGRAM_CHAT_ID) {
      console.log(`⚠️ Unauthorized chat: ${chatId}`);
      return new Response("OK", { status: 200 });
    }

    // Handle /start command
    if (userText === "/start") {
      await sendReply(chatId,
        "🚀 Navis AI Stock Bot\n\n" +
        "Ask me anything about your portfolio or the market!\n\n" +
        "Examples:\n" +
        "• How's SOFI doing?\n" +
        "• What's happening with NVDA?\n" +
        "• Summarize today's market\n" +
        "• Should I worry about PLTR?\n" +
        "• What's the latest on Trump tariffs?\n\n" +
        "Commands:\n" +
        "/summary — Get the latest analysis\n" +
        "/portfolio — Show watchlist status"
      );
      return new Response("OK", { status: 200 });
    }

    // Fetch latest analysis from DB for context
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { data: latestLog } = await supabase
      .from("analysis_log")
      .select("summary, run_at, sentiment")
      .order("run_at", { ascending: false })
      .limit(1)
      .single();

    const latestContext = latestLog
      ? `Latest analysis (${new Date(latestLog.run_at).toUTCString()}):\n${latestLog.summary}`
      : "No recent analysis available.";

    // Handle /summary command
    if (userText === "/summary") {
      if (latestLog?.summary) {
        await sendReply(chatId, latestLog.summary);
      } else {
        await sendReply(chatId, "No analysis available yet. Wait for the next scheduled run.");
      }
      return new Response("OK", { status: 200 });
    }

    // Handle /portfolio command
    if (userText === "/portfolio") {
      const prompt = `Based on this latest market analysis, give a brief status update on each stock in the portfolio.

Portfolio: SOFI (largest position), PLTR, NVDA, GOOGL, TSLA, AAPL, MSFT, META, AMD, AVGO, CRM, HOOD, ZS, SOUN, AI, BBAI, IONQ

For each stock that has info, write one line: ticker + brief status + ↑/↓/→ arrow.
Skip stocks with no data. Keep it very concise.

${latestContext}`;

      const answer = await askAI(prompt);
      await sendReply(chatId, answer);
      return new Response("OK", { status: 200 });
    }

    // Free-form question — detect tickers and fetch live data
    console.log(`💬 Question from user: ${userText.substring(0, 100)}`);

    // Extract tickers and fetch live data
    const detectedTickers = await extractTickers(userText);
    let liveData = "";
    if (detectedTickers.length > 0) {
      console.log(`📊 Detected tickers: ${detectedTickers.join(", ")}`);
      const tickerResults = await Promise.all(
        detectedTickers.map((t) => fetchTickerData(t))
      );
      liveData = tickerResults.filter(Boolean).join("\n");
    }

    // Choose prompt based on single vs multi-ticker
    const isComparison = detectedTickers.length >= 2;
    const tickerList = detectedTickers.join(" vs ");

    const prompt = isComparison
      ? `You are Navis AI. The user wants to COMPARE these stocks: ${tickerList}

${liveData}

Current time: ${new Date().toUTCString()}

User's question: ${userText}

FORMAT YOUR RESPONSE EXACTLY LIKE THIS:

📊 ${tickerList}

[Create a comparison table with aligned columns. Use these rows:]
         ${detectedTickers.join("      ")}
💰 Price [price for each]
📈 Day   [% change for each]
📈 52w   [52-week range or % from low]
💵 P/E   [P/E ratio for each]
🏦 MCap  [market cap for each]

💵 LAST EARNINGS
[For each ticker: ticker: Q? ✅BEAT/❌MISS $actual vs $estimate]

🎯 ANALYSTS
[For each ticker: ticker: X Buy | X Hold | X Sell]

📰 KEY NEWS
[1 headline per ticker]

💡 VERDICT: [2-3 sentence comparison — which is strongest, best value, highest risk, and why]

RULES:
- Use the LIVE DATA above — don't make up numbers
- Align the comparison table for readability
- Be specific with numbers
- Keep it concise and mobile-friendly`.trim()
      : `You are Navis AI, a personal stock market assistant. The user is holding SOFI (largest), and watching: PLTR, NVDA, GOOGL, TSLA, AAPL, MSFT, META, AMD, AVGO, CRM, HOOD, ZS, SOUN, AI, BBAI, IONQ.

${latestContext}
${liveData ? "\n" + liveData : ""}

Current time: ${new Date().toUTCString()}

User's question: ${userText}

IMPORTANT RULES:
- If the user mentions a ticker (even one NOT in their watchlist), treat it as a stock ticker and answer about it.
- ALWAYS structure your answer for a specific stock like this:
  1. Current price and today's move
  2. 📊 Sentiment: [Bullish/Bearish/Neutral] based on analyst consensus, recent price action, and news tone
  3. 💵 Latest earnings: Did they beat or miss? EPS actual vs estimate. Revenue trend if known.
  4. 🎯 Analyst view: Summarize the buy/hold/sell breakdown
  5. 📰 Key news: 1-2 most important recent headlines
  6. 💡 Quick take: 1-sentence opinion
- If you have live data above, USE ALL OF IT in your answer.
- Keep it concise and mobile-friendly with emoji.
- If the ticker has no data, say "I couldn't find data for [TICKER]. It may be an invalid or delisted ticker."`.trim();

    const answer = await askAI(prompt);
    await sendReply(chatId, answer);

    return new Response("OK", { status: 200 });
  } catch (err) {
    console.error("Telegram bot error:", err);
    return new Response("OK", { status: 200 });
  }
});
