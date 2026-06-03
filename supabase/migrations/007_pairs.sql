-- ============================================
-- Migration 007 -- Expense Bot Pairing System
-- ============================================

-- Pairs table for linking two users
CREATE TABLE IF NOT EXISTS public.pairs (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pair_code     TEXT UNIQUE NOT NULL,
  user1_uid     BIGINT NOT NULL,
  user1_name    TEXT NOT NULL DEFAULT '',
  user1_chat_id BIGINT NOT NULL,
  user2_uid     BIGINT,
  user2_name    TEXT DEFAULT '',
  user2_chat_id BIGINT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_pairs_code ON public.pairs (pair_code);
CREATE INDEX IF NOT EXISTS idx_pairs_user1 ON public.pairs (user1_uid);
CREATE INDEX IF NOT EXISTS idx_pairs_user2 ON public.pairs (user2_uid);

-- Add pair_id to expenses and settlements
ALTER TABLE public.expenses ADD COLUMN IF NOT EXISTS pair_id BIGINT;
ALTER TABLE public.settlements ADD COLUMN IF NOT EXISTS pair_id BIGINT;
CREATE INDEX IF NOT EXISTS idx_expenses_pair ON public.expenses (pair_id);
CREATE INDEX IF NOT EXISTS idx_settlements_pair ON public.settlements (pair_id);
