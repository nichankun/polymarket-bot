import * as dotenv from "dotenv";
dotenv.config();

function requireEnv(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}

function optionalEnv(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

export const config = {
  // Wallet
  privateKey: requireEnv("PRIVATE_KEY") as `0x${string}`,
  walletAddress: requireEnv("WALLET_ADDRESS") as `0x${string}`,
  funderAddress: requireEnv("FUNDER_ADDRESS") as `0x${string}`,
  signatureType: parseInt(optionalEnv("SIGNATURE_TYPE", "0")) as 0 | 1 | 2,

  // API Endpoints
  clobHost: optionalEnv("CLOB_HOST", "https://clob.polymarket.com"),
  gammaHost: optionalEnv("GAMMA_HOST", "https://gamma-api.polymarket.com"),
  dataHost: optionalEnv("DATA_HOST", "https://data-api.polymarket.com"),
  rpcUrl: optionalEnv("POLYGON_RPC_URL", "https://polygon-rpc.com"),

  // Bot strategy
  scanIntervalMs: parseInt(optionalEnv("SCAN_INTERVAL_MS", "30000")),
  defaultOrderSize: parseFloat(optionalEnv("DEFAULT_ORDER_SIZE", "10")),
  maxPositionSize: parseFloat(optionalEnv("MAX_POSITION_SIZE", "100")),
  minBuyPrice: parseFloat(optionalEnv("MIN_BUY_PRICE", "0.05")),
  maxBuyPrice: parseFloat(optionalEnv("MAX_BUY_PRICE", "0.95")),
  maxSpreadThreshold: parseFloat(optionalEnv("MAX_SPREAD_THRESHOLD", "0.05")),
  dryRun: optionalEnv("DRY_RUN", "true") === "true",
} as const;

export type Config = typeof config;
