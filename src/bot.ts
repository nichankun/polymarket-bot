import { config } from "./config";
import { logger } from "./logger";
import { MarketService } from "./marketService";
import { StrategyEngine } from "./strategyEngine";
import { TradingService } from "./tradingService";
import type { BotStats, MarketOpportunity } from "./types";

// ============================================================
// Polymarket Bot — Main Orchestrator (24/7 Loop)
// ============================================================

export class PolymarketBot {
  private readonly marketService: MarketService;
  private readonly strategyEngine: StrategyEngine;
  private readonly tradingService: TradingService;

  private running = false;
  private scanTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;

  private stats: BotStats = {
    startTime: new Date(),
    totalScans: 0,
    totalOpportunities: 0,
    totalOrdersPlaced: 0,
    totalOrdersFailed: 0,
    errors: 0,
  };

  constructor() {
    this.marketService = new MarketService();
    this.strategyEngine = new StrategyEngine(this.marketService);
    this.tradingService = new TradingService();
  }

  /**
   * Start the bot — initializes auth and begins the scan loop
   */
  async start(): Promise<void> {
    logger.info("═══════════════════════════════════════════");
    logger.info("       POLYMARKET BOT STARTING UP          ");
    logger.info("═══════════════════════════════════════════");
    logger.info(
      `Mode: ${config.dryRun ? "DRY RUN (no real orders)" : "⚠️  LIVE TRADING"}`,
    );
    logger.info(`Scan interval: ${config.scanIntervalMs / 1000}s`);
    logger.info(`Order size: $${config.defaultOrderSize}`);
    logger.info(`Chain: Polygon (137)`);

    await this.tradingService.initialize();
    await this.tradingService.updateAllowance(); // set allowance dulu
    await this.logBalances();

    this.running = true;
    this.stats.startTime = new Date();

    // Start heartbeat (logs uptime every 5 minutes)
    this.startHeartbeat();

    // Run first scan immediately, then on interval
    await this.runScanCycle();
    this.scheduleScan();

    logger.info("Bot is running. Press Ctrl+C to stop.");
  }

  /**
   * Gracefully stop the bot
   */
  async stop(): Promise<void> {
    logger.info("Stopping bot...");
    this.running = false;

    if (this.scanTimer) clearTimeout(this.scanTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);

    // Cancel all open orders on shutdown
    if (!config.dryRun) {
      logger.info("Cancelling open orders before shutdown...");
      await this.tradingService.cancelAllOrders();
    }

    this.logFinalStats();
    logger.info("Bot stopped cleanly.");
  }

  /**
   * Schedule the next scan
   */
  private scheduleScan(): void {
    if (!this.running) return;
    this.scanTimer = setTimeout(async () => {
      await this.runScanCycle();
      this.scheduleScan();
    }, config.scanIntervalMs);
  }

  /**
   * One full scan + execution cycle
   */
  private async runScanCycle(): Promise<void> {
    if (!this.running) return;

    this.stats.totalScans++;
    this.stats.lastScanTime = new Date();

    logger.info(`--- Scan #${this.stats.totalScans} ---`);

    try {
      // Find opportunities
      const opportunities = await this.strategyEngine.scanForOpportunities();
      this.stats.totalOpportunities += opportunities.length;

      if (opportunities.length === 0) {
        logger.info("No opportunities found this scan.");
        return;
      }

      // Log top 3 opportunities
      const top3 = opportunities.slice(0, 3);
      logger.info(`Top opportunities (${opportunities.length} total):`);
      top3.forEach((opp, i) => {
        logger.info(
          `  ${i + 1}. [Score: ${opp.score.toFixed(1)}] ${opp.reason}`,
        );
        logger.info(`     Market: ${opp.market.question.substring(0, 70)}...`);
      });

      // Execute the best opportunity only (conservative approach)
      if (opportunities.length > 0) {
        await this.executeOpportunity(opportunities[0]);
      }
    } catch (err) {
      this.stats.errors++;
      logger.error(
        `Scan cycle error: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /**
   * Execute a single opportunity
   */
  private async executeOpportunity(opp: MarketOpportunity): Promise<void> {
    try {
      const trade = await this.tradingService.executeOpportunity(opp);

      if (
        trade.status.startsWith("error") ||
        trade.status.startsWith("rejected")
      ) {
        this.stats.totalOrdersFailed++;
      } else {
        this.stats.totalOrdersPlaced++;
        this.strategyEngine.markExecuted(opp.market.conditionId);
      }
    } catch (err) {
      this.stats.errors++;
      logger.error(
        `Execution error: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /**
   * Log current USDC balance
   */
  private async logBalances(): Promise<void> {
    try {
      const balances = await this.tradingService.getBalances();
      logger.info(
        `Balances — USDC: $${balances.usdc}, Allowance: $${balances.allowance}`,
      );
    } catch (err) {
      logger.warn(
        "Could not fetch balances (expected if wallet has no funds yet)",
      );
    }
  }

  /**
   * Start heartbeat logger (every 5 minutes)
   */
  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(
      () => {
        const uptimeMs = Date.now() - this.stats.startTime.getTime();
        const uptimeMin = Math.floor(uptimeMs / 60000);
        logger.info(
          `♡ Heartbeat | Uptime: ${uptimeMin}m | Scans: ${this.stats.totalScans} | ` +
            `Opps: ${this.stats.totalOpportunities} | Orders: ${this.stats.totalOrdersPlaced} | ` +
            `Errors: ${this.stats.errors}`,
        );
      },
      5 * 60 * 1000,
    ); // every 5 minutes
  }

  /**
   * Log final statistics on shutdown
   */
  private logFinalStats(): void {
    const uptimeMs = Date.now() - this.stats.startTime.getTime();
    const uptimeMin = Math.floor(uptimeMs / 60000);
    logger.info("═══════════════════════════════════════════");
    logger.info("                FINAL STATS                ");
    logger.info(`  Uptime:        ${uptimeMin} minutes`);
    logger.info(`  Total scans:   ${this.stats.totalScans}`);
    logger.info(`  Opportunities: ${this.stats.totalOpportunities}`);
    logger.info(`  Orders placed: ${this.stats.totalOrdersPlaced}`);
    logger.info(`  Orders failed: ${this.stats.totalOrdersFailed}`);
    logger.info(`  Errors:        ${this.stats.errors}`);
    logger.info("═══════════════════════════════════════════");
  }

  getStats(): BotStats {
    return { ...this.stats };
  }
}
