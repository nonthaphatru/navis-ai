// ============================================
// Stock & Trump News Analysis — Supabase Edge Function
// ============================================
// Fetches US stock market + Trump-related news, analyzes with Gemini AI,
// and pushes concise summaries to iPhone/Apple Watch via ntfy.sh.
// ============================================

/// <reference types="https://esm.sh/@supabase/functions-js/src/edge-runtime.d.ts" />

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Configuration ──────────────────────────────────────────────────────────────

const FINNHUB_API_KEY = Deno.env.get("FINNHUB_API_KEY") ?? "";
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") ?? "";
const GROQ_API_KEY = Deno.env.get("GROQ_API_KEY") ?? "";
const NTFY_TOPIC = Deno.env.get("NTFY_TOPIC") ?? "";
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const TELEGRAM_CHAT_ID = Deno.env.get("TELEGRAM_CHAT_ID") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// ── Portfolio & Watchlist ───────────────────────────────────────────────────────

// 🔴 TOP PRIORITY — Largest positions
const PRIORITY_TICKERS = ["SOFI", "PLTR"];

// Core watchlist — fetched via Finnhub company news (rotated each run)
const WATCHED_TICKERS = [
  // Priority holdings (always fetched first)
  "SOFI", "PLTR",
  // AI & Tech majors
  "NVDA", "GOOGL", "TSLA", "AAPL", "MSFT", "META", "AMZN", "AMD", "AVGO", "CRM",
  // Fintech
  "HOOD",
  // Cybersecurity
  "ZS",
  // AI mid/small caps
  "SOUN", "AI", "BBAI", "IONQ",
];

// Google News RSS search queries (filtered to last 24h via 'when:1d')
const RSS_QUERIES = [
  // Trump
  { query: "Trump stock market", category: "trump" },
  { query: "Trump tariff trade war", category: "trump" },
  { query: "Trump economy policy executive order", category: "trump" },
  // War & Geopolitics
  { query: "war geopolitics stock market impact", category: "geopolitics" },
  { query: "Russia Ukraine war economy", category: "geopolitics" },
  { query: "China Taiwan tensions market", category: "geopolitics" },
  // S&P 500 & Market
  { query: "S&P 500 index today", category: "market" },
  { query: "Federal Reserve interest rate decision", category: "market" },
  // AI Industry
  { query: "artificial intelligence stocks technology", category: "ai" },
  { query: "AI chip semiconductor demand", category: "ai" },
  // Gold & Commodities
  { query: "gold price XAU precious metals", category: "commodity" },
  // Priority stock-specific
  { query: "SoFi Technologies stock", category: "priority" },
  { query: "Palantir PLTR stock", category: "priority" },
  { query: "Robinhood HOOD stock fintech", category: "company" },
];

// Direct RSS feeds from reliable financial outlets (no API key needed)
const DIRECT_RSS_FEEDS = [
  { url: "https://feeds.marketwatch.com/marketwatch/topstories/", source: "MarketWatch", limit: 8 },
  { url: "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114", source: "CNBC", limit: 8 },
  { url: "https://feeds.finance.yahoo.com/rss/2.0/headline?s=^GSPC&region=US&lang=en-US", source: "Yahoo Finance", limit: 6 },
];

// Max article age in hours — discard anything older
const MAX_ARTICLE_AGE_HOURS = 6;

// ── Types ──────────────────────────────────────────────────────────────────────

interface NewsArticle {
  title: string;
  source: string;
  url: string;
  summary: string;
  publishedAt: string;
  category: string; // "market" | "company" | "trump" | "geopolitics" | "ai" | "priority"
  relatedTicker?: string;
  isPriority?: boolean; // true for SOFI, HOOD related articles
}

// ── Helper: Hash a string (for deduplication) ──────────────────────────────────

