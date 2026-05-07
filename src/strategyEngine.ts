import { config } from "./config";
import { logger } from "./logger";
import { MarketService } from "./marketService";
import type { ParsedMarket, MarketOpportunity } from "./types";

// ============================================================
// Strategy Engine — Identifies trading opportunities
// ============================================================

export class StrategyEngine {
  private readonly marketService: MarketService;

  // Cooldown: track kapan terakhir kali market ini dieksekusi
  // Key: conditionId, Value: timestamp ms
  private readonly marketCooldowns = new Map<string, number>();

  // Cooldown per market: 10 menit (tidak "beli" market sama berulang)
  private readonly COOLDOWN_MS = 10 * 60 * 1000;

  // Minimum volume lebih tinggi agar market lebih likuid
  private readonly MIN_VOLUME = 1000;
  private readonly MIN_LIQUIDITY = 500;
  private readonly LONG_SHOT_MIN_PRICE = 0.01;
  private readonly LONG_SHOT_MAX_PRICE = 0.12;
  private readonly LONG_SHOT_MIN_VOLUME = 10000;
  private readonly UNDERVALUED_MIN = 0.1; // 10¢
  private readonly UNDERVALUED_MAX = 0.9;

  constructor(marketService: MarketService) {
    this.marketService = marketService;
  }

  /**
   * Main scan: fetch markets dan evaluasi peluang
   */
  async scanForOpportunities(): Promise<MarketOpportunity[]> {
    logger.info("Scanning markets for opportunities...");

    const markets = await this.marketService.fetchActiveMarkets(50);
    logger.info(`Fetched ${markets.length} active markets`);

    const opportunities: MarketOpportunity[] = [];

    for (const market of markets) {
      if (!this.isEligible(market)) continue;
      if (this.isOnCooldown(market.conditionId)) {
        logger.debug(`Skipping ${market.slug} — on cooldown`);
        continue;
      }

      try {
        const marketOpps = await this.evaluateMarket(market);
        opportunities.push(...marketOpps);
      } catch (err) {
        logger.debug(`Error evaluating market ${market.slug}: ${err}`);
      }
    }

    // Sort by score descending
    opportunities.sort((a, b) => b.score - a.score);

    logger.info(`Found ${opportunities.length} opportunities`);
    return opportunities;
  }

  /**
   * Tandai market sudah dieksekusi — masuk cooldown
   */
  markExecuted(conditionId: string): void {
    this.marketCooldowns.set(conditionId, Date.now());
    logger.debug(
      `Market ${conditionId} masuk cooldown ${this.COOLDOWN_MS / 60000} menit`,
    );
  }

  /**
   * Cek apakah market masih dalam cooldown
   */
  private isOnCooldown(conditionId: string): boolean {
    const lastExecuted = this.marketCooldowns.get(conditionId);
    if (!lastExecuted) return false;
    return Date.now() - lastExecuted < this.COOLDOWN_MS;
  }

  /**
   * Filter dasar eligibilitas market
   */
  private isEligible(market: ParsedMarket): boolean {
    if (!market.active || market.closed) return false;
    if (!market.acceptingOrders) return false;
    if (market.tokenIds.length === 0) return false;
    if (market.volume < this.MIN_VOLUME) return false;
    if (market.liquidity < this.MIN_LIQUIDITY) return false;
    return true;
  }

