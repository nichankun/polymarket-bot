// PM2 Ecosystem Config — for running the bot 24/7
// Usage: pm2 start ecosystem.config.js

module.exports = {
  apps: [
    {
      name: "polymarket-bot",
      script: "dist/index.js",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "512M",
      restart_delay: 5000,     // Wait 5s before restarting after crash
      max_restarts: 10,        // Stop trying after 10 restarts
      min_uptime: "10s",       // Consider started if alive for 10s
      env: {
        NODE_ENV: "production",
      },
      log_file: "logs/pm2-combined.log",
      out_file: "logs/pm2-out.log",
      error_file: "logs/pm2-error.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      merge_logs: true,
    },
  ],
};
