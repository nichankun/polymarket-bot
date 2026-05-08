// SESUDAH — tambahkan polyfill atob untuk Node.js
import "dotenv/config";

// Node.js atob tidak support semua Base64 variant yang dipakai Polymarket SDK
// Polyfill dengan implementasi yang lebih toleran
if (
  typeof globalThis.atob === "undefined" ||
  globalThis.atob.toString().includes("native code")
) {
  globalThis.atob = (str: string) =>
    Buffer.from(str, "base64").toString("binary");
  globalThis.btoa = (str: string) =>
    Buffer.from(str, "binary").toString("base64");
}

import { PolymarketBot } from "./bot";
import { logger } from "./logger";

// ============================================================
// Entry Point — Starts the bot and handles signals
// ============================================================

async function main() {
  const bot = new PolymarketBot();

  // Graceful shutdown on Ctrl+C or SIGTERM (e.g. from PM2 / Docker)
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, initiating graceful shutdown...`);
    await bot.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Global unhandled error safety net — log but keep running
  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled promise rejection", { reason });
  });

  process.on("uncaughtException", (err) => {
    logger.error("Uncaught exception", {
      error: err.message,
      stack: err.stack,
    });
    // Don't crash — let the bot keep running unless critical
  });

  try {
    await bot.start();
  } catch (err) {
    logger.error("Fatal error during bot startup", {
      error: err instanceof Error ? err.message : err,
    });
    process.exit(1);
  }
}

main();
