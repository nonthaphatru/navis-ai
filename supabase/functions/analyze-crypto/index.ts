/// <reference lib="deno.ns" />

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Configuration ──────────────────────────────────────────────────────────────

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY") ?? "";
const CRYPTO_TELEGRAM_BOT_TOKEN = Deno.env.get("CRYPTO_TELEGRAM_BOT_TOKEN") ?? "";
const CRYPTO_TELEGRAM_CHAT_ID = Deno.env.get("CRYPTO_TELEGRAM_CHAT_ID") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// ── Crypto Watchlist ───────────────────────────────────────────────────────────

const CRYPTO_IDS = ["bitcoin", "ethereum"]; // CoinGecko IDs
const CRYPTO_SYMBOLS: Record<string, string> = {
  bitcoin: "BTC",
  ethereum: "ETH",
};

// RSS queries for crypto news
const CRYPTO_RSS_QUERIES = [
  { query: "bitcoin BTC crypto", category: "priority" },
  { query: "ethereum ETH crypto", category: "priority" },
  { query: "cryptocurrency market", category: "market" },
  { query: "crypto regulation SEC", category: "regulation" },
  { query: "DeFi web3 blockchain", category: "defi" },
  { query: "crypto stablecoin USDT USDC", category: "stablecoin" },
];

interface CryptoArticle {
  title: string;
  source: string;
  url: string;
  publishedAt: string;
  category: string;
}

interface CryptoPrice {
  id: string;
  symbol: string;
  current_price: number;
  price_change_percentage_24h: number;
  price_change_percentage_7d: number;
  market_cap: number;
  total_volume: number;
  high_24h: number;
  low_24h: number;
  ath: number;
  ath_change_percentage: number;
}

interface MarketGlobal {
  total_market_cap: number;
  total_volume: number;
  btc_dominance: number;
  market_cap_change_24h: number;
}

// ── Helper: XML tag extraction ─────────────────────────────────────────────────

function extractXmlTag(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[(.+?)\\]\\]></${tag}>|<${tag}[^>]*>(.+?)</${tag}>`, "s");
  const match = xml.match(regex);
  return match ? (match[1] || match[2] || "").trim() : "";
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'");
}

// ── CoinGecko: Fetch prices ───────────────────────────────────────────────────

async function fetchCryptoPrices(): Promise<CryptoPrice[]> {
  try {
    const ids = CRYPTO_IDS.join(",");
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&order=market_cap_desc&sparkline=false&price_change_percentage=7d`
    );
    if (!res.ok) {
      console.error(`CoinGecko prices error: ${res.status}`);
      return [];
    }
    const data = await res.json();
    return data.map((c: any) => ({
      id: c.id,
      symbol: (c.symbol || "").toUpperCase(),
      current_price: c.current_price,
      price_change_percentage_24h: c.price_change_percentage_24h,
      price_change_percentage_7d: c.price_change_percentage_7d_in_currency,
      market_cap: c.market_cap,
      total_volume: c.total_volume,
      high_24h: c.high_24h,
      low_24h: c.low_24h,
      ath: c.ath,
      ath_change_percentage: c.ath_change_percentage,
    }));
  } catch (err) {
    console.error("CoinGecko prices failed:", err);
    return [];
  }
}

// ── CoinGecko: Fetch global market data ───────────────────────────────────────

async function fetchGlobalMarket(): Promise<MarketGlobal | null> {
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/global");
    if (!res.ok) return null;
    const data = await res.json();
    const d = data.data;
    return {
      total_market_cap: d.total_market_cap?.usd || 0,
      total_volume: d.total_volume?.usd || 0,
      btc_dominance: d.market_cap_percentage?.btc || 0,
      market_cap_change_24h: d.market_cap_change_percentage_24h_usd || 0,
    };
  } catch {
    return null;
  }
}

// ── Fetch crypto news from Google RSS ─────────────────────────────────────────

async function fetchCryptoNews(): Promise<CryptoArticle[]> {
  const articles: CryptoArticle[] = [];
  const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000); // 6 hours

  for (const { query, category } of CRYPTO_RSS_QUERIES) {
    try {
      const encodedQuery = encodeURIComponent(`${query} when:1d`);
      const res = await fetch(
        `https://news.google.com/rss/search?q=${encodedQuery}&hl=en-US&gl=US&ceid=US:en`
      );
      if (!res.ok) continue;
      const xml = await res.text();

      const items = xml.split("<item>").slice(1);
      const limit = category === "priority" ? 5 : 3;
      for (const item of items.slice(0, limit)) {
        const title = extractXmlTag(item, "title");
        const pubDate = extractXmlTag(item, "pubDate");
        const source = extractXmlTag(item, "source");

        if (!title) continue;

        const articleDate = pubDate ? new Date(pubDate) : new Date();
        if (articleDate < cutoff) continue;

        articles.push({
          title: decodeHtmlEntities(title),
          source: source || "Google News",
          url: extractXmlTag(item, "link") || "",
          publishedAt: articleDate.toISOString(),
          category,
        });
      }
    } catch (err) {
      console.error(`RSS fetch error for "${query}":`, err);
    }
  }

  return articles;
}