  /**
   * Evaluasi satu market — return peluang yang ditemukan
   */
  private async evaluateMarket(
    market: ParsedMarket,
  ): Promise<MarketOpportunity[]> {
    const opportunities: MarketOpportunity[] = [];

    for (let i = 0; i < market.tokenIds.length; i++) {
      const tokenId = market.tokenIds[i];
      const outcomeName = market.outcomes[i] ?? `Outcome ${i}`;

      // Fetch live spread dari CLOB
      // SESUDAH — tambah logging
      const book = await this.marketService.fetchOrderBook(tokenId);
      if (!book) {
        logger.info(`No orderbook data for ${market.slug} [${outcomeName}]`);
        continue;
      }

      const { bid, ask, spread } = book;
      logger.info(
        `${market.slug} [${outcomeName}] bid:${bid} ask:${ask} spread:${(spread * 100).toFixed(1)}¢ mid:${(((bid + ask) / 2) * 100).toFixed(1)}¢`,
      );

      // Skip jika spread terlalu lebar
      if (spread > config.maxSpreadThreshold) {
        logger.info(
          `Skip ${market.slug} — spread ${(spread * 100).toFixed(1)}¢ > threshold ${(config.maxSpreadThreshold * 100).toFixed(1)}¢`,
        );
        continue;
      }

      const midPrice = (bid + ask) / 2;

      // Strategi 1: Undervalued (15¢ - 40¢)
      const opp1 = this.checkUndervalued(
        market,
        tokenId,
        outcomeName,
        bid,
        ask,
        spread,
        midPrice,
      );
      if (opp1) opportunities.push(opp1);

      // Strategi 2: Long Shot (3¢ - 10¢, volume sangat tinggi)
      const opp2 = this.checkLongShot(
        market,
        tokenId,
        outcomeName,
        bid,
        ask,
        spread,
        midPrice,
      );
      if (opp2) opportunities.push(opp2);
    }

    return opportunities;
  }

  /**
   * Strategi 1: Token undervalued di range 15¢ - 40¢
   * Spread ketat = likuiditas nyata
   */
  private checkUndervalued(
    market: ParsedMarket,
    tokenId: string,
    outcomeName: string,
    bid: number,
    ask: number,
    spread: number,
    midPrice: number,
  ): MarketOpportunity | null {
    if (midPrice < this.UNDERVALUED_MIN || midPrice > this.UNDERVALUED_MAX)
      return null;

    const score = this.calculateScore(
      market.volume,
      market.liquidity,
      spread,
      midPrice,
    );
    return {
      market,
      tokenId,
      side: "BUY",
      price: ask,
      spread,
      reason: `[Undervalued] ${outcomeName} @ ${(ask * 100).toFixed(1)}¢ | spread: ${(spread * 100).toFixed(1)}¢ | vol: $${market.volume.toLocaleString()}`,
      score,
    };
  }

  /**
   * Strategi 2: Long Shot 3¢ - 10¢
   * Hanya untuk market dengan volume SANGAT tinggi (>$50k)
   * dan spread ketat — menandakan market maker aktif
   */
  private checkLongShot(
    market: ParsedMarket,
    tokenId: string,
    outcomeName: string,
    bid: number,
    ask: number,
    spread: number,
    midPrice: number,
  ): MarketOpportunity | null {
    // Filter ketat: harga 3¢-10¢, volume >$50k, spread <2¢
    if (midPrice < this.LONG_SHOT_MIN_PRICE) return null; // < 3¢ terlalu spekulatif
    if (midPrice > this.LONG_SHOT_MAX_PRICE) return null; // > 10¢ masuk kategori lain
    if (market.volume < this.LONG_SHOT_MIN_VOLUME) return null;
    if (spread > 0.04) return null; // spread harus <2¢ untuk long shot

    const score =
      this.calculateScore(market.volume, market.liquidity, spread, midPrice) *
      0.8;
    return {
      market,
      tokenId,
      side: "BUY",
      price: ask,
      spread,
      reason: `[Long Shot] ${outcomeName} @ ${(ask * 100).toFixed(1)}¢ | spread: ${(spread * 100).toFixed(1)}¢ | vol: $${market.volume.toLocaleString()}`,
      score,
    };
  }

  /**
   * Hitung score peluang: makin tinggi makin baik
   */
  private calculateScore(
    volume: number,
    liquidity: number,
    spread: number,
    price: number,
  ): number {
    const volumeScore = Math.min(volume / 100000, 1) * 40;
    const liquidityScore = Math.min(liquidity / 50000, 1) * 30;
    const spreadScore =
      Math.max(0, 1 - spread / config.maxSpreadThreshold) * 20;
    const priceScore = (1 - Math.abs(price - 0.25) / 0.25) * 10;
    return volumeScore + liquidityScore + spreadScore + priceScore;
  }
}
