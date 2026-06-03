-- ============================================
-- Migration 006 -- Expense Tracker
-- ============================================

-- Expenses table
CREATE TABLE IF NOT EXISTS public.expenses (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chat_id       BIGINT NOT NULL,
  amount        NUMERIC NOT NULL CHECK (amount > 0),
  category      TEXT NOT NULL DEFAULT 'other',
  paid_by_uid   BIGINT NOT NULL,
  paid_by_name  TEXT NOT NULL DEFAULT '',
  split_type    TEXT NOT NULL DEFAULT 'half' CHECK (split_type IN ('half', 'full')),
  note          TEXT,
  raw_message   TEXT,
  logged_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expenses_chat ON public.expenses (chat_id);
CREATE INDEX IF NOT EXISTS idx_expenses_date ON public.expenses (chat_id, logged_at DESC);

-- Settlements table
CREATE TABLE IF NOT EXISTS public.settlements (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chat_id       BIGINT NOT NULL,
  amount        NUMERIC NOT NULL CHECK (amount > 0),
  from_uid      BIGINT NOT NULL,
  from_name     TEXT NOT NULL DEFAULT '',
  to_uid        BIGINT NOT NULL,
  to_name       TEXT NOT NULL DEFAULT '',
  note          TEXT,
  settled_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_settlements_chat ON public.settlements (chat_id);