// ── Fetch from crypto-specific RSS feeds ──────────────────────────────────────

async function fetchCryptoRssFeeds(): Promise<CryptoArticle[]> {
  const feeds = [
    { url: "https://cointelegraph.com/rss", source: "CoinTelegraph" },
    { url: "https://www.coindesk.com/arc/outboundfeeds/rss/", source: "CoinDesk" },
  ];

  const articles: CryptoArticle[] = [];
  const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000);

  for (const feed of feeds) {
    try {
      const res = await fetch(feed.url, {
        headers: { "User-Agent": "NavisCryptoAI/1.0" },
      });
      if (!res.ok) continue;
      const xml = await res.text();

      const items = xml.split("<item>").slice(1);
      for (const item of items.slice(0, 5)) {
        const title = extractXmlTag(item, "title");
        const pubDate = extractXmlTag(item, "pubDate");

        if (!title) continue;

        const articleDate = pubDate ? new Date(pubDate) : new Date();
        if (articleDate < cutoff) continue;

        articles.push({
          title: decodeHtmlEntities(title),
          source: feed.source,
          url: extractXmlTag(item, "link") || "",
          publishedAt: articleDate.toISOString(),
          category: "crypto",
        });
      }
    } catch {
      // Skip failed feeds
    }
  }

  return articles;
}

// ── Deduplication ──────────────────────────────────────────────────────────────

async function deduplicateCryptoArticles(
  supabase: any,
  articles: CryptoArticle[]
): Promise<CryptoArticle[]> {
  const hashes = articles.map((a) => {
    const raw = `${a.title.substring(0, 80).toLowerCase()}`;
    let hash = 0;
    for (let i = 0; i < raw.length; i++) {
      const char = raw.charCodeAt(i);
      hash = ((hash << 5) - hash + char) | 0;
    }
    return Math.abs(hash).toString(36);
  });

  const { data: existing } = await supabase
    .from("crypto_seen_articles")
    .select("article_hash")
    .in("article_hash", hashes);

  const seenSet = new Set((existing || []).map((r: any) => r.article_hash));
  const newArticles: CryptoArticle[] = [];
  const newHashes: string[] = [];

  articles.forEach((article, i) => {
    if (!seenSet.has(hashes[i])) {
      newArticles.push(article);
      newHashes.push(hashes[i]);
    }
  });

  if (newHashes.length > 0) {
    const rows = newHashes.map((h) => ({ article_hash: h }));
    await supabase.from("crypto_seen_articles").insert(rows);
  }

  return newArticles;
}

// ── AI Providers ───────────────────────────────────────────────────────────────

async function callGemini(prompt: string): Promise<string | null> {
  if (!GEMINI_API_KEY) return null;

  const MODELS = ["gemini-2.5-flash"];
  for (const model of MODELS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: {
                temperature: 0.3,
                maxOutputTokens: 8192,
                thinkingConfig: { thinkingBudget: 0 },
              },
            }),
          }
        );

        if (!res.ok) {
          const err = await res.text();
          console.error(`Gemini ${model} ${res.status}:`, err.substring(0, 150));
          if ((res.status === 503 || res.status === 429) && attempt < 1) continue;
          break;
        }

        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        if (text) {
          console.log(`✅ Gemini ${model} success`);
          return text;
        }
      } catch (err) {
        console.error(`Gemini ${model} failed:`, err);
        break;
      }
    }
  }
  return null;
}

async function callGroq(prompt: string): Promise<string | null> {
  if (!GROQ_API_KEY) return null;

  const MODELS = ["llama-3.3-70b-versatile", "llama-3.1-8b-instant"];
  for (const model of MODELS) {
    try {
      console.log(`🤖 Groq ${model}...`);
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: "You are a crypto market analyst. Provide concise, data-driven analysis." },
            { role: "user", content: prompt },
          ],
          temperature: 0.3,
          max_tokens: 4000,
        }),
      });

      if (!res.ok) {
        console.error(`Groq ${model} error: ${res.status}`);
        continue;
      }

      const data = await res.json();
      const text = data?.choices?.[0]?.message?.content || "";
      if (text) {
        console.log(`✅ Groq ${model} success`);
        return text;
      }
    } catch (err) {
      console.error(`Groq ${model} failed:`, err);
    }
  }
  return null;
}

