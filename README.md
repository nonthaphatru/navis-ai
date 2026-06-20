# 📈 US Stock & Trump News Analysis Pipeline

Automated pipeline that analyzes US stock market + Trump-related news every hour and sends concise AI summaries to your iPhone and Apple Watch — **completely free**.

## Stack

| Component | Service | Cost |
|---|---|---|
| Runtime | Supabase Edge Functions (Deno) | Free |
| Scheduler | pg_cron + pg_net | Free |
| News Data | Finnhub API + Google News RSS | Free |
| Event Alerts | Finnhub quotes + SEC EDGAR filings | Free |
| AI Analysis | Google Gemini 2.0 Flash | Free |
| Notifications | ntfy.sh / Telegram → iPhone + Apple Watch | Free |

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

### Step 8: Set up the hourly schedule

Go to **Dashboard → SQL Editor** and run the contents of:
- `supabase/migrations/002_setup_cron.sql`

⚠️ **Replace the placeholders** in that file with your actual project ref and service role key first!

## What You'll Get

Every hour, a notification like this appears on your iPhone + Apple Watch:

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

## Event Alerts (price moves, SEC filings, earnings)

Separate from the hourly news digest, the `alerts` function pings you **only
when something actionable happens** — so it's signal, not noise:

- **📉 Price moves** — a holding (SOFI) moves ≥4% intraday, or a watchlist
  name (e.g. PLTR) moves ≥7%. (Thresholds are editable at the top of `alerts/index.ts`.)
- **🏛️ SEC filings** — a new 8-K / 10-Q / 10-K / Form 4 is filed for your
  holdings (via the free SEC EDGAR API — no key needed).
- **📅 Earnings** — a reminder when a watched ticker reports in the next 2 days.
- **✅ Daily heartbeat** — one message a day confirming both the stock and crypto
  pipelines are still running (so a silent failure can't go unnoticed).

It also sends a **Telegram alert if any pipeline crashes**.

### Deploy the alerts + crypto setup

```bash
# 1. Run the new migration (Dashboard → SQL Editor) — creates crypto + alert
#    tables and schedules the crypto/alerts/heartbeat cron jobs.
#    ⚠️ Replace the project ref + service role key placeholders first.
supabase/migrations/003_crypto_and_alerts.sql

# 2. Deploy the new + crypto functions
supabase functions deploy alerts --no-verify-jwt
supabase functions deploy analyze-crypto --no-verify-jwt

# 3. (Optional) Tell SEC who's calling — used in the EDGAR User-Agent
supabase secrets set SEC_CONTACT_EMAIL=you@example.com

# 4. Test
curl -X POST https://YOUR_PROJECT_REF.supabase.co/functions/v1/alerts \
  -H "Authorization: Bearer YOUR_ANON_KEY"
curl -X POST "https://YOUR_PROJECT_REF.supabase.co/functions/v1/alerts?mode=heartbeat" \
  -H "Authorization: Bearer YOUR_ANON_KEY"
```

> The crypto pipeline (`analyze-crypto`) uses its own Telegram bot — set
> `CRYPTO_TELEGRAM_BOT_TOKEN` and `CRYPTO_TELEGRAM_CHAT_ID` as secrets if you
> want crypto alerts on a separate channel.

### (Optional) Lock down the trigger URLs

By default the functions are deployed with `--no-verify-jwt`, so anyone with the
URL could trigger them. To require a shared secret:

```bash
supabase secrets set TRIGGER_SECRET=some-long-random-string
```

Then add this header to **each** cron job (re-run `cron.schedule` with the same
job name to overwrite), alongside the existing `Authorization` header:

```sql
'x-navis-secret', 'some-long-random-string'
```

If `TRIGGER_SECRET` is **not** set, the check is skipped and nothing changes —
so it's safe to deploy first and lock down later.

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