async function hashString(str: string): Promise<string> {
  const data = new TextEncoder().encode(str);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── News Fetchers ──────────────────────────────────────────────────────────────

/**
 * Fetch general market news from Finnhub
 */
async function fetchFinnhubGeneralNews(): Promise<NewsArticle[]> {
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/news?category=general&token=${FINNHUB_API_KEY}`
    );
    if (!res.ok) {
      console.error(`Finnhub general news error: ${res.status}`);
      return [];
    }
    const data = await res.json();
    return (data || []).slice(0, 15).map((item: any) => ({
      title: item.headline || "",
      source: item.source || "Finnhub",
      url: item.url || "",
      summary: item.summary || "",
      publishedAt: item.datetime
        ? new Date(item.datetime * 1000).toISOString()
        : new Date().toISOString(),
      category: "market",
    }));
  } catch (err) {
    console.error("Finnhub general news fetch failed:", err);
    return [];
  }
}

/**
 * Fetch company-specific news from Finnhub for watched tickers.
 * Priority tickers (SOFI, HOOD) are ALWAYS fetched.
 * Remaining tickers rotate each run to stay within rate limits.
 */
async function fetchFinnhubCompanyNews(): Promise<NewsArticle[]> {
  const today = new Date().toISOString().split("T")[0];
  const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString().split("T")[0];
  const articles: NewsArticle[] = [];

  // Always fetch priority tickers first
  const otherTickers = WATCHED_TICKERS.filter((t) => !PRIORITY_TICKERS.includes(t));

  // Rotate through other tickers — pick 4 based on current 30-min slot
  const slotIndex = Math.floor(Date.now() / (30 * 60 * 1000)) % otherTickers.length;
  const rotatedOthers: string[] = [];
  for (let i = 0; i < 4 && i < otherTickers.length; i++) {
    rotatedOthers.push(otherTickers[(slotIndex + i) % otherTickers.length]);
  }

  const tickersToFetch = [...PRIORITY_TICKERS, ...rotatedOthers];
  console.log(`📋 Fetching company news for: ${tickersToFetch.join(", ")}`);

  for (const ticker of tickersToFetch) {
    try {
      const res = await fetch(
        `https://finnhub.io/api/v1/company-news?symbol=${ticker}&from=${twoDaysAgo}&to=${today}&token=${FINNHUB_API_KEY}`
      );
      if (!res.ok) continue;
      const data = await res.json();
      const isPriority = PRIORITY_TICKERS.includes(ticker);
      const limit = isPriority ? 8 : 4; // More articles for priority stocks
      const top = (data || []).slice(0, limit).map((item: any) => ({
        title: item.headline || "",
        source: item.source || "Finnhub",
        url: item.url || "",
        summary: item.summary || "",
        publishedAt: item.datetime
          ? new Date(item.datetime * 1000).toISOString()
          : new Date().toISOString(),
        category: isPriority ? "priority" : "company",
        relatedTicker: ticker,
        isPriority,
      }));
      articles.push(...top);
      // Small delay between requests to respect rate limits
      await new Promise((r) => setTimeout(r, 150));
    } catch (err) {
      console.error(`Finnhub company news failed for ${ticker}:`, err);
    }
  }
  return articles;
}

/**
 * Fetch news from Google News RSS — filtered to last 24 hours
 */
async function fetchGoogleRssNews(): Promise<NewsArticle[]> {
  const articles: NewsArticle[] = [];

  for (const { query, category } of RSS_QUERIES) {
    try {
      // 'when:1d' restricts Google News to last 24 hours
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
        const link = extractXmlTag(item, "link");
        const pubDate = extractXmlTag(item, "pubDate");
        const source = extractXmlTag(item, "source");

        if (title) {
          articles.push({
            title: decodeHtmlEntities(title),
            source: source || "Google News",
            url: link || "",
            summary: "",
            publishedAt: pubDate
              ? new Date(pubDate).toISOString()
              : new Date().toISOString(),
            category,
            isPriority: category === "priority",
          });
        }
      }
      await new Promise((r) => setTimeout(r, 100));
    } catch (err) {
      console.error(`Google News RSS failed for "${query}":`, err);
    }
  }
  return articles;
}

/**
 * Fetch from direct financial outlet RSS feeds (MarketWatch, CNBC, Yahoo Finance)
 */
