// ============================================================================
// Navis Expense Bot — AI-powered expense tracker for Telegram
// Natural language (Thai + English) · Auto-categorize · Debt tracking
// ============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── Environment ─────────────────────────────────────────────────────────────
const BOT_TOKEN = Deno.env.get("EXPENSE_BOT_TOKEN") || "";
const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
const TG = `https://api.telegram.org/bot${BOT_TOKEN}`;

// ── Category emojis ─────────────────────────────────────────────────────────
const CAT_EMOJI: Record<string, string> = {
  food: "🍜", transport: "🚕", shopping: "🛍️", bills: "🏠",
  entertainment: "🎬", health: "💊", travel: "✈️", drinks: "🍺",
  groceries: "🛒", beauty: "💅", education: "📚", other: "📦",
};

// ── Persistent keyboard ─────────────────────────────────────────────────────
const KEYBOARD = {
  keyboard: [
    [{ text: "💰 Balance" }, { text: "📊 Summary" }],
    [{ text: "📋 History" }, { text: "💸 Settle" }],
    [{ text: "↩️ Undo" }, { text: "❓ Help" }],
  ],
  resize_keyboard: true,
  is_persistent: true,
};

// ── Telegram helpers ────────────────────────────────────────────────────────
async function send(chatId: number, text: string, extra?: Record<string, unknown>) {
  await fetch(`${TG}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "HTML",
      reply_markup: KEYBOARD,
      ...extra,
    }),
  });
}

function userName(from: any): string {
  if (from?.first_name) return from.first_name;
  if (from?.username) return from.username;
  return "Unknown";
}

// ── AI Parsing ──────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `You are a bilingual (Thai+English) expense tracker assistant.
Given a user message, determine the intent and extract structured data.
Respond ONLY with valid JSON, no markdown.

Intents:
- "log_expense": User is logging a new expense
- "edit_last": User wants to fix/edit the most recent expense
- "delete_last": User wants to remove the most recent expense  
- "settle": User is recording a debt payment/transfer
- "check_balance": User wants to see who owes whom
- "summary": User wants a monthly/weekly spending breakdown
- "history": User wants to see recent expenses
- "help": User needs help
- "unknown": Cannot determine intent

For "log_expense", extract:
{
  "intent": "log_expense",
  "amount": <number in THB>,
  "category": "<food|transport|shopping|bills|entertainment|health|travel|drinks|groceries|beauty|education|other>",
  "paid_by": "sender",
  "note": "<short description of what was purchased>",
  "split": "half"
}

Rules for paid_by:
- Default is "sender" (the person who sent the message)
- If message says "แฟนจ่าย", "gf paid", "bf paid", "เขาจ่าย", "partner paid" → "partner"
- If message says "ฉันจ่าย", "I paid", "ผมจ่าย" → "sender"

Rules for split:
- Default is "half" (split 50/50)
- If message says "ไม่หาร", "no split", "full", "เลี้ยง", "my treat", "treat" → "full"

For "edit_last":
{ "intent": "edit_last", "changes": { "amount": <new number if mentioned>, "category": "<new cat if mentioned>", "note": "<new note if mentioned>" } }

For "delete_last":
{ "intent": "delete_last" }

For "settle":
{ "intent": "settle", "amount": <number or null for full settle>, "direction": "partner_to_sender" or "sender_to_partner" }
- "แฟนโอนมา", "gf transferred", "gf sent" → partner_to_sender
- "โอนให้แฟน", "I transferred", "I sent" → sender_to_partner
- If no amount specified, set amount to null (full settle)

For others:
{ "intent": "<intent_name>" }`;

async function parseWithAI(message: string): Promise<any> {
  if (!GEMINI_API_KEY) return { intent: "unknown" };

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ role: "user", parts: [{ text: message }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 512,
            responseMimeType: "application/json",
          },
        }),
      }
    );
    const data = await res.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    return JSON.parse(raw);
  } catch {
    return { intent: "unknown" };
  }
}

// ── Debt Calculation ────────────────────────────────────────────────────────

interface UserBalance {
  uid: number;
  name: string;
  owes: number; // positive = this user owes money, negative = is owed money
}

async function getBalance(chatId: number): Promise<{ users: Map<number, string>; netByUser: Map<number, number> }> {
  const users = new Map<number, string>();
  const netByUser = new Map<number, number>(); // positive = owes, negative = is owed

  // Get all expenses
  const { data: expenses } = await supabase
    .from("expenses")
    .select("*")
    .eq("chat_id", chatId)
    .order("logged_at", { ascending: true });

  if (!expenses || expenses.length === 0) return { users, netByUser };

  // Collect unique users
  for (const e of expenses) {
    if (!users.has(e.paid_by_uid)) users.set(e.paid_by_uid, e.paid_by_name);
  }

  // If only one user, we can't calculate pair debts — return zero
  const uids = [...users.keys()];
  if (uids.length < 2) return { users, netByUser };

  // Calculate: for each expense paid by X with split=half,
  // the OTHER person owes X half the amount
  for (const e of expenses) {
    if (e.split_type !== "half") continue;
    const halfAmount = Number(e.amount) / 2;
    const payer = e.paid_by_uid;

    // Payer is owed money (negative = owed)
    netByUser.set(payer, (netByUser.get(payer) || 0) - halfAmount);

    // The other user(s) owe money
    for (const uid of uids) {
      if (uid !== payer) {
        netByUser.set(uid, (netByUser.get(uid) || 0) + halfAmount);
      }
    }
  }

  // Apply settlements
  const { data: settlements } = await supabase
    .from("settlements")
    .select("*")
    .eq("chat_id", chatId);

  if (settlements) {
    for (const s of settlements) {
      const amount = Number(s.amount);
      // from_uid transferred to to_uid → from_uid owes less, to_uid is owed less
      netByUser.set(s.from_uid, (netByUser.get(s.from_uid) || 0) - amount);
      netByUser.set(s.to_uid, (netByUser.get(s.to_uid) || 0) + amount);
      if (!users.has(s.from_uid)) users.set(s.from_uid, s.from_name);
      if (!users.has(s.to_uid)) users.set(s.to_uid, s.to_name);
    }
  }

  return { users, netByUser };
}

function formatBalance(users: Map<number, string>, netByUser: Map<number, number>): string {
  if (users.size < 2) return "No expenses logged between two people yet.";

  const entries = [...netByUser.entries()];
  // Find who owes (positive value)
  const debtor = entries.find(([, v]) => v > 0.5);

  if (!debtor) return "✅ All settled! No one owes anything.";

  const [debtorUid, amount] = debtor;
  const debtorName = users.get(debtorUid) || "?";
  const creditorEntry = entries.find(([uid]) => uid !== debtorUid);
  const creditorName = creditorEntry ? users.get(creditorEntry[0]) || "?" : "?";

  return `💰 <b>Balance</b>\n\n` +
    `<b>${debtorName}</b> owes <b>${creditorName}</b>\n` +
    `💵 <b>฿${Math.abs(amount).toLocaleString("en-US", { maximumFractionDigits: 0 })}</b>`;
}

// ── Handlers ────────────────────────────────────────────────────────────────

async function handleLogExpense(chatId: number, from: any, parsed: any) {
  const amount = Number(parsed.amount);
  if (!amount || amount <= 0) {
    await send(chatId, "❌ ไม่เข้าใจจำนวนเงิน / I didn't catch the amount. Try again?");
    return;
  }

  // Determine who paid
  let paidByUid = from.id;
  let paidByName = userName(from);

  if (parsed.paid_by === "partner") {
    // We don't know the partner's telegram ID yet — store with a flag
    // We'll use 0 as a placeholder and resolve later from chat history
    const partnerInfo = await findPartner(chatId, from.id);
    if (partnerInfo) {
      paidByUid = partnerInfo.uid;
      paidByName = partnerInfo.name;
    } else {
      paidByUid = 0;
      paidByName = "Partner";
    }
  }

  const category = parsed.category || "other";
  const emoji = CAT_EMOJI[category] || "📦";
  const note = parsed.note || "";
  const split = parsed.split || "half";

  const { error } = await supabase.from("expenses").insert({
    chat_id: chatId,
    amount,
    category,
    paid_by_uid: paidByUid,
    paid_by_name: paidByName,
    split_type: split,
    note,
    raw_message: parsed._raw || "",
  });

  if (error) {
    await send(chatId, `❌ Error: ${error.message}`);
    return;
  }

  // Calculate new balance
  const { users, netByUser } = await getBalance(chatId);
  const balanceStr = formatBalance(users, netByUser);

  const splitLabel = split === "half" ? "Split 50/50" : "No split (treat)";
  const halfAmount = split === "half" ? Math.round(amount / 2) : 0;

  let response = `✅ <b>Logged!</b>\n\n`;
  response += `${emoji} <b>${category.charAt(0).toUpperCase() + category.slice(1)}</b>`;
  if (note) response += ` — ${note}`;
  response += `\n`;
  response += `💵 <b>฿${amount.toLocaleString()}</b>\n`;
  response += `👤 Paid by: <b>${paidByName}</b>\n`;
  response += `📐 ${splitLabel}`;
  if (split === "half") response += ` (฿${halfAmount.toLocaleString()} each)`;
  response += `\n\n${balanceStr}`;

  await send(chatId, response);
}

async function findPartner(chatId: number, myUid: number): Promise<{ uid: number; name: string } | null> {
  // Look for the other person in past expenses
  const { data } = await supabase
    .from("expenses")
    .select("paid_by_uid, paid_by_name")
    .eq("chat_id", chatId)
    .neq("paid_by_uid", myUid)
    .neq("paid_by_uid", 0)
    .limit(1);

  if (data && data.length > 0) {
    return { uid: data[0].paid_by_uid, name: data[0].paid_by_name };
  }
  return null;
}

async function handleEditLast(chatId: number, from: any, parsed: any) {
  const { data } = await supabase
    .from("expenses")
    .select("*")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (!data || data.length === 0) {
    await send(chatId, "❌ No expenses to edit.");
    return;
  }

  const last = data[0];
  const changes = parsed.changes || {};
  const updates: Record<string, any> = {};

  if (changes.amount) updates.amount = Number(changes.amount);
  if (changes.category) updates.category = changes.category;
  if (changes.note) updates.note = changes.note;

  if (Object.keys(updates).length === 0) {
    await send(chatId, "🤔 What do you want to change? Tell me the new amount, category, or note.");
    return;
  }

  await supabase.from("expenses").update(updates).eq("id", last.id);

  const updated = { ...last, ...updates };
  const emoji = CAT_EMOJI[updated.category] || "📦";

  await send(chatId,
    `✏️ <b>Updated!</b>\n\n` +
    `${emoji} ${updated.category} — ${updated.note || ""}\n` +
    `💵 ฿${Number(updated.amount).toLocaleString()} · Paid by ${updated.paid_by_name}`
  );
}

async function handleDeleteLast(chatId: number) {
  const { data } = await supabase
    .from("expenses")
    .select("*")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: false })
    .limit(1);

  if (!data || data.length === 0) {
    await send(chatId, "❌ No expenses to delete.");
    return;
  }

  const last = data[0];
  await supabase.from("expenses").delete().eq("id", last.id);

  const emoji = CAT_EMOJI[last.category] || "📦";
  await send(chatId,
    `🗑 <b>Deleted!</b>\n\n` +
    `${emoji} ${last.category} — ${last.note || ""}\n` +
    `💵 ฿${Number(last.amount).toLocaleString()}`
  );
}

async function handleSettle(chatId: number, from: any, parsed: any) {
  const { users, netByUser } = await getBalance(chatId);

  if (users.size < 2) {
    await send(chatId, "❌ Need at least 2 people logging expenses first.");
    return;
  }

  const entries = [...netByUser.entries()];
  const debtor = entries.find(([, v]) => v > 0.5);

  if (!debtor) {
    await send(chatId, "✅ Already settled! No one owes anything.");
    return;
  }

  const [debtorUid, currentDebt] = debtor;
  const creditorEntry = entries.find(([uid]) => uid !== debtorUid);
  if (!creditorEntry) return;

  const [creditorUid] = creditorEntry;
  const debtorName = users.get(debtorUid) || "?";
  const creditorName = users.get(creditorUid) || "?";

  // Determine settlement amount
  let settleAmount = Math.abs(currentDebt);
  if (parsed.amount && Number(parsed.amount) > 0) {
    settleAmount = Number(parsed.amount);
  }

  // Determine direction
  let fromUid = debtorUid, fromName = debtorName;
  let toUid = creditorUid, toName = creditorName;

  if (parsed.direction === "sender_to_partner") {
    fromUid = from.id;
    fromName = userName(from);
    const partner = await findPartner(chatId, from.id);
    if (partner) { toUid = partner.uid; toName = partner.name; }
  } else if (parsed.direction === "partner_to_sender") {
    toUid = from.id;
    toName = userName(from);
    const partner = await findPartner(chatId, from.id);
    if (partner) { fromUid = partner.uid; fromName = partner.name; }
  }

  await supabase.from("settlements").insert({
    chat_id: chatId,
    amount: settleAmount,
    from_uid: fromUid,
    from_name: fromName,
    to_uid: toUid,
    to_name: toName,
    note: parsed.note || null,
  });

  // Recalculate
  const newBal = await getBalance(chatId);
  const newBalStr = formatBalance(newBal.users, newBal.netByUser);

  await send(chatId,
    `💸 <b>Settlement recorded!</b>\n\n` +
    `${fromName} → ${toName}\n` +
    `💵 <b>฿${settleAmount.toLocaleString()}</b>\n\n` +
    newBalStr
  );
}

async function handleBalance(chatId: number) {
  const { users, netByUser } = await getBalance(chatId);
  await send(chatId, formatBalance(users, netByUser));
}

async function handleSummary(chatId: number) {
  // Current month
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const { data } = await supabase
    .from("expenses")
    .select("*")
    .eq("chat_id", chatId)
    .gte("logged_at", startOfMonth)
    .order("logged_at", { ascending: false });

  if (!data || data.length === 0) {
    await send(chatId, "📊 No expenses this month yet.");
    return;
  }

  // Group by category
  const byCategory = new Map<string, number>();
  let total = 0;
  for (const e of data) {
    const amt = Number(e.amount);
    total += amt;
    byCategory.set(e.category, (byCategory.get(e.category) || 0) + amt);
  }

  // Sort by amount desc
  const sorted = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);

  const monthName = now.toLocaleString("en-US", { month: "long", year: "numeric" });

  let msg = `📊 <b>${monthName} Summary</b>\n`;
  msg += `━━━━━━━━━━━━━━━━━━\n`;
  msg += `Total: <b>฿${total.toLocaleString()}</b> · ${data.length} expenses\n\n`;

  for (const [cat, amt] of sorted) {
    const emoji = CAT_EMOJI[cat] || "📦";
    const pctOfTotal = ((amt / total) * 100).toFixed(0);
    const bar = "█".repeat(Math.max(1, Math.round(Number(pctOfTotal) / 5)));
    msg += `${emoji} <b>${cat}</b>  ฿${amt.toLocaleString()}  ${pctOfTotal}%\n${bar}\n`;
  }

  // Balance
  const { users, netByUser } = await getBalance(chatId);
  msg += `\n${formatBalance(users, netByUser)}`;

  await send(chatId, msg);
}

async function handleHistory(chatId: number) {
  const { data } = await supabase
    .from("expenses")
    .select("*")
    .eq("chat_id", chatId)
    .order("logged_at", { ascending: false })
    .limit(10);

  if (!data || data.length === 0) {
    await send(chatId, "📋 No expenses yet.");
    return;
  }

  let msg = `📋 <b>Recent Expenses</b>\n━━━━━━━━━━━━━━━━━━\n\n`;

  for (const e of data) {
    const emoji = CAT_EMOJI[e.category] || "📦";
    const date = new Date(e.logged_at).toLocaleDateString("en-GB", {
      day: "2-digit", month: "short", timeZone: "Asia/Bangkok",
    });
    const splitTag = e.split_type === "full" ? " 🎁" : "";
    msg += `${date}  ${emoji} ${e.note || e.category}  <b>฿${Number(e.amount).toLocaleString()}</b>  ${e.paid_by_name}${splitTag}\n`;
  }

  await send(chatId, msg);
}

async function handleHelp(chatId: number) {
  await send(chatId,
    `❓ <b>How to use Navis Expense Bot</b>\n\n` +
    `<b>💬 Just type naturally:</b>\n` +
    `• "ข้าวผัด 120" or "lunch 350"\n` +
    `• "grab taxi 89 แฟนจ่าย"\n` +
    `• "ค่าไฟ 1500" or "electricity 1500"\n\n` +
    `<b>📐 Split rules:</b>\n` +
    `• Default: split 50/50\n` +
    `• Say "เลี้ยง" or "my treat" → no split\n\n` +
    `<b>✏️ Fix mistakes:</b>\n` +
    `• "แก้เป็น 250" or "change to 250"\n` +
    `• "ลบอันล่าสุด" or "delete that"\n\n` +
    `<b>💸 Settle debts:</b>\n` +
    `• "แฟนโอนมา 500" or "gf sent 500"\n` +
    `• "เคลียร์แล้ว" or "settled all"\n\n` +
    `<b>🔘 Quick buttons above keyboard!</b>`
  );
}

// ── Quick-button text mapping ───────────────────────────────────────────────
function mapButtonText(text: string): string | null {
  const t = text.trim();
  if (t === "💰 Balance") return "/balance";
  if (t === "📊 Summary") return "/summary";
  if (t === "📋 History") return "/history";
  if (t === "💸 Settle") return "/settle";
  if (t === "↩️ Undo") return "/undo";
  if (t === "❓ Help") return "/help";
  return null;
}

// ── Main Handler ────────────────────────────────────────────────────────────

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
    const from = message.from;
    let text = message.text.trim();

    // Map button presses to commands
    const mapped = mapButtonText(text);
    if (mapped) text = mapped;

    // Handle slash commands
    if (text === "/start" || text === "/help") {
      await handleHelp(chatId);
      return new Response("OK");
    }
    if (text === "/balance") {
      await handleBalance(chatId);
      return new Response("OK");
    }
    if (text === "/summary") {
      await handleSummary(chatId);
      return new Response("OK");
    }
    if (text === "/history") {
      await handleHistory(chatId);
      return new Response("OK");
    }
    if (text === "/undo") {
      await handleDeleteLast(chatId);
      return new Response("OK");
    }
    if (text === "/settle") {
      // Full settle via command
      await handleSettle(chatId, from, { amount: null, direction: "auto" });
      return new Response("OK");
    }

    // ── AI Parse natural language ──
    const parsed = await parseWithAI(text);
    parsed._raw = text;

    switch (parsed.intent) {
      case "log_expense":
        await handleLogExpense(chatId, from, parsed);
        break;
      case "edit_last":
        await handleEditLast(chatId, from, parsed);
        break;
      case "delete_last":
        await handleDeleteLast(chatId);
        break;
      case "settle":
        await handleSettle(chatId, from, parsed);
        break;
      case "check_balance":
        await handleBalance(chatId);
        break;
      case "summary":
        await handleSummary(chatId);
        break;
      case "history":
        await handleHistory(chatId);
        break;
      case "help":
        await handleHelp(chatId);
        break;
      default:
        await send(chatId,
          "🤔 ไม่เข้าใจ / I didn't understand.\n" +
          "Try: \"lunch 350\" or \"ข้าวผัด 120\"\n" +
          "Tap ❓ Help for more examples."
        );
    }
  } catch (err) {
    console.error("Expense bot error:", err);
  }

  return new Response("OK", { status: 200 });
});