// ── Analysis ───────────────────────────────────────────────────────────────────

async function analyzeCrypto(
  articles: CryptoArticle[],
  prices: CryptoPrice[],
  global: MarketGlobal | null
): Promise<{ summary: string; sentiment: string; priority: string }> {
  const capped = articles.slice(0, 30);

  const articleText = capped
    .map((a, i) => `[${i + 1}] [${a.category.toUpperCase()}] ${a.title} (${a.source})`)
    .join("\n");

  const priceText = prices
    .map((p) => {
      const change24 = p.price_change_percentage_24h?.toFixed(2) || "N/A";
      const change7d = p.price_change_percentage_7d?.toFixed(2) || "N/A";
      const mcap = (p.market_cap / 1e9).toFixed(1);
      const vol = (p.total_volume / 1e9).toFixed(1);
      const fromATH = p.ath_change_percentage?.toFixed(1) || "N/A";
      return `${p.symbol}: $${p.current_price.toLocaleString()} | 24h: ${change24}% | 7d: ${change7d}% | MCap: $${mcap}B | Vol: $${vol}B | ATH: $${p.ath.toLocaleString()} (${fromATH}%) | 24h Range: $${p.low_24h.toLocaleString()} - $${p.high_24h.toLocaleString()}`;
    })
    .join("\n");

  const globalText = global
    ? `Total Market Cap: $${(global.total_market_cap / 1e12).toFixed(2)}T | 24h Change: ${global.market_cap_change_24h.toFixed(2)}% | BTC Dominance: ${global.btc_dominance.toFixed(1)}% | 24h Volume: $${(global.total_volume / 1e9).toFixed(0)}B`
    : "Global data unavailable";

  const prompt = `You are a crypto market analyst. Analyze the latest crypto data and news.

PORTFOLIO: BTC, ETH
INTERESTS: DeFi, regulation, institutional adoption, macro impact on crypto

⚠️ CRITICAL: The HEADLINE section MUST come FIRST for Apple Watch readability.

FORMAT (follow this EXACT order):

[Start with 2-3 bullet points of the most important crypto news. No header. Each = 1 line max.]
• [Most important crypto news - brief]
• [Second most important - brief]
• [Third if notable - brief]

🎯 [BULLISH 🟢 / BEARISH 🔴 / NEUTRAL ⚪ / MIXED 🟡] | ⚡ [BTC ↑↓, ETH ↑↓, DeFi ↑↓, NFTs ↑↓, Alts ↑↓, Stables ↑↓]

———————————

💰 PRICES
${priceText}

🌍 MARKET: ${globalText}

🪙 BTC ANALYSIS
[2-3 sentences: price action, key levels, sentiment]

💎 ETH ANALYSIS
[2-3 sentences: price action, key levels, sentiment]

🏛️ REGULATION & MACRO
[1-2 sentences on SEC, Fed, institutional moves]

💡 KEY TAKEAWAY: [1 sentence]

PRIORITY: [HIGH/NORMAL]

RULES:
- Use the LIVE PRICE DATA above — don't make up numbers
- Keep total response under 500 words
- Current time: ${new Date().toUTCString()}

ARTICLES:
${articleText}`;

  // Provider chain: Gemini → Groq → Raw
  console.log("🔗 AI Provider Chain: Gemini → Groq → Raw");

  let text = await callGemini(prompt);
  let provider = "gemini";

  if (!text) {
    text = await callGroq(prompt);
    provider = "groq";
  }

  if (!text) {
    // Raw fallback
    const rawSummary = [
      `🪙 CRYPTO — Raw Headlines (AI unavailable)`,
      ``,
      ...prices.map((p) => `${p.symbol}: $${p.current_price.toLocaleString()} (${p.price_change_percentage_24h?.toFixed(2)}%)`),
      ``,
      ...capped.slice(0, 10).map((a) => `• ${a.title} (${a.source})`),
    ].join("\n");

    return { summary: rawSummary, sentiment: "UNKNOWN", priority: "NORMAL" };
  }

  console.log(`✅ Crypto analysis from ${provider} (${text.length} chars)`);

  const priorityMatch = text.match(/PRIORITY:\s*(HIGH|NORMAL)/i);
  const priority = priorityMatch?.[1]?.toUpperCase() || "NORMAL";

  const sentimentMatch = text.match(/BULLISH|BEARISH|NEUTRAL|MIXED/i);
  const sentiment = sentimentMatch?.[0]?.toUpperCase() || "NEUTRAL";

  return { summary: text, sentiment, priority };
}

