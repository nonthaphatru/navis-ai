import { supabase } from "./supabase";
import type { Quote } from "../types";

/**
 * Fetch live prices via the `quotes` edge function (keeps the Finnhub key
 * server-side). Returns a map keyed by stock SYMBOL (uppercase) and crypto
 * coingecko_id (lowercase).
 */
export async function fetchQuotes(
  stocks: string[],
  cryptoIds: string[]
): Promise<Record<string, Quote>> {
  if (stocks.length === 0 && cryptoIds.length === 0) return {};
  const { data, error } = await supabase.functions.invoke("quotes", {
    body: { stocks, crypto: cryptoIds.map((id) => ({ id })) },
  });
  if (error) {
    console.error("quotes invoke failed:", error);
    return {};
  }
  return (data as Record<string, Quote>) || {};
}
