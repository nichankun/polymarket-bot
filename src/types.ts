// ============================================================
// Polymarket Bot - Type Definitions
// ============================================================

export interface GammaMarket {
  id: string;
  question: string;
  conditionId: string;
  slug: string;
  resolutionSource?: string;
  endDate?: string;
  startDate?: string;
  image?: string;
  icon?: string;
  description?: string;
  outcomes?: string;
  outcomePrices?: string;
  volume?: string;
  active?: boolean;
  closed?: boolean;
  liquidity?: string;
  clobTokenIds?: string;
  acceptingOrders?: boolean;
  negRisk?: boolean;
  minimumTickSize?: number;
  spread?: number;
  lastTradePrice?: number;
  bestBid?: number;
  bestAsk?: number;
}

export interface ParsedMarket {
  conditionId: string;
  question: string;
  slug: string;
  tokenIds: string[];         // [yesTokenId, noTokenId]
  active: boolean;
  closed: boolean;
  acceptingOrders: boolean;
  negRisk: boolean;
  tickSize: string;
  volume: number;
  liquidity: number;
  outcomes: string[];
  outcomePrices: number[];
}

export interface OrderBookEntry {
  price: string;
  size: string;
}

export interface OrderBook {
  market: string;
  asset_id: string;
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
  hash: string;
}

export interface MarketOpportunity {
  market: ParsedMarket;
  tokenId: string;
  side: "BUY" | "SELL";
  price: number;
  spread: number;
  reason: string;
  score: number;
}

export interface TradeRecord {
  timestamp: string;
  marketQuestion: string;
  conditionId: string;
  tokenId: string;
  side: "BUY" | "SELL";
  price: number;
  size: number;
  orderId?: string;
  status: string;
  dryRun: boolean;
}

export interface BotStats {
  startTime: Date;
  totalScans: number;
  totalOpportunities: number;
  totalOrdersPlaced: number;
  totalOrdersFailed: number;
  lastScanTime?: Date;
  errors: number;
}

export interface ApiCredentials {
  key: string;
  secret: string;
  passphrase: string;
}