async function fetchDirectRssFeeds(): Promise<NewsArticle[]> {
  const articles: NewsArticle[] = [];

  for (const feed of DIRECT_RSS_FEEDS) {
    try {
      const res = await fetch(feed.url);
      if (!res.ok) {
        console.error(`${feed.source} RSS error: ${res.status}`);
        continue;
      }
      const xml = await res.text();

      const items = xml.split("<item>").slice(1);
      for (const item of items.slice(0, feed.limit)) {
        const title = extractXmlTag(item, "title");
        const link = extractXmlTag(item, "link");
        const pubDate = extractXmlTag(item, "pubDate");
        const description = extractXmlTag(item, "description");

        if (title) {
          articles.push({
            title: decodeHtmlEntities(title),
            source: feed.source,
            url: link || "",
            summary: description ? decodeHtmlEntities(description).substring(0, 200) : "",
            publishedAt: pubDate
              ? new Date(pubDate).toISOString()
              : new Date().toISOString(),
            category: "market",
          });
        }
      }
      await new Promise((r) => setTimeout(r, 100));
    } catch (err) {
      console.error(`${feed.source} RSS fetch failed:`, err);
    }
  }
  return articles;
}

/**
 * Filter out articles older than MAX_ARTICLE_AGE_HOURS
 */
function filterFreshArticles(articles: NewsArticle[]): NewsArticle[] {
  const cutoff = new Date(Date.now() - MAX_ARTICLE_AGE_HOURS * 60 * 60 * 1000);
  const fresh = articles.filter((a) => {
    try {
      return new Date(a.publishedAt) >= cutoff;
    } catch {
      return true; // Keep articles with unparseable dates
    }
  });
  console.log(`🕐 Freshness filter: ${fresh.length}/${articles.length} articles within last ${MAX_ARTICLE_AGE_HOURS}h`);
  return fresh;
}

/**
 * Extract content from an XML tag
 */
function extractXmlTag(xml: string, tag: string): string {
  // Handle CDATA sections
  const cdataRegex = new RegExp(
    `<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`,
    "i"
  );
  const cdataMatch = xml.match(cdataRegex);
  if (cdataMatch) return cdataMatch[1].trim();

  // Handle regular content
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const match = xml.match(regex);
  return match ? match[1].trim() : "";
}

/**
 * Decode common HTML entities
 */
function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/");
}

// ── Deduplication ──────────────────────────────────────────────────────────────

/**
 * Filter out already-seen articles using the database
 */
async function deduplicateArticles(
  supabase: any,
  articles: NewsArticle[]
): Promise<NewsArticle[]> {
  if (articles.length === 0) return [];

  // Generate hashes
  const articlesWithHashes = await Promise.all(
    articles.map(async (article) => ({
      article,
      hash: await hashString(`${article.title}|${article.source}`),
    }))
  );

  // Check which hashes already exist
  const hashes = articlesWithHashes.map((a) => a.hash);
  const { data: existing } = await supabase
    .from("seen_articles")
    .select("article_hash")
    .in("article_hash", hashes);

  const existingSet = new Set((existing || []).map((e: any) => e.article_hash));

  // Filter to only new articles
  const newArticles = articlesWithHashes.filter(
    (a) => !existingSet.has(a.hash)
  );

  // Insert new hashes
  if (newArticles.length > 0) {
    await supabase.from("seen_articles").insert(
      newArticles.map((a) => ({
        article_hash: a.hash,
        title: a.article.title.substring(0, 500),
        source: a.article.source,
      }))
    );
  }

  return newArticles.map((a) => a.article);
}

// ── AI Analysis (Multi-Provider) ───────────────────────────────────────────────

/**
 * Call Gemini API with retry
 */
async function callGemini(prompt: string): Promise<string | null> {
  if (!GEMINI_API_KEY) return null;

  const MODELS = ["gemini-2.5-flash"];
  const MAX_RETRIES = 2;
  const RETRY_DELAYS = [5000, 15000];

  for (const model of MODELS) {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          const delay = RETRY_DELAYS[attempt - 1] || 15000;
          console.log(`⏳ Gemini retry ${attempt}/${MAX_RETRIES} after ${delay / 1000}s...`);
          await new Promise((r) => setTimeout(r, delay));
        }

        console.log(`🤖 Gemini ${model} (attempt ${attempt + 1})`);
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
          if ((res.status === 503 || res.status === 429) && attempt < MAX_RETRIES) continue;
          break; // Try next model or give up
        }

        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || "";
        if (text) {
          console.log(`✅ Gemini ${model} success`);
          return text;
        }
      } catch (err) {
        console.error(`Gemini ${model} failed:`, err);
        if (attempt >= MAX_RETRIES) break;
      }
    }
  }
  return null;
}

