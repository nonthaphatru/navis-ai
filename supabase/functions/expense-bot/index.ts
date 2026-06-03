// ============================================================================
// Navis Expense Bot — AI-powered expense tracker for Telegram
// Natural language (Thai + English) · Auto-categorize · Debt tracking
// Pairing system: both partners use private chats with persistent keyboard
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

// ── Persistent keyboard (works in private chats) ────────────────────────────
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

// Also notify the partner in their private chat
async function notifyPartner(pair: any, senderUid: number, text: string) {
  const partnerChatId = senderUid === pair.user1_uid ? pair.user2_chat_id : pair.user1_chat_id;
  if (partnerChatId) {
    await send(partnerChatId, text);
  }
}

function userName(from: any): string {
  if (from?.first_name) return from.first_name;
  if (from?.username) return from.username;
  return "Unknown";
}

// ── Pairing System ──────────────────────────────────────────────────────────

function generateCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "NAVIS-";
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

async function findPair(uid: number): Promise<any | null> {
  // Check if user is user1 or user2 in any pair
  const { data: p1 } = await supabase
    .from("pairs")
    .select("*")
    .eq("user1_uid", uid)
    .not("user2_uid", "is", null)
    .limit(1);
  if (p1 && p1.length > 0) return p1[0];

  const { data: p2 } = await supabase
    .from("pairs")
    .select("*")
    .eq("user2_uid", uid)
    .limit(1);
  if (p2 && p2.length > 0) return p2[0];

  return null;
}

async function handlePair(chatId: number, from: any, args: string) {
  const uid = from.id;
  const name = userName(from);

  // Check if already paired
  const existing = await findPair(uid);
  if (existing) {
    const partnerName = existing.user1_uid === uid ? existing.user2_name : existing.user1_name;
    await send(chatId,
      `✅ You're already paired with <b>${partnerName}</b>!\n\n` +
      `Use /unpair to disconnect first.`
    );
    return;
  }

  if (args.trim()) {
    // ── Joining with a code ──
    const code = args.trim().toUpperCase();
    const { data } = await supabase
      .from("pairs")
      .select("*")
      .eq("pair_code", code)
      .is("user2_uid", null)
      .limit(1);

    if (!data || data.length === 0) {
      await send(chatId, "❌ Invalid or expired code. Ask your partner to send /pair again.");
      return;
    }

    const pair = data[0];

    if (pair.user1_uid === uid) {
      await send(chatId, "❌ You can't pair with yourself! Send the code to your partner.");
      return;
    }

    // Complete the pair
    await supabase.from("pairs").update({
      user2_uid: uid,
      user2_name: name,
      user2_chat_id: chatId,
    }).eq("id", pair.id);

    await send(chatId,
      `✅ <b>Paired with ${pair.user1_name}!</b>\n\n` +
      `You can now log expenses. Try:\n` +
      `• "lunch 350"\n` +
      `• "ข้าวผัด 120"\n\n` +
      `Keyboard buttons are ready! 👇`
    );

    // Notify partner
    await send(pair.user1_chat_id,
      `🎉 <b>${name}</b> just paired with you!\n\n` +
      `You're all set. Start logging expenses!`
    );
  } else {
    // ── Creating a new pair code ──
    const code = generateCode();

    // Remove any pending (incomplete) pairs from this user
    await supabase.from("pairs").delete()
      .eq("user1_uid", uid)
      .is("user2_uid", null);

    await supabase.from("pairs").insert({
      pair_code: code,
      user1_uid: uid,
      user1_name: name,
      user1_chat_id: chatId,
    });

    await send(chatId,
      `🔗 <b>Your pair code:</b>\n\n` +
      `<code>${code}</code>\n\n` +
      `Send this code to your partner.\n` +
      `They open @expense_navis_bot and type:\n` +
      `/pair ${code}`
    );
  }
}

