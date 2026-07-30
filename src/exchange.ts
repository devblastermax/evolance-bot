/**
 * Thin wrapper around @evedex/exchange-bot-sdk.
 *
 * The SDK surface differs slightly between demo and prod environments; every
 * call is funnelled through this file so the rest of the bot never imports
 * the SDK directly. If the SDK API changes, this is the only file to update.
 */
import type { BotConfig } from "./config.js";

export interface Candle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PlacedOrder {
  orderId: string;
  entryPrice: number;
  size: number;
  tpPrice: number;
  slPrice: number;
}

export interface ExchangeAccountState {
  equityUsd: number;
  availableUsd: number;
  unrealizedPnlUsd: number;
  openPositions: number;
}

const DEMO_REST = "https://api.demo.evedex.com";
const PROD_REST = "https://api.evedex.com";

export class Exchange {
  private sdk: any;
  private account: any;

  constructor(private cfg: BotConfig) {}

  async connect() {
    // Lazy import keeps startup fast and makes the dependency swappable.
    const sdk: any = await import("@evedex/exchange-bot-sdk");

    const privateKey = process.env.EVEDEX_PRIVATE_KEY;
    if (!privateKey) throw new Error("EVEDEX_PRIVATE_KEY is required");

    const restUri = this.cfg.environment === "prod" ? PROD_REST : DEMO_REST;

    this.sdk = new sdk.ExchangeClient({ restUri });
    this.account = new sdk.WalletAccount({
      exchange: this.sdk,
      privateKey,
    });
    await this.account.authorize?.();
  }

  async accountState(): Promise<ExchangeAccountState> {
    const balance = await this.account.balance();
    const positions = await this.account.positions?.({ market: this.cfg.market });
    return {
      equityUsd: Number(balance?.equity ?? balance?.total ?? 0),
      availableUsd: Number(balance?.available ?? 0),
      unrealizedPnlUsd: Number(balance?.unrealizedPnl ?? 0),
      openPositions: Array.isArray(positions) ? positions.length : 0,
    };
  }

  async candles(limit = 200): Promise<Candle[]> {
    const raw = await this.sdk.candles({
      instrument: this.cfg.market,
      resolution: this.cfg.strategy_params?.resolution ?? "5m",
      limit,
    });
    return (raw ?? []).map((c: any) => ({
      time: Number(c.time ?? c.t),
      open: Number(c.open ?? c.o),
      high: Number(c.high ?? c.h),
      low: Number(c.low ?? c.l),
      close: Number(c.close ?? c.c),
      volume: Number(c.volume ?? c.v ?? 0),
    }));
  }

  async lastPrice(): Promise<number> {
    const candles = await this.candles(2);
    return candles.at(-1)?.close ?? 0;
  }

  /** Places a limit order with attached take-profit and stop-loss. */
  async openPosition(params: {
    side: "long" | "short";
    sizeUsd: number;
    price: number;
    tpPct: number;
    slPct: number;
  }): Promise<PlacedOrder> {
    const size = params.sizeUsd / params.price;
    const dir = params.side === "long" ? 1 : -1;
    const tpPrice = params.price * (1 + (dir * params.tpPct) / 100);
    const slPrice = params.price * (1 - (dir * params.slPct) / 100);

    const order = await this.account.createLimitOrderV2({
      instrument: this.cfg.market,
      side: params.side === "long" ? "BUY" : "SELL",
      quantity: size,
      limitPrice: params.price,
      takeProfitPrice: tpPrice,
      stopLossPrice: slPrice,
      leverage: this.cfg.leverage,
    });

    return {
      orderId: String(order?.id ?? order?.orderId ?? ""),
      entryPrice: params.price,
      size,
      tpPrice,
      slPrice,
    };
  }

  async closePosition(orderId: string) {
    await this.account.closePosition?.({ instrument: this.cfg.market, orderId });
  }

  async cancelAll() {
    await this.account.cancelAllOrders?.({ instrument: this.cfg.market });
  }
}