/**
 * Call Groq API (free tier: 14,400 req/day, 30 req/min)
 */
async function callGroq(prompt: string): Promise<string | null> {
  if (!GROQ_API_KEY) {
    console.log("⚠️ GROQ_API_KEY not set, skipping Groq fallback");
    return null;
  }

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
            { role: "system", content: "You are a concise financial news analyst. Follow the user's format instructions exactly." },
            { role: "user", content: prompt },
          ],
          temperature: 0.3,
          max_tokens: 2000,
        }),
      });

      if (!res.ok) {
        const err = await res.text();
        console.error(`Groq ${model} ${res.status}:`, err.substring(0, 150));
        if (res.status === 429) continue; // Try next model
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

/**
 * Analyze articles — tries Gemini first, then Groq, then raw headlines
 */
async function analyzeWithAI(
  articles: NewsArticle[]
): Promise<{ summary: string; sentiment: string; priority: string; raw: any }> {
  // Cap articles to avoid bloated input — priority articles first, then others
  const priorityFirst = [
    ...articles.filter((a) => a.isPriority || PRIORITY_TICKERS.includes(a.relatedTicker || "")),
    ...articles.filter((a) => !a.isPriority && !PRIORITY_TICKERS.includes(a.relatedTicker || "")),
  ];
  const capped = priorityFirst.slice(0, 35);
  console.log(`📝 Sending ${capped.length}/${articles.length} articles to AI`);

  const articleText = capped
    .map(
      (a, i) =>
        `[${i + 1}] [${a.category.toUpperCase()}${a.relatedTicker ? " - " + a.relatedTicker : ""}] ${a.title} (${a.source})${a.summary ? " — " + a.summary.substring(0, 150) : ""}`
    )
    .join("\n");

  // Separate priority articles for emphasis
  const priorityArticles = articles.filter((a) => a.isPriority || PRIORITY_TICKERS.includes(a.relatedTicker || ""));

  const prompt = `You are a financial news analyst. Analyze ALL these articles and create a mobile-friendly summary optimized for Apple Watch + iPhone.

PORTFOLIO: SOFI (largest), PLTR | Watch: NVDA, GOOGL, TSLA, AAPL, ZS, MSFT, META, AMD, AVGO, CRM, HOOD, SOUN, AI, BBAI, IONQ
INTERESTS: Trump, war/geopolitics, S&P 500, AI/tech, GOLD price

⚠️ CRITICAL FORMAT RULE: The HEADLINE section MUST come FIRST because Apple Watch truncates text. Put the most important info at the very top.

FORMAT (follow this EXACT order):

[Start immediately with 2-3 short bullet points summarizing THE most important news. No header text before them. Each bullet = 1 line max. This is what shows on Apple Watch.]
• [Most important news - brief]
• [Second most important - brief]
• [Third if notable - brief]

🎯 [BULLISH 🟢 / BEARISH 🔴 / NEUTRAL ⚪ / MIXED 🟡] | ⚡ [List ALL relevant sectors with ↑↓ arrows: Tech, AI, Fintech, Energy, Oil, Defense, Healthcare, Banks, Crypto, Retail, Real Estate, Semiconductors, Software, EVs, etc.]

———————————

📈 STOCK BREAKDOWN
• SOFI: [detail] ⭐
• PLTR: [detail] ⭐
• NVDA: [detail]
• TSLA: [detail]
• AAPL: [detail]
• GOOGL: [detail]
• HOOD: [detail]
• ZS: [detail]
[Add others with news, skip those without]

🥇 GOLD
[Gold price direction, key level, and what's driving it — 1 sentence. ALWAYS include this.]

🏛️ TRUMP & GEOPOLITICS
[1-2 sentences]

🤖 AI & TECH
[1-2 sentences]

💡 KEY TAKEAWAY: [1 sentence]

PRIORITY: [HIGH/NORMAL]

RULES:
- HEADLINE section is THE most important part — it must be readable standalone on a tiny screen
- SOFI and PLTR get ⭐ (my holdings) marker
- Use specific numbers (%, $) when available
- Keep TOTAL response under 500 words
- Don't invent news for stocks with no articles
- Current time: ${new Date().toUTCString()}

${ priorityArticles.length > 0 ? "\nPRIORITY ARTICLES (SOFI/PLTR):\n" + priorityArticles.map((a, i) => `[P${i+1}] ${a.title} (${a.source})`).join("\n") + "\n" : ""}
ALL ARTICLES:
${articleText}`;

  // ── Provider Chain: Gemini → Groq → Raw Headlines ──
  console.log("🔗 AI Provider Chain: Gemini → Groq → Raw");

  // 1. Try Gemini (primary)
  let text = await callGemini(prompt);
  let provider = "Gemini";

  // 2. Fallback to Groq
  if (!text) {
    console.log("⚠️ Gemini exhausted, trying Groq...");
    text = await callGroq(prompt);
    provider = "Groq";
  }

  // 3. Final fallback: raw headlines (no AI)
  if (!text) {
    console.log("⚠️ All AI providers exhausted, sending raw headlines");
    const rawSummary = [
      `📊 NAVIS AI — Raw Headlines (AI unavailable)`,
      `📰 ${capped.length} articles from ${new Date().toUTCString()}`,
      ``,
      ...capped.slice(0, 15).map((a) => `• ${a.relatedTicker ? `[${a.relatedTicker}] ` : ""}${a.title} (${a.source})`),
    ].join("\n");

    return {
      summary: rawSummary,
      sentiment: "UNKNOWN",
      priority: "NORMAL",
      raw: { error: "All AI providers exhausted", provider: "none" },
    };
  }

  console.log(`✅ Analysis from ${provider} (${text.length} chars)`);

  // Extract priority from the response
  const priorityMatch = text.match(/PRIORITY:\s*(HIGH|NORMAL)/i);
  const priority = priorityMatch?.[1]?.toUpperCase() || "NORMAL";

  // Extract sentiment
  const sentimentMatch = text.match(
    /SENTIMENT:\s*(BULLISH|BEARISH|NEUTRAL|MIXED)/i
  );
  const sentiment = sentimentMatch?.[1]?.toUpperCase() || "NEUTRAL";

  return { summary: text, sentiment, priority, raw: { provider } };
}

// ── Notifications (ntfy + Telegram) ──────────────────────────────────────────

/**
 * Send via ntfy.sh (iPhone notification)
 */
async function sendNtfy(
  summary: string,
  priority: string,
  articleCount: number
): Promise<boolean> {
  if (!NTFY_TOPIC) return false;

  try {
    const trimmed = summary.length > 4000 ? summary.substring(0, 3997) + "..." : summary;
    const res = await fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
      method: "POST",
      headers: {
        "Title": `Navis AI (${articleCount} articles)`,
        "Priority": priority === "HIGH" ? "high" : "default",
        "Tags": priority === "HIGH" ? "chart_with_upwards_trend,warning" : "chart_with_upwards_trend",
      },
      body: trimmed,
    });
    if (!res.ok) {
      console.error(`ntfy error: ${res.status}`, await res.text());
      return false;
    }
    console.log("✅ ntfy sent");
    return true;
  } catch (err) {
    console.error("ntfy failed:", err);
    return false;
  }
}

