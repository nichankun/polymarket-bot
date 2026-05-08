import {
  AssetType,
  Chain,
  ClobClient,
  OrderType,
  Side,
  type TickSize,
} from "@polymarket/clob-client-v2";
import { createWalletClient, http } from "viem";
import { polygon } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { config } from "./config";
import { logger } from "./logger";
import type { ApiCredentials, MarketOpportunity, TradeRecord } from "./types";
import * as fs from "fs";
import * as path from "path";

// ============================================================
// Trading Service — Handles auth and order placement
// ============================================================

export class TradingService {
  private client: ClobClient | null = null;
  private credentials: ApiCredentials | null = null;
  private readonly tradesFile = "logs/trades.jsonl";

  constructor() {
    const logsDir = path.dirname(this.tradesFile);
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });
  }

  /**
   * Initialize CLOB client with L1 -> L2 authentication
   * Sesuai README resmi: https://github.com/Polymarket/clob-client-v2
   */
  async initialize(): Promise<void> {
    logger.info("Initializing trading client...");

    const account = privateKeyToAccount(config.privateKey);
    const signer = createWalletClient({
      account,
      chain: polygon,
      transport: http(config.rpcUrl),
    });

    logger.info(`Wallet address: ${account.address}`);

    // Step 1: L1 auth — derive API credentials (tanpa creds)
    const tempClient = new ClobClient({
      host: config.clobHost,
      chain: Chain.POLYGON,
      signer,
    });

    logger.info("Deriving API credentials (L1 auth)...");
    const creds = await tempClient.createOrDeriveApiKey();

    // Normalize URL-safe Base64 (-_) ke standard Base64 (+/) untuk atob()
    const normalizedSecret = creds.secret.replace(/-/g, "+").replace(/_/g, "/");

    this.credentials = {
      key: creds.key,
      secret: normalizedSecret,
      passphrase: creds.passphrase,
    };

    logger.info(
      `API credentials obtained. Key: ${creds.key.substring(0, 8)}...`,
    );

    // Step 2: L2 auth — initialize full trading client dengan creds
    // Sesuai README: hanya host, chain, signer, creds — tanpa signatureType/funderAddress
    this.client = new ClobClient({
      host: config.clobHost,
      chain: Chain.POLYGON,
      signer,
      creds: {
        key: this.credentials.key,
        secret: this.credentials.secret,
        passphrase: this.credentials.passphrase,
      },
    });

    logger.info("Trading client initialized ✓");
  }

  /**
   * Get the initialized client (throws if not initialized)
   */
  private getClient(): ClobClient {
    if (!this.client)
      throw new Error(
        "TradingService not initialized. Call initialize() first.",
      );
    return this.client;
  }

  /**
   * Get current balance and allowances
   */
  async getBalances(): Promise<{ usdc: string; allowance: string }> {
    const client = this.getClient();
    try {
      // COLLATERAL = USDC, CONDITIONAL = outcome tokens
      const balance = await client.getBalanceAllowance({
        asset_type: AssetType.COLLATERAL,
      });
      logger.info(`Raw balance: ${JSON.stringify(balance)}`);
      const allowanceVal = balance?.allowances
        ? (Object.values(balance.allowances)[0] ?? "0")
        : "0";
      return {
        usdc: String(balance?.balance ?? "0"),
        allowance: allowanceVal,
      };
    } catch (err) {
      logger.error("Failed to fetch balances", { err: String(err) });
      return { usdc: "0", allowance: "0" };
    }
  }

  async updateAllowance(): Promise<void> {
    const client = this.getClient();
    try {
      logger.info("Setting COLLATERAL allowance...");
      await client.updateBalanceAllowance({ asset_type: AssetType.COLLATERAL });
      logger.info("COLLATERAL allowance updated ✓");

      logger.info("Setting CONDITIONAL allowance...");
      await client.updateBalanceAllowance({
        asset_type: AssetType.CONDITIONAL,
      });
      logger.info("CONDITIONAL allowance updated ✓");
    } catch (err) {
      logger.error("Failed to update allowance", { err: String(err) });
    }
  }

  /**
   * Get open orders
   */
  async getOpenOrders(): Promise<unknown[]> {
    const client = this.getClient();
    try {
      const orders = await client.getOpenOrders();
      return orders ?? [];
    } catch (err) {
      logger.error("Failed to fetch open orders", { err: String(err) });
      return [];
    }
  }

  /**
   * Execute an opportunity — places a real or dry-run order
   */
  async executeOpportunity(opp: MarketOpportunity): Promise<TradeRecord> {
    const tradeRecord: TradeRecord = {
      timestamp: new Date().toISOString(),
      marketQuestion: opp.market.question,
      conditionId: opp.market.conditionId,
      tokenId: opp.tokenId,
      side: opp.side,
      price: opp.price,
      size: config.defaultOrderSize,
      status: "pending",
      dryRun: config.dryRun,
    };

    logger.info(
      `${config.dryRun ? "[DRY RUN] " : ""}Placing ${opp.side} order`,
      {
        market: opp.market.question.substring(0, 60),
        tokenId: opp.tokenId.substring(0, 12) + "...",
        price: opp.price,
        size: config.defaultOrderSize,
        reason: opp.reason,
      },
    );

    if (config.dryRun) {
      tradeRecord.status = "dry_run_skipped";
      tradeRecord.orderId = `dry_run_${Date.now()}`;
      logger.info(
        `[DRY RUN] Order simulated — would buy ${config.defaultOrderSize} @ $${opp.price}`,
      );
      this.logTrade(tradeRecord);
      return tradeRecord;
    }

    // Real order placement
    try {
      const client = this.getClient();

      // Sanitasi tokenId — hanya angka
      const cleanTokenId = opp.tokenId.trim().replace(/[^0-9]/g, "");

      // Round price ke tick size
      const tick = parseFloat(opp.market.tickSize);
      const roundedPrice = Math.round(opp.price / tick) * tick;
      const finalPrice = parseFloat(roundedPrice.toFixed(4));

      logger.info(
        `Token ID: ${cleanTokenId.substring(0, 15)}... | Price: ${opp.price} -> ${finalPrice} (tick: ${tick})`,
      );
      logger.info(
        `tickSize=${opp.market.tickSize} negRisk=${opp.market.negRisk}`,
      );

      // Sesuai README: createAndPostOrder(orderArgs, options, orderType)
      const response = await client.createAndPostOrder(
        {
          tokenID: cleanTokenId,
          price: finalPrice,
          size: config.defaultOrderSize,
          side: opp.side === "BUY" ? Side.BUY : Side.SELL,
        },
        {
          tickSize: opp.market.tickSize as TickSize,
          negRisk: opp.market.negRisk,
        },
        OrderType.GTC,
      );

      logger.info(`Raw response: ${JSON.stringify(response)}`);
      tradeRecord.orderId = response.orderID ?? "unknown";
      tradeRecord.status = String(response.status ?? "unknown");

      if (
        response.status === 200 ||
        response.status === "matched" ||
        response.status === "live"
      ) {
        logger.info(
          `Order placed! ID: ${response.orderID}, Status: ${response.status}`,
        );
      } else {
        logger.warn(
          `Order rejected! Status: ${response.status} | ${JSON.stringify(response)}`,
        );
        tradeRecord.status = `rejected_${response.status}`;
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const errorFull = err instanceof Error ? err.stack : JSON.stringify(err);
      tradeRecord.status = `error: ${errorMsg}`;
      logger.error("Order placement failed", {
        error: errorMsg,
        full: errorFull,
      });
    }

    this.logTrade(tradeRecord);
    return tradeRecord;
  }

  /**
   * Cancel all open orders
   */
  async cancelAllOrders(): Promise<void> {
    const client = this.getClient();
    try {
      await client.cancelAll();
      logger.info("All open orders cancelled");
    } catch (err) {
      logger.error("Failed to cancel orders", { err: String(err) });
    }
  }

  /**
   * Cancel a specific order
   */
  async cancelOrder(orderId: string): Promise<void> {
    const client = this.getClient();
    try {
      await client.cancelOrders([orderId]);
      logger.info(`Order ${orderId} cancelled`);
    } catch (err) {
      logger.error(`Failed to cancel order ${orderId}`, { err: String(err) });
    }
  }

  /**
   * Append trade record to JSONL log file
   */
  private logTrade(trade: TradeRecord): void {
    try {
      fs.appendFileSync(this.tradesFile, JSON.stringify(trade) + "\n");
    } catch (err) {
      logger.error("Failed to write trade log", { err: String(err) });
    }
  }

  /**
   * Read trade history from log file
   */
  getTradeHistory(): TradeRecord[] {
    try {
      if (!fs.existsSync(this.tradesFile)) return [];
      const lines = fs
        .readFileSync(this.tradesFile, "utf-8")
        .trim()
        .split("\n");
      return lines.filter(Boolean).map((l) => JSON.parse(l) as TradeRecord);
    } catch {
      return [];
    }
  }
}
