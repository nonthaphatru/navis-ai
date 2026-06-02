-- ============================================
-- Migration 005 -- Trade History & P/L Tracking
-- ============================================
-- Adds a `trades` table to log every buy/sell transaction.
-- Positions are now computed from trade history using weighted average cost.
-- Existing positions are migrated as initial buy trades.

-- 1. Create trades table
CREATE TABLE IF NOT EXISTS public.trades (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id       UUID NOT NULL DEFAULT auth.uid(),
  symbol        TEXT NOT NULL,
  asset_type    TEXT NOT NULL DEFAULT 'stock',
  coingecko_id  TEXT,
  side          TEXT NOT NULL CHECK (side IN ('buy', 'sell')),
  quantity      NUMERIC NOT NULL CHECK (quantity > 0),
  price         NUMERIC NOT NULL CHECK (price >= 0),
  traded_at     DATE NOT NULL DEFAULT CURRENT_DATE,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trades_user ON public.trades (user_id);
CREATE INDEX IF NOT EXISTS idx_trades_symbol ON public.trades (user_id, symbol);
CREATE INDEX IF NOT EXISTS idx_trades_date ON public.trades (user_id, traded_at DESC);

-- 2. RLS
ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Owner access on trades" ON public.trades;
CREATE POLICY "Owner access on trades" ON public.trades
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- 3. Migrate existing positions into trades as initial buys
INSERT INTO public.trades (user_id, symbol, asset_type, coingecko_id, side, quantity, price, traded_at, note)
SELECT user_id, symbol, asset_type, coingecko_id, 'buy', quantity, avg_buy_price,
       COALESCE(opened_at, created_at::date), 'Migrated from positions'
FROM public.positions
WHERE quantity > 0
ON CONFLICT DO NOTHING;
