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

/** Realtime push so kill-switch flips land within ~1s; the loop also re-reads as fallback. */
export function watchConfig(onChange: (cfg: BotConfig) => void) {
  db.channel("bot-config-watch")
    .on("postgres_changes", { event: "*", schema: "public", table: "bot_config" }, (payload) => {
      cached = payload.new as BotConfig;
      onChange(cached);
    })
    .subscribe();
}
