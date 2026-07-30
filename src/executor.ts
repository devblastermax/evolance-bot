import { db, logEvent } from "./supabase.js";
import type { BotConfig } from "./config.js";
import type { Exchange } from "./exchange.js";
import type { Signal } from "./strategy.js";

const SIGNAL_TTL_MS = 10 * 60 * 1000;

/** Writes a pending signal for admin approval. */
export async function proposeSignal(cfg: BotConfig, signal: Signal) {
  const { error } = await db.from("bot_signals").insert({
    market: cfg.market,
    side: signal.side,
    entry_price: signal.entryPrice,
    size_usd: cfg.position_size_usd,
    leverage: cfg.leverage,
    tp_pct: cfg.take_profit_pct,
    sl_pct: cfg.stop_loss_pct,
    reason: signal.reason,
    status: "pending",
    expires_at: new Date(Date.now() + SIGNAL_TTL_MS).toISOString(),
  });
  if (error) throw new Error(`propose failed: ${error.message}`);
  await logEvent("info", `Signal proposed: ${signal.side} ${cfg.market} — ${signal.reason}`);
}

/** Marks stale pending signals as expired. */
export async function expireStaleSignals() {
  await db
    .from("bot_signals")
    .update({ status: "expired" })
    .eq("status", "pending")
    .lt("expires_at", new Date().toISOString());
}

/** Executes every approved-but-unexecuted signal. */
export async function executeApproved(cfg: BotConfig, exchange: Exchange) {
  const { data, error } = await db
    .from("bot_signals")
    .select("*")
    .eq("status", "approved")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`approved read failed: ${error.message}`);

  for (const s of data ?? []) {
    await executeSignal(cfg, exchange, s);
  }
}

export async function executeSignal(cfg: BotConfig, exchange: Exchange, s: any) {
  try {
    const price = await exchange.lastPrice();
    const order = await exchange.openPosition({
      side: s.side,
      sizeUsd: Number(s.size_usd),
      price,
      tpPct: Number(s.tp_pct ?? cfg.take_profit_pct),
      slPct: Number(s.sl_pct ?? cfg.stop_loss_pct),
    });

    await db.from("bot_positions").insert({
      signal_id: s.id,
      market: cfg.market,
      side: s.side,
      size: order.size,
      size_usd: Number(s.size_usd),
      entry_price: order.entryPrice,
      tp_price: order.tpPrice,
      sl_price: order.slPrice,
      status: "open",
      exchange_order_id: order.orderId,
    });

    await db
      .from("bot_signals")
      .update({ status: "executed", executed_at: new Date().toISOString() })
      .eq("id", s.id);

    await logEvent("info", `Executed ${s.side} ${cfg.market} @ ${order.entryPrice}`, { orderId: order.orderId });
  } catch (err: any) {
    await db.from("bot_signals").update({ status: "failed", error: String(err?.message ?? err) }).eq("id", s.id);
    await logEvent("error", `Execution failed for signal ${s.id}: ${err?.message ?? err}`);
  }
}

/** Auto mode: skip the approval queue and fire immediately. */
export async function executeImmediately(cfg: BotConfig, exchange: Exchange, signal: Signal) {
  const { data, error } = await db
    .from("bot_signals")
    .insert({
      market: cfg.market,
      side: signal.side,
      entry_price: signal.entryPrice,
      size_usd: cfg.position_size_usd,
      leverage: cfg.leverage,
      tp_pct: cfg.take_profit_pct,
      sl_pct: cfg.stop_loss_pct,
      reason: `${signal.reason} (auto)`,
      status: "approved",
      approved_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (error) throw new Error(`auto signal insert failed: ${error.message}`);
  await executeSignal(cfg, exchange, data);
}
