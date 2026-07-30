import "dotenv/config";
import { db, logEvent } from "./supabase.js";
import { loadConfig, watchConfig, currentConfig } from "./config.js";
import { Exchange } from "./exchange.js";
import { generateSignal } from "./strategy.js";
import { checkRisk } from "./risk.js";
import { proposeSignal, executeApproved, executeImmediately, expireStaleSignals } from "./executor.js";

const LOOP_MS = Number(process.env.LOOP_INTERVAL_MS ?? 15_000);
const HEARTBEAT_MS = 15_000;

let running = true;

async function heartbeatLoop() {
  while (running) {
    await logEvent("heartbeat", "alive");
    await sleep(HEARTBEAT_MS);
  }
}

async function equityLoop(exchange: Exchange) {
  while (running) {
    try {
      const state = await exchange.accountState();
      await db.from("bot_equity").insert({
        equity_usd: state.equityUsd,
        available_usd: state.availableUsd,
        unrealized_pnl_usd: state.unrealizedPnlUsd,
      });
    } catch (err: any) {
      await logEvent("warn", `equity snapshot failed: ${err?.message ?? err}`);
    }
    await sleep(60_000);
  }
}

async function tradingLoop(exchange: Exchange) {
  while (running) {
    try {
      const cfg = await loadConfig();

      await expireStaleSignals();
      // Approved signals execute even when the strategy is paused,
      // but never when the kill switch is engaged.
      if (!cfg.kill_switch) await executeApproved(cfg, exchange);

      const verdict = await checkRisk(cfg);
      if (!verdict.ok) {
        await sleep(LOOP_MS);
        continue;
      }

      const candles = await exchange.candles(200);
      const signal = generateSignal(candles, cfg);
      if (signal) {
        if (cfg.require_approval) await proposeSignal(cfg, signal);
        else await executeImmediately(cfg, exchange, signal);
      }
    } catch (err: any) {
      await logEvent("error", `loop error: ${err?.message ?? err}`);
    }
    await sleep(LOOP_MS);
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const cfg = await loadConfig();
  await logEvent("info", `Bot starting — ${cfg.environment} / ${cfg.market}`);

  const exchange = new Exchange(cfg);
  await exchange.connect();
  await logEvent("info", "Exchange connected");

  watchConfig((next) => {
    if (next.kill_switch) {
      logEvent("warn", "Kill switch engaged — halting new entries");
      exchange.cancelAll().catch(() => {});
    }
  });

  void heartbeatLoop();
  void equityLoop(exchange);
  await tradingLoop(exchange);
}

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    running = false;
    await logEvent("warn", `Received ${sig} — shutting down`);
    process.exit(0);
  });
}

main().catch(async (err) => {
  await logEvent("error", `fatal: ${err?.message ?? err}`);
  process.exit(1);
});
