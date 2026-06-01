# 📈 US Stock & Trump News Analysis Pipeline

Automated pipeline that analyzes US stock market + Trump-related news every 30 minutes and sends concise AI summaries to your iPhone and Apple Watch — **completely free**.

## Stack

| Component | Service | Cost |
|---|---|---|
| Runtime | Supabase Edge Functions (Deno) | Free |
| Scheduler | pg_cron + pg_net | Free |
| News Data | Finnhub API + Google News RSS | Free |
| AI Analysis | Google Gemini 2.0 Flash | Free |
| Notifications | ntfy.sh → iPhone + Apple Watch | Free |

## Prerequisites

1. **Supabase account** with a project created → [supabase.com](https://supabase.com)
2. **Supabase CLI** installed → `npm install -g supabase`
3. **Finnhub API key** (free) → [finnhub.io](https://finnhub.io/register)
4. **Google Gemini API key** (free) → [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
5. **ntfy app** installed on iPhone → [App Store](https://apps.apple.com/us/app/ntfy/id1625396347)

## Quick Setup (5 minutes)

### Step 1: Get your API keys

```
Finnhub:  https://finnhub.io/register (free, instant)
Gemini:   https://aistudio.google.com/apikey (free, instant)
ntfy:     Pick a secret topic name (e.g., "stock-alert-yourname-2026")
```

### Step 2: Subscribe to your ntfy topic on iPhone

1. Open ntfy app on iPhone
2. Tap **+** to subscribe
3. Enter your topic name (same one you'll set as `NTFY_TOPIC`)
4. Notifications will automatically appear on Apple Watch too!

### Step 3: Link to your Supabase project

```bash
supabase login
supabase link --project-ref YOUR_PROJECT_REF
```

> Your project ref is in: Dashboard → Settings → General → Reference ID

### Step 4: Run the database migration

Go to **Dashboard → SQL Editor** and run the contents of:
- `supabase/migrations/001_create_tables.sql`

### Step 5: Set secrets

```bash
supabase secrets set FINNHUB_API_KEY=your_finnhub_key_here
supabase secrets set GEMINI_API_KEY=your_gemini_key_here
supabase secrets set NTFY_TOPIC=your_secret_topic_name
```

### Step 6: Deploy the edge function

```bash
supabase functions deploy analyze-stocks --no-verify-jwt
```

### Step 7: Test it!

```bash
curl -X POST https://YOUR_PROJECT_REF.supabase.co/functions/v1/analyze-stocks \
  -H "Authorization: Bearer YOUR_ANON_KEY" \
  -H "Content-Type: application/json"
```

You should receive a notification on your iPhone within seconds! ✅

### Step 8: Set up the 30-minute schedule

Go to **Dashboard → SQL Editor** and run the contents of:
- `supabase/migrations/002_setup_cron.sql`

⚠️ **Replace the placeholders** in that file with your actual project ref and service role key first!

## What You'll Get

Every 30 minutes, a notification like this appears on your iPhone + Apple Watch:

```
📈 Stock Analysis (12 articles)

📊 MARKET PULSE
S&P 500 futures up 0.3% as tech earnings boost sentiment.

🔥 TOP 3 MOVERS
• NVDA surges 5% on record AI chip demand — data center revenue doubled
• TSLA drops 3% after missing delivery estimates by 8%
• AAPL announces $100B buyback, largest in corporate history

🏛️ TRUMP IMPACT
New tariff exemptions for semiconductor imports could benefit NVDA, AMD.

⚡ SECTORS TO WATCH
Tech ↑, Semiconductors ↑, EVs ↓, Energy ↑

🎯 SENTIMENT: BULLISH 🟢

💡 KEY TAKEAWAY
AI infrastructure spending continues to drive tech, but auto sector 
faces headwinds from weaker consumer demand.
```

## Customization

### Change watched stocks

Edit `WATCHED_TICKERS` in `index.ts`:

```typescript
const WATCHED_TICKERS = ["AAPL", "TSLA", "NVDA", "MSFT", "AMZN", "GOOGL", "META"];
```

### Change Trump search queries

Edit `TRUMP_QUERIES` in `index.ts`:

```typescript
const TRUMP_QUERIES = [
  "Trump stock market",
  "Trump tariff trade",
  "Trump economy policy",
];
```

### Change schedule frequency

Update the cron expression in `002_setup_cron.sql`:

```sql
-- Every 15 minutes:
'*/15 * * * *'

-- Every hour:
'0 * * * *'

-- Every hour during US market hours only (9:30 AM - 4 PM ET = 13:30 - 20:00 UTC):
'*/30 13-20 * * 1-5'
```

## Monitoring

### Check recent runs

```sql
SELECT run_at, articles_found, new_articles, sentiment, notification_sent, error
FROM analysis_log
ORDER BY run_at DESC
LIMIT 20;
```

### Check cron job status

```sql
SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 10;
```

### View scheduled jobs

```sql
SELECT * FROM cron.job;
```

## Troubleshooting

| Issue | Fix |
|---|---|
| No notifications | Check ntfy topic matches in app & secrets |
| "Missing env variables" | Run `supabase secrets list` to verify |
| Supabase project paused | Un-pause in Dashboard → the cron keeps it alive |
| Finnhub rate limit | Reduce `WATCHED_TICKERS` count |
| Gemini API error | Check API key at aistudio.google.com |

## License

MIT — Use freely for personal stock monitoring.
