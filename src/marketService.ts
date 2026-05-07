import { config } from "./config";
import { logger } from "./logger";
import type { GammaMarket, ParsedMarket } from "./types";

// ============================================================
// Market Service — Fetches data from Gamma API (no auth needed)
// ============================================================

interface PriceResponse {
  price: string;
}

interface MidpointResponse {
  mid: string;
}

export class MarketService {
  private readonly baseUrl: string;

  constructor() {
    this.baseUrl = config.gammaHost;
  }

  async fetchActiveMarkets(limit = 20): Promise<ParsedMarket[]> {
    const url = new URL(`${this.baseUrl}/markets`);
    url.searchParams.set("active", "true");
    url.searchParams.set("closed", "false");
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("order", "volume");
    url.searchParams.set("ascending", "false");

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(
        `Gamma API error: ${response.status} ${response.statusText}`,
      );
    }

    const markets = (await response.json()) as GammaMarket[];
    return markets
      .map((m) => this.parseMarket(m))
      .filter((m): m is ParsedMarket => m !== null);
  }

  async fetchMarketByConditionId(
    conditionId: string,
  ): Promise<ParsedMarket | null> {
    const url = `${this.baseUrl}/markets/${conditionId}`;
    const response = await fetch(url);
    if (!response.ok) {
      logger.warn(`Market not found: ${conditionId}`);
      return null;
    }
    const market = (await response.json()) as GammaMarket;
    return this.parseMarket(market);
  }

  async fetchMarketsByTag(tag: string, limit = 10): Promise<ParsedMarket[]> {
    const url = new URL(`${this.baseUrl}/markets`);
    url.searchParams.set("active", "true");
    url.searchParams.set("closed", "false");
    url.searchParams.set("tag", tag);
    url.searchParams.set("limit", String(limit));

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(
        `Gamma API error: ${response.status} ${response.statusText}`,
      );
    }

    const markets = (await response.json()) as GammaMarket[];
    return markets
      .map((m) => this.parseMarket(m))
      .filter((m): m is ParsedMarket => m !== null);
  }

  async fetchOrderBook(
    tokenId: string,
  ): Promise<{ bid: number; ask: number; spread: number } | null> {
    try {
      const url = `${config.clobHost}/book?token_id=${tokenId}`;
      const res = await fetch(url);
      if (!res.ok) return null;

      const data = (await res.json()) as {
        bids: { price: string; size: string }[];
        asks: { price: string; size: string }[];
      };

      if (!data.bids?.length || !data.asks?.length) return null;

      // Best bid = highest bid, best ask = lowest ask
      const bid = Math.max(...data.bids.map((b) => parseFloat(b.price)));
      const ask = Math.min(...data.asks.map((a) => parseFloat(a.price)));

      if (isNaN(bid) || isNaN(ask) || ask <= bid) return null;

      const spread = ask - bid;
      return { bid, ask, spread };
    } catch {
      return null;
    }
  }

  async fetchMidpoint(tokenId: string): Promise<number | null> {
    try {
      const url = `${config.clobHost}/midpoint?token_id=${tokenId}`;
      const res = await fetch(url);
      if (!res.ok) return null;
      const data = (await res.json()) as MidpointResponse;
      return parseFloat(data.mid);
    } catch {
      return null;
    }
  }

  private parseMarket(market: GammaMarket): ParsedMarket | null {
    try {
      const tokenIds: string[] = market.clobTokenIds
        ? JSON.parse(market.clobTokenIds)
        : [];

      if (tokenIds.length === 0) return null;

      const outcomes: string[] = market.outcomes
        ? JSON.parse(market.outcomes)
        : ["Yes", "No"];

      const outcomePrices: number[] = market.outcomePrices
        ? (JSON.parse(market.outcomePrices) as string[]).map(Number)
        : [0.5, 0.5];

      return {
        conditionId: market.conditionId,
        question: market.question,
        slug: market.slug,
        tokenIds,
        active: market.active ?? false,
        closed: market.closed ?? false,
        acceptingOrders: market.acceptingOrders ?? false,
        negRisk: market.negRisk ?? false,
        tickSize: String(market.minimumTickSize ?? "0.01"),
        volume: parseFloat(market.volume ?? "0"),
        liquidity: parseFloat(market.liquidity ?? "0"),
        outcomes,
        outcomePrices,
      };
    } catch {
      return null;
    }
  }
}
