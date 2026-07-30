import { db } from "./supabase.js";
import type { BotConfig } from "./config.js";

export interface RiskVerdict {
  ok: boolean;
  reason?: string;
}

export async function checkRisk(cfg: BotConfig): Promise<RiskVerdict> {
  if (cfg.kill_switch) return { ok: false, reason: "kill switch engaged" };
  if (!cfg.enabled) return { ok: false, reason: "strategy disabled" };

  const { count: openCount, error: openErr } = await db
    .from("bot_positions")
    .select("id", { count: "exact", head: true })
    .eq("status", "open");
  if (openErr) return { ok: false, reason: `position count failed: ${openErr.message}` };
  if ((openCount ?? 0) >= cfg.max_open_positions) {
    return { ok: false, reason: `max open positions reached (${openCount})` };
  }

  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const { data: closed, error: pnlErr } = await db
    .from("bot_positions")
    .select("pnl_usd")
    .eq("status", "closed")
    .gte("closed_at", start.toISOString());
  if (pnlErr) return { ok: false, reason: `pnl read failed: ${pnlErr.message}` };

  const todayPnl = (closed ?? []).reduce((a, r: any) => a + Number(r.pnl_usd ?? 0), 0);
  if (todayPnl <= -Math.abs(cfg.daily_loss_limit_usd)) {
    return { ok: false, reason: `daily loss limit hit (${todayPnl.toFixed(2)} USD)` };
  }

  return { ok: true };
}
