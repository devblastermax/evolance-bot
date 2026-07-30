# Evolance AI Trading Bot

Standalone Node.js worker that trades a **single house wallet** on
[Evedex](https://evedex.com) using the official
[`@evedex/exchange-bot-sdk`](https://github.com/evedex-official/exchange-bot-sdk).

It is controlled entirely from the Evolance admin panel
(**Admin → AI Desk**). The two never talk directly — Supabase is the
only interface.

```
Admin panel  ──writes config / approvals──►  Supabase  ◄──reads/writes──  this bot
```

## Phase A behaviour (default)

`require_approval = true`, so the bot **never opens a position on its own**:

1. Loop reads `bot_config`.
2. Kill switch / strategy-enabled / max-positions / daily-loss-limit checks.
3. Pulls candles, runs the EMA-cross + ATR strategy.
4. On a signal → inserts a `pending` row into `bot_signals` and stops.
5. You approve or reject it in the admin panel.
6. Next loop picks up `approved` signals and places a limit order with
   attached take-profit and stop-loss.

Flip `require_approval` off in the admin panel once you trust the strategy.

## Setup

```bash
cp .env.example .env   # fill in the three required values
npm install
npm run dev
```

Required env vars:

| Var | What |
| --- | --- |
| `EVEDEX_PRIVATE_KEY` | Signing key of the house wallet. **Secrets store only.** |
| `SUPABASE_URL` | Backend URL (from Lovable Cloud) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service key — gives the bot write access to the `bot_*` tables |

## Deploy to Fly.io

```bash
fly launch --no-deploy          # accept the existing fly.toml
fly secrets set \
  EVEDEX_PRIVATE_KEY=... \
  SUPABASE_URL=... \
  SUPABASE_SERVICE_ROLE_KEY=...
fly deploy
fly logs
```

Within ~15 seconds the admin panel status bar should flip to **Bot online**.

## Tables it uses

| Table | Direction |
| --- | --- |
| `bot_config` | read (+ realtime watch for kill-switch flips) |
| `bot_signals` | write proposals, read approvals, mark executed/failed |
| `bot_positions` | write open/close + PnL |
| `bot_events` | write log lines and a heartbeat every 15s |
| `bot_equity` | write a wallet snapshot every 60s |

## Files

```
src/index.ts      boot, heartbeat, equity + trading loops, graceful shutdown
src/config.ts     loads bot_config, realtime live-reload
src/exchange.ts   Evedex SDK wrapper (auth, candles, orders, TP/SL)
src/strategy.ts   EMA cross + ATR volatility filter
src/executor.ts   proposals, approval execution, position persistence
src/risk.ts       kill switch, max positions, daily loss cap
src/supabase.ts   service-role client + logEvent()
```

## Rollout

1. **Demo + approval** — `environment = demo`, approve every trade. 2–4 weeks.
2. **Prod, tiny size** — real wallet, $50–100 per trade, approval still on,
   hard daily loss cap.
3. **Auto mode** — turn off `require_approval`.

## Notes

- `src/exchange.ts` is the only file that touches the SDK. If Evedex changes
  their API shape, that is the single place to patch.
- The bot never reads or writes client data — PnL allocation to clients stays
  manual via Admin → Holdings Manager.