// ── Telegram ───────────────────────────────────────────────────────────────────

async function sendTelegram(
  summary: string,
  priority: string,
  articleCount: number
): Promise<boolean> {
  if (!CRYPTO_TELEGRAM_BOT_TOKEN || !CRYPTO_TELEGRAM_CHAT_ID) return false;

  try {
    const trimmed = summary.length > 4090 ? summary.substring(0, 4087) + "..." : summary;

    const res = await fetch(
      `https://api.telegram.org/bot${CRYPTO_TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: CRYPTO_TELEGRAM_CHAT_ID,
          text: trimmed,
          disable_web_page_preview: true,
        }),
      }
    );

    if (!res.ok) {
      const err = await res.text();
      console.error(`Crypto Telegram error: ${res.status}`, err.substring(0, 200));
      return false;
    }
    console.log("✅ Crypto Telegram sent");
    return true;
  } catch (err) {
    console.error("Crypto Telegram failed:", err);
    return false;
  }
}

// ── Main Handler ───────────────────────────────────────────────────────────────

Deno.serve(async (_req: Request) => {
  const startTime = Date.now();
  console.log("🪙 Crypto analysis pipeline started");

  // Validate config
  const missingKeys = [];
  if (!GEMINI_API_KEY && !GROQ_API_KEY) missingKeys.push("GEMINI_API_KEY or GROQ_API_KEY");
  if (!CRYPTO_TELEGRAM_BOT_TOKEN) missingKeys.push("CRYPTO_TELEGRAM_BOT_TOKEN");
  if (!SUPABASE_URL) missingKeys.push("SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) missingKeys.push("SUPABASE_SERVICE_ROLE_KEY");

  if (missingKeys.length > 0) {
    const error = `Missing: ${missingKeys.join(", ")}`;
    console.error(error);
    return new Response(JSON.stringify({ error }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // ── Step 1: Fetch data in parallel ──
    console.log("📡 Fetching crypto prices, news...");
    const [prices, global, googleNews, rssNews] = await Promise.all([
      fetchCryptoPrices(),
      fetchGlobalMarket(),
      fetchCryptoNews(),
      fetchCryptoRssFeeds(),
    ]);

    const allArticles = [...googleNews, ...rssNews];
    console.log(
      `📊 Prices: ${prices.length} coins | News: ${allArticles.length} articles (Google: ${googleNews.length}, RSS: ${rssNews.length})`
    );

    if (allArticles.length === 0 && prices.length === 0) {
      await supabase.from("crypto_analysis_log").insert({
        articles_found: 0,
        new_articles: 0,
        summary: "No data found",
        notification_sent: false,
      });
      return new Response(
        JSON.stringify({ status: "ok", message: "No data" }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // ── Step 2: Deduplicate ──
    const newArticles = await deduplicateCryptoArticles(supabase, allArticles);
    console.log(`✨ ${newArticles.length} new articles after dedup`);

    // Even if no new articles, we still have prices to report
    const articlesToAnalyze = newArticles.length > 0 ? newArticles : allArticles.slice(0, 10);

    // ── Step 3: Analyze ──
    console.log("🧠 Analyzing crypto...");
    const analysis = await analyzeCrypto(articlesToAnalyze, prices, global);

    // ── Step 4: Send notification ──
    console.log("📱 Sending notification...");
    const notificationSent = await sendTelegram(
      analysis.summary,
      analysis.priority,
      articlesToAnalyze.length
    );

    // ── Step 5: Log ──
    await supabase.from("crypto_analysis_log").insert({
      articles_found: allArticles.length,
      new_articles: newArticles.length,
      summary: analysis.summary,
      sentiment: analysis.sentiment,
      priority: analysis.priority,
      notification_sent: notificationSent,
    });

    const elapsed = Date.now() - startTime;
    console.log(`🏁 Done in ${elapsed}ms`);

    return new Response(
      JSON.stringify({
        status: "ok",
        articlesFound: allArticles.length,
        newArticles: newArticles.length,
        prices: prices.map((p) => `${p.symbol}: $${p.current_price}`),
        sentiment: analysis.sentiment,
        priority: analysis.priority,
        notificationSent,
        elapsedMs: elapsed,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("💥 Pipeline error:", err);
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
