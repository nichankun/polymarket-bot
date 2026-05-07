import { Chain, ClobClient, OrderType, Side, type TickSize } from "@polymarket/clob-client-v2";
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
   * Initialize CLOB client with L1 → L2 authentication
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

    // Step 1: L1 auth — derive API credentials
    const tempClient = new ClobClient({
      host: config.clobHost,
      chain: Chain.POLYGON,  // enum dari @polymarket/clob-client-v2
      signer,
    });

    logger.info("Deriving API credentials (L1 auth)...");
    const creds = await tempClient.createOrDeriveApiKey();
    this.credentials = {
      key: creds.key,
      secret: creds.secret,
      passphrase: creds.passphrase,
    };
    logger.info(`API credentials obtained. Key: ${creds.key.substring(0, 8)}...`);

    // Step 2: L2 auth — initialize full trading client
    this.client = new ClobClient({
      host: config.clobHost,
      chain: Chain.POLYGON,
      signer,
      creds: {
        key: this.credentials.key,
        secret: this.credentials.secret,
        passphrase: this.credentials.passphrase,
      },
      signatureType: config.signatureType,
      funderAddress: config.funderAddress,
    });

    logger.info("Trading client initialized ✓");
  }

  /**
   * Get the initialized client (throws if not initialized)
   */
  private getClient(): ClobClient {
    if (!this.client) throw new Error("TradingService not initialized. Call initialize() first.");
    return this.client;
  }

  /**
   * Get current balance and allowances
   */
  async getBalances(): Promise<{ usdc: string; allowance: string }> {
    const client = this.getClient();
    try {
      // getBalanceAllowance() tanpa parameter di v2
      const balance = await client.getBalanceAllowance();
      // v2: property-nya 'allowances' (Record<string, string>), bukan 'allowance'
      const allowanceVal = balance?.allowances
        ? Object.values(balance.allowances)[0] ?? "0"
        : "0";
      return {
        usdc: String(balance?.balance ?? "0"),
        allowance: allowanceVal,
      };
    } catch (err) {
      logger.error("Failed to fetch balances", { err });
      return { usdc: "0", allowance: "0" };
    }
  }

  /**
   * Get open orders
   */
  async getOpenOrders(): Promise<unknown[]> {
    const client = this.getClient();
    try {
      // v2: getOpenOrders() langsung, bukan getOrders({ status })
      const orders = await client.getOpenOrders();
      return orders ?? [];
    } catch (err) {
      logger.error("Failed to fetch open orders", { err });
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

    logger.info(`${config.dryRun ? "[DRY RUN] " : ""}Placing ${opp.side} order`, {
      market: opp.market.question.substring(0, 60),
      tokenId: opp.tokenId.substring(0, 12) + "...",
      price: opp.price,
      size: config.defaultOrderSize,
      reason: opp.reason,
    });

    if (config.dryRun) {
      tradeRecord.status = "dry_run_skipped";
      tradeRecord.orderId = `dry_run_${Date.now()}`;
      logger.info(`[DRY RUN] Order simulated — would buy ${config.defaultOrderSize} @ $${opp.price}`);
      this.logTrade(tradeRecord);
      return tradeRecord;
    }

    // Real order placement
    try {
      const client = this.getClient();

      const response = await client.createAndPostOrder(
        {
          tokenID: opp.tokenId,
          price: opp.price,
          size: config.defaultOrderSize,
          side: opp.side === "BUY" ? Side.BUY : Side.SELL,
        },
        {
          tickSize: opp.market.tickSize as TickSize,
          negRisk: opp.market.negRisk,
        },
        OrderType.GTC  // ← wajib di v2
      );

      tradeRecord.orderId = response.orderID;
      tradeRecord.status = response.status ?? "submitted";

      logger.info(`Order placed! ID: ${response.orderID}, Status: ${response.status}`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      tradeRecord.status = `error: ${errorMsg}`;
      logger.error("Order placement failed", { error: errorMsg });
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
      logger.error("Failed to cancel orders", { err });
    }
  }

  /**
   * Cancel a specific order
   */
  async cancelOrder(orderId: string): Promise<void> {
    const client = this.getClient();
    try {
      // v2: cancelOrders([orderId]) untuk cancel by ID
      await client.cancelOrders([orderId]);
      logger.info(`Order ${orderId} cancelled`);
    } catch (err) {
      logger.error(`Failed to cancel order ${orderId}`, { err });
    }
  }

  /**
   * Append trade record to JSONL log file
   */
  private logTrade(trade: TradeRecord): void {
    try {
      fs.appendFileSync(this.tradesFile, JSON.stringify(trade) + "\n");
    } catch (err) {
      logger.error("Failed to write trade log", { err });
    }
  }

  /**
   * Read trade history from log file
   */
  getTradeHistory(): TradeRecord[] {
    try {
      if (!fs.existsSync(this.tradesFile)) return [];
      const lines = fs.readFileSync(this.tradesFile, "utf-8").trim().split("\n");
      return lines
        .filter(Boolean)
        .map((l) => JSON.parse(l) as TradeRecord);
    } catch {
      return [];
    }
  }
}