async function handleUnpair(chatId: number, from: any) {
  const pair = await findPair(from.id);
  if (!pair) {
    await send(chatId, "You're not paired with anyone.");
    return;
  }

  // Notify partner before deleting
  const partnerChatId = pair.user1_uid === from.id ? pair.user2_chat_id : pair.user1_chat_id;
  const partnerName = pair.user1_uid === from.id ? pair.user2_name : pair.user1_name;

  await supabase.from("pairs").delete().eq("id", pair.id);

  await send(chatId, `🔓 Unpaired from <b>${partnerName}</b>. Expense data is kept.`);
  if (partnerChatId) {
    await send(partnerChatId, `🔓 <b>${userName(from)}</b> has unpaired. Use /pair to reconnect.`);
  }
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
          generationConfig: { temperature: 0.1, maxOutputTokens: 512, responseMimeType: "application/json" },
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

// ── Balance Calculation ─────────────────────────────────────────────────────

async function getBalance(pairId: number, pair: any): Promise<{ owesAmount: number; debtorUid: number; creditorUid: number }> {
  const u1 = pair.user1_uid;
  const u2 = pair.user2_uid;

  // Get expenses
  const { data: expenses } = await supabase
    .from("expenses")
    .select("*")
    .eq("pair_id", pairId);

  // net > 0 means user1 owes user2
  let net = 0;
  for (const e of (expenses || [])) {
    if (e.split_type !== "half") continue;
    const half = Number(e.amount) / 2;
    if (e.paid_by_uid === u1) net -= half; // u1 paid → u2 owes → net decreases
    else if (e.paid_by_uid === u2) net += half; // u2 paid → u1 owes → net increases
  }

  // Apply settlements
  const { data: settlements } = await supabase
    .from("settlements")
    .select("*")
    .eq("pair_id", pairId);

  for (const s of (settlements || [])) {
    const amt = Number(s.amount);
    if (s.from_uid === u1) net -= amt; // u1 transferred → u1 owes less
    else if (s.from_uid === u2) net += amt; // u2 transferred → u2 owes less
  }

  // positive net = user1 owes user2
  if (net > 0) return { owesAmount: net, debtorUid: u1, creditorUid: u2 };
  return { owesAmount: Math.abs(net), debtorUid: u2, creditorUid: u1 };
}

function partnerUid(pair: any, myUid: number): number {
  return myUid === pair.user1_uid ? pair.user2_uid : pair.user1_uid;
}

function nameForUid(pair: any, uid: number): string {
  if (uid === pair.user1_uid) return pair.user1_name;
  if (uid === pair.user2_uid) return pair.user2_name;
  return "?";
}

function formatBal(amount: number, debtorUid: number, pair: any): string {
  if (amount < 1) return "✅ All settled! No one owes anything.";
  const debtorName = nameForUid(pair, debtorUid);
  const creditorName = nameForUid(pair, debtorUid === pair.user1_uid ? pair.user2_uid : pair.user1_uid);
  return `💰 <b>${debtorName}</b> owes <b>${creditorName}</b>: <b>฿${Math.round(amount).toLocaleString()}</b>`;
}

// ── Require pair guard ──────────────────────────────────────────────────────
async function requirePair(chatId: number, uid: number): Promise<any | null> {
  const pair = await findPair(uid);
  if (!pair) {
    await send(chatId,
      `🔗 You need to pair first!\n\n` +
      `<b>Step 1:</b> Type /pair to get a code\n` +
      `<b>Step 2:</b> Send the code to your partner\n` +
      `<b>Step 3:</b> They type /pair CODE`
    );
    return null;
  }
  return pair;
}

// ── Handlers ────────────────────────────────────────────────────────────────

async function handleLogExpense(chatId: number, from: any, pair: any, parsed: any) {
  const amount = Number(parsed.amount);
  if (!amount || amount <= 0) {
    await send(chatId, "❌ ไม่เข้าใจจำนวนเงิน / Didn't catch the amount. Try again?");
    return;
  }

  let paidByUid = from.id;
  let paidByName = userName(from);

  if (parsed.paid_by === "partner") {
    paidByUid = partnerUid(pair, from.id);
    paidByName = nameForUid(pair, paidByUid);
  }

  const category = parsed.category || "other";
  const emoji = CAT_EMOJI[category] || "📦";
  const note = parsed.note || "";
  const split = parsed.split || "half";

  const { error } = await supabase.from("expenses").insert({
    chat_id: chatId,
    pair_id: pair.id,
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

  const { owesAmount, debtorUid } = await getBalance(pair.id, pair);
  const balStr = formatBal(owesAmount, debtorUid, pair);

  const splitLabel = split === "half" ? "Split 50/50" : "No split (treat 🎁)";
  const halfAmt = split === "half" ? Math.round(amount / 2) : 0;

  let msg = `✅ <b>Logged!</b>\n\n`;
  msg += `${emoji} <b>${category.charAt(0).toUpperCase() + category.slice(1)}</b>`;
  if (note) msg += ` — ${note}`;
  msg += `\n💵 <b>฿${amount.toLocaleString()}</b>\n`;
  msg += `👤 Paid by: <b>${paidByName}</b>\n`;
  msg += `📐 ${splitLabel}`;
  if (split === "half") msg += ` (฿${halfAmt.toLocaleString()} each)`;
  msg += `\n\n${balStr}`;

  await send(chatId, msg);
  await notifyPartner(pair, from.id,
    `📥 <b>${userName(from)}</b> logged:\n` +
    `${emoji} ${note || category} · <b>฿${amount.toLocaleString()}</b>\n` +
    `${balStr}`
  );
}

async function handleEditLast(chatId: number, from: any, pair: any, parsed: any) {
  const { data } = await supabase
    .from("expenses")
    .select("*")
    .eq("pair_id", pair.id)
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

  const msg = `✏️ <b>Updated!</b>\n\n` +
    `${emoji} ${updated.category} — ${updated.note || ""}\n` +
    `💵 ฿${Number(updated.amount).toLocaleString()} · ${updated.paid_by_name}`;

  await send(chatId, msg);
  await notifyPartner(pair, from.id, `✏️ <b>${userName(from)}</b> edited last expense:\n${emoji} ${updated.note || updated.category} · ฿${Number(updated.amount).toLocaleString()}`);
}

async function handleDeleteLast(chatId: number, from: any, pair: any) {
  const { data } = await supabase
    .from("expenses")
    .select("*")
    .eq("pair_id", pair.id)
    .order("created_at", { ascending: false })
    .limit(1);

  if (!data || data.length === 0) {
    await send(chatId, "❌ No expenses to delete.");
    return;
  }

  const last = data[0];
  await supabase.from("expenses").delete().eq("id", last.id);
  const emoji = CAT_EMOJI[last.category] || "📦";

  const msg = `🗑 <b>Deleted!</b>\n${emoji} ${last.note || last.category} · ฿${Number(last.amount).toLocaleString()}`;
  await send(chatId, msg);
  await notifyPartner(pair, from.id, `🗑 <b>${userName(from)}</b> deleted:\n${emoji} ${last.note || last.category} · ฿${Number(last.amount).toLocaleString()}`);
}

async function handleSettle(chatId: number, from: any, pair: any, parsed: any) {
  const { owesAmount, debtorUid, creditorUid } = await getBalance(pair.id, pair);

  if (owesAmount < 1) {
    await send(chatId, "✅ Already settled! No one owes anything.");
    return;
  }

  let settleAmt = owesAmount;
  if (parsed.amount && Number(parsed.amount) > 0) {
    settleAmt = Number(parsed.amount);
  }

  // Determine direction: debtor pays creditor
  let fromUid = debtorUid, toUid = creditorUid;

  // But user might specify direction explicitly
  if (parsed.direction === "sender_to_partner") {
    fromUid = from.id;
    toUid = partnerUid(pair, from.id);
  } else if (parsed.direction === "partner_to_sender") {
    fromUid = partnerUid(pair, from.id);
    toUid = from.id;
  }

  await supabase.from("settlements").insert({
    chat_id: chatId,
    pair_id: pair.id,
    amount: settleAmt,
    from_uid: fromUid,
    from_name: nameForUid(pair, fromUid),
    to_uid: toUid,
    to_name: nameForUid(pair, toUid),
  });

  const newBal = await getBalance(pair.id, pair);
  const newBalStr = formatBal(newBal.owesAmount, newBal.debtorUid, pair);

  const msg = `💸 <b>Settlement!</b>\n\n` +
    `${nameForUid(pair, fromUid)} → ${nameForUid(pair, toUid)}\n` +
    `💵 <b>฿${Math.round(settleAmt).toLocaleString()}</b>\n\n${newBalStr}`;

  await send(chatId, msg);
  await notifyPartner(pair, from.id, msg);
}

async function handleBalance(chatId: number, pair: any) {
  const { owesAmount, debtorUid } = await getBalance(pair.id, pair);
  await send(chatId, formatBal(owesAmount, debtorUid, pair));
}

async function handleSummary(chatId: number, pair: any) {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const { data } = await supabase
    .from("expenses")
    .select("*")
    .eq("pair_id", pair.id)
    .gte("logged_at", startOfMonth)
    .order("logged_at", { ascending: false });

  if (!data || data.length === 0) {
    await send(chatId, "📊 No expenses this month yet.");
    return;
  }

  const byCategory = new Map<string, number>();
  let total = 0;
  for (const e of data) {
    const amt = Number(e.amount);
    total += amt;
    byCategory.set(e.category, (byCategory.get(e.category) || 0) + amt);
  }

  const sorted = [...byCategory.entries()].sort((a, b) => b[1] - a[1]);
  const monthName = now.toLocaleString("en-US", { month: "long", year: "numeric" });

  let msg = `📊 <b>${monthName}</b>\n`;
  msg += `━━━━━━━━━━━━━━━━\n`;
  msg += `Total: <b>฿${total.toLocaleString()}</b> · ${data.length} expenses\n\n`;

  for (const [cat, amt] of sorted) {
    const emoji = CAT_EMOJI[cat] || "📦";
    const p = ((amt / total) * 100).toFixed(0);
    const bar = "█".repeat(Math.max(1, Math.round(Number(p) / 5)));
    msg += `${emoji} <b>${cat}</b>  ฿${amt.toLocaleString()}  ${p}%\n${bar}\n`;
  }

  const { owesAmount, debtorUid } = await getBalance(pair.id, pair);
  msg += `\n${formatBal(owesAmount, debtorUid, pair)}`;

  await send(chatId, msg);
}

async function handleHistory(chatId: number, pair: any) {
  const { data } = await supabase
    .from("expenses")
    .select("*")
    .eq("pair_id", pair.id)
    .order("logged_at", { ascending: false })
    .limit(10);

  if (!data || data.length === 0) {
    await send(chatId, "📋 No expenses yet.");
    return;
  }

  let msg = `📋 <b>Recent Expenses</b>\n━━━━━━━━━━━━━━━━\n\n`;
  for (const e of data) {
    const emoji = CAT_EMOJI[e.category] || "📦";
    const date = new Date(e.logged_at).toLocaleDateString("en-GB", {
      day: "2-digit", month: "short", timeZone: "Asia/Bangkok",
    });
    const tag = e.split_type === "full" ? " 🎁" : "";
    msg += `${date}  ${emoji} ${e.note || e.category}  <b>฿${Number(e.amount).toLocaleString()}</b>  ${e.paid_by_name}${tag}\n`;
  }

  await send(chatId, msg);
}

async function handleHelp(chatId: number) {
  await send(chatId,
    `❓ <b>Navis Expense Bot</b>\n\n` +
    `<b>🔗 Setup:</b>\n` +
    `/pair — get a code to link with partner\n` +
    `/pair CODE — join your partner\n\n` +
    `<b>💬 Log expenses (just type!):</b>\n` +
    `• "ข้าวผัด 120" or "lunch 350"\n` +
    `• "grab taxi 89 แฟนจ่าย"\n` +
    `• "เลี้ยง dinner 500" (no split)\n\n` +
    `<b>✏️ Fix mistakes:</b>\n` +
    `• "แก้เป็น 250" or "change to 250"\n` +
    `• "ลบอันล่าสุด" or "delete that"\n\n` +
    `<b>💸 Settle:</b>\n` +
    `• "แฟนโอนมา 500" or "gf sent 500"\n\n` +
    `<b>🔘 Quick buttons above keyboard!</b>`
  );
}

// ── Button text mapping ─────────────────────────────────────────────────────
function mapButton(text: string): string | null {
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
  if (req.method !== "POST") return new Response("OK", { status: 200 });

  try {
    const update = await req.json();
    const message = update?.message;
    if (!message?.text || !message?.chat?.id) return new Response("OK");

    const chatId = message.chat.id;
    const from = message.from;
    let text = message.text.trim();

    // Map keyboard button presses
    const mapped = mapButton(text);
    if (mapped) text = mapped;

    // ── Commands that don't need pairing ──
    if (text === "/start" || text === "/help") {
      await handleHelp(chatId);
      return new Response("OK");
    }
    if (text.startsWith("/pair") || text.startsWith("NAVIS-")) {
      const args = text.replace(/^\/pair\s*/i, "").trim();
      await handlePair(chatId, from, args || (text.startsWith("NAVIS-") ? text : ""));
      return new Response("OK");
    }
    if (text === "/unpair") {
      await handleUnpair(chatId, from);
      return new Response("OK");
    }

    // ── Everything below requires pairing ──
    const pair = await requirePair(chatId, from.id);
    if (!pair) return new Response("OK");

    // Update chat_id if it changed (user reinstalled, etc.)
    if (pair.user1_uid === from.id && pair.user1_chat_id !== chatId) {
      await supabase.from("pairs").update({ user1_chat_id: chatId }).eq("id", pair.id);
      pair.user1_chat_id = chatId;
    } else if (pair.user2_uid === from.id && pair.user2_chat_id !== chatId) {
      await supabase.from("pairs").update({ user2_chat_id: chatId }).eq("id", pair.id);
      pair.user2_chat_id = chatId;
    }

    // ── Slash commands ──
    if (text === "/balance") { await handleBalance(chatId, pair); return new Response("OK"); }
    if (text === "/summary") { await handleSummary(chatId, pair); return new Response("OK"); }
    if (text === "/history") { await handleHistory(chatId, pair); return new Response("OK"); }
    if (text === "/undo") { await handleDeleteLast(chatId, from, pair); return new Response("OK"); }
    if (text === "/settle") { await handleSettle(chatId, from, pair, { amount: null }); return new Response("OK"); }

    // ── Natural language via AI ──
    const parsed = await parseWithAI(text);
    parsed._raw = text;

    switch (parsed.intent) {
      case "log_expense": await handleLogExpense(chatId, from, pair, parsed); break;
      case "edit_last": await handleEditLast(chatId, from, pair, parsed); break;
      case "delete_last": await handleDeleteLast(chatId, from, pair); break;
      case "settle": await handleSettle(chatId, from, pair, parsed); break;
      case "check_balance": await handleBalance(chatId, pair); break;
      case "summary": await handleSummary(chatId, pair); break;
      case "history": await handleHistory(chatId, pair); break;
      case "help": await handleHelp(chatId); break;
      default:
        await send(chatId,
          "🤔 ไม่เข้าใจ / I didn't understand.\n" +
          "Try: \"lunch 350\" or \"ข้าวผัด 120\"\n" +
          "Tap ❓ Help for examples."
        );
    }
  } catch (err) {
    console.error("Expense bot error:", err);
  }

  return new Response("OK", { status: 200 });
});