/**
 * Send via Telegram Bot (Apple Watch readable)
 */
async function sendTelegram(
  summary: string,
  priority: string,
  articleCount: number
): Promise<boolean> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return false;

  try {
    // Telegram limit is 4096 chars
    const trimmed = summary.length > 4090 ? summary.substring(0, 4087) + "..." : summary;

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

    if (!res.ok) {
      const err = await res.text();
      console.error(`Telegram error: ${res.status}`, err.substring(0, 200));
      return false;
    }
    console.log("✅ Telegram sent");
    return true;
  } catch (err) {
    console.error("Telegram failed:", err);
    return false;
  }
}

/**
 * Send notification to all channels in parallel
 */
async function sendNotification(
  summary: string,
  priority: string,
  articleCount: number
): Promise<boolean> {
  console.log(`📤 Sending to Telegram (${summary.length} chars)`);

  const results = await Promise.allSettled([
    // sendNtfy(summary, priority, articleCount), // Disabled for now
    sendTelegram(summary, priority, articleCount),
  ]);

  // const ntfyOk = results[0].status === "fulfilled" && results[0].value;
  const telegramOk = results[0].status === "fulfilled" && results[0].value;

  console.log(`📱 Telegram: ${telegramOk ? "✅" : "❌"}`);
  return telegramOk;
}

