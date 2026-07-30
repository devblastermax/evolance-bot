import type { Candle } from "./exchange.js";
import type { BotConfig } from "./config.js";

export interface Signal {
  side: "long" | "short";
  entryPrice: number;
  reason: string;
}

function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = values[0];
  for (const v of values) {
    prev = v * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

function atr(candles: Candle[], period = 14): number {
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  const slice = trs.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / (slice.length || 1);
}

/**
 * Baseline strategy: fast/slow EMA cross, filtered by a minimum volatility
 * floor so we don't trade dead chop. Tune via bot_config.strategy_params:
 *   { fast: 9, slow: 21, minAtrPct: 0.15, resolution: "5m" }
 */
export function generateSignal(candles: Candle[], cfg: BotConfig): Signal | null {
  const p = cfg.strategy_params ?? {};
  const fastLen = Number(p.fast ?? 9);
  const slowLen = Number(p.slow ?? 21);
  const minAtrPct = Number(p.minAtrPct ?? 0.15);

  if (candles.length < slowLen + 5) return null;

  const closes = candles.map((c) => c.close);
  const fast = ema(closes, fastLen);
  const slow = ema(closes, slowLen);
  const price = closes.at(-1)!;

  const atrPct = (atr(candles) / price) * 100;
  if (atrPct < minAtrPct) return null;

  const prevDiff = fast.at(-2)! - slow.at(-2)!;
  const currDiff = fast.at(-1)! - slow.at(-1)!;

  if (prevDiff <= 0 && currDiff > 0) {
    return { side: "long", entryPrice: price, reason: `EMA${fastLen} crossed above EMA${slowLen}, ATR ${atrPct.toFixed(2)}%` };
  }
  if (prevDiff >= 0 && currDiff < 0) {
    return { side: "short", entryPrice: price, reason: `EMA${fastLen} crossed below EMA${slowLen}, ATR ${atrPct.toFixed(2)}%` };
  }
  return null;
}
