-- ============================================
-- Migration 004 -- App tables (web dashboard)
-- ============================================
-- Backing store for the web UI: editable watchlist, portfolio positions, and
-- per-user alert settings. All rows are owned by the logged-in user (auth.uid)
-- and protected by RLS. The cron edge functions use the service role, which
-- bypasses RLS, so the bots can read these tables.
--
-- Apply in the SQL Editor, or via Management API POST /v1/projects/{ref}/database/query.
-- ============================================

-- 1. Watchlist -- what the bots watch (replaces the hardcoded ticker arrays).
CREATE TABLE IF NOT EXISTS public.watchlist (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id      UUID NOT NULL DEFAULT auth.uid(),
  symbol       TEXT NOT NULL,
  asset_type   TEXT NOT NULL DEFAULT 'stock',   -- 'stock' | 'crypto'
  coingecko_id TEXT,                             -- for crypto pricing (e.g. 'bitcoin')
  is_holding   BOOLEAN NOT NULL DEFAULT false,
  priority     BOOLEAN NOT NULL DEFAULT false,
  sort_order   INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, symbol, asset_type)
);
CREATE INDEX IF NOT EXISTS idx_watchlist_user ON public.watchlist (user_id);

-- 2. Positions -- portfolio holdings for realtime P&L.
CREATE TABLE IF NOT EXISTS public.positions (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       UUID NOT NULL DEFAULT auth.uid(),
  symbol        TEXT NOT NULL,
  asset_type    TEXT NOT NULL DEFAULT 'stock',  -- 'stock' | 'crypto'
  coingecko_id  TEXT,
  quantity      NUMERIC NOT NULL,
  avg_buy_price NUMERIC NOT NULL,               -- USD per share/coin
  opened_at     DATE,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_positions_user ON public.positions (user_id);

-- 3. App settings -- one row per user (alert thresholds + toggles).
CREATE TABLE IF NOT EXISTS public.app_settings (
  user_id                 UUID PRIMARY KEY DEFAULT auth.uid(),
  holding_move_pct        NUMERIC NOT NULL DEFAULT 4,
  watch_move_pct          NUMERIC NOT NULL DEFAULT 7,
  sec_alerts_enabled      BOOLEAN NOT NULL DEFAULT true,
  earnings_alerts_enabled BOOLEAN NOT NULL DEFAULT true,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Row Level Security -- each user only sees their own rows.
ALTER TABLE public.watchlist     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.positions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings  ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['watchlist', 'positions', 'app_settings'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Owner can do everything on %1$s" ON public.%1$s;', t);
    EXECUTE format(
      'CREATE POLICY "Owner can do everything on %1$s" ON public.%1$s FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());', t
    );
  END LOOP;
END $$;