// ── Main Handler ───────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  const startTime = Date.now();
  console.log("🚀 Stock analysis pipeline started");

  // Validate configuration
  const missingKeys = [];
  if (!FINNHUB_API_KEY) missingKeys.push("FINNHUB_API_KEY");
  if (!GEMINI_API_KEY && !GROQ_API_KEY) missingKeys.push("GEMINI_API_KEY or GROQ_API_KEY");
  if (!NTFY_TOPIC && !TELEGRAM_BOT_TOKEN) missingKeys.push("NTFY_TOPIC or TELEGRAM_BOT_TOKEN");
  if (!SUPABASE_URL) missingKeys.push("SUPABASE_URL");
  if (!SUPABASE_SERVICE_ROLE_KEY) missingKeys.push("SUPABASE_SERVICE_ROLE_KEY");

  if (missingKeys.length > 0) {
    const error = `Missing environment variables: ${missingKeys.join(", ")}`;
    console.error(error);
    return new Response(JSON.stringify({ error }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Initialize Supabase client
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  try {
    // ── Step 1: Fetch news from all sources in parallel ──
    console.log("📰 Fetching news from Finnhub, Google News, MarketWatch, CNBC, Yahoo Finance...");
    const [generalNews, companyNews, googleRss, directRss] = await Promise.all([
      fetchFinnhubGeneralNews(),
      fetchFinnhubCompanyNews(),
      fetchGoogleRssNews(),
      fetchDirectRssFeeds(),
    ]);

    // Combine all sources
    const rawArticles = [...generalNews, ...companyNews, ...googleRss, ...directRss];
    console.log(
      `📊 Raw: ${rawArticles.length} articles (Finnhub general: ${generalNews.length}, Finnhub company: ${companyNews.length}, Google RSS: ${googleRss.length}, Direct RSS: ${directRss.length})`
    );

    // Filter to only fresh articles
    const allArticles = filterFreshArticles(rawArticles);
    const priorityCount = allArticles.filter((a) => a.isPriority).length;

    if (allArticles.length === 0) {
      // Log the empty run
      await supabase.from("analysis_log").insert({
        articles_found: 0,
        new_articles: 0,
        summary: "No articles found from any source",
        notification_sent: false,
      });

      return new Response(
        JSON.stringify({ status: "ok", message: "No articles found" }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // ── Step 2: Deduplicate ──
    console.log("🔍 Deduplicating...");
    const newArticles = await deduplicateArticles(supabase, allArticles);
    console.log(`✨ ${newArticles.length} new articles after deduplication`);

    if (newArticles.length === 0) {
      await supabase.from("analysis_log").insert({
        articles_found: allArticles.length,
        new_articles: 0,
        summary: "No new articles since last run",
        notification_sent: false,
      });

      return new Response(
        JSON.stringify({
          status: "ok",
          message: "No new articles",
          total: allArticles.length,
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // ── Step 3: Analyze with Gemini ──
    console.log("🧠 Analyzing with Gemini...");
    const analysis = await analyzeWithAI(newArticles);

    // ── Step 4: Send notification ──
    console.log("📱 Sending notification...");
    const notificationSent = await sendNotification(
      analysis.summary,
      analysis.priority,
      newArticles.length
    );

    // ── Step 5: Log the run ──
    await supabase.from("analysis_log").insert({
      articles_found: allArticles.length,
      new_articles: newArticles.length,
      summary: analysis.summary,
      sentiment: analysis.sentiment,
      raw_response: analysis.raw,
      notification_sent: notificationSent,
    });

    const elapsed = Date.now() - startTime;
    console.log(`✅ Pipeline complete in ${elapsed}ms`);

    return new Response(
      JSON.stringify({
        status: "ok",
        articlesFound: allArticles.length,
        newArticles: newArticles.length,
        sentiment: analysis.sentiment,
        priority: analysis.priority,
        notificationSent: notificationSent,
        elapsedMs: elapsed,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("❌ Pipeline error:", err);

    // Log the error
    try {
      await supabase.from("analysis_log").insert({
        error: String(err),
        notification_sent: false,
      });
    } catch (_) {
      // Ignore logging errors
    }

    return new Response(
      JSON.stringify({ status: "error", error: String(err) }),
      {
        status: 500,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
});
