import { db } from "./supabase.js";

export interface BotConfig {
  id: string;
  enabled: boolean;
  kill_switch: boolean;
  environment: "demo" | "prod";
  market: string;
  leverage: number;
  position_size_usd: number;
  take_profit_pct: number;
  stop_loss_pct: number;
  max_open_positions: number;
  daily_loss_limit_usd: number;
  require_approval: boolean;
  strategy_params: Record<string, any> | null;
}

let cached: BotConfig | null = null;

export async function loadConfig(): Promise<BotConfig> {
  const { data, error } = await db.from("bot_config").select("*").limit(1).maybeSingle();
  if (error) throw new Error(`config load failed: ${error.message}`);
  if (!data) throw new Error("no bot_config row found");
  cached = data as BotConfig;
  return cached;
}

export function currentConfig(): BotConfig {
  if (!cached) throw new Error("config not loaded yet");
  return cached;
}

/** The trading loop re-reads config every cycle; no Realtime subscription is needed. */
export function watchConfig(onChange: (cfg: BotConfig) => void) {
  void onChange;
}
