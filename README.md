# 🤖 Polymarket Bot

Bot trading otomatis 24/7 untuk [Polymarket](https://polymarket.com) — dibangun dengan TypeScript menggunakan SDK resmi `@polymarket/clob-client-v2`.

---

## 📁 Struktur Proyek

```
polymarket-bot/
├── src/
│   ├── index.ts           # Entry point
│   ├── bot.ts             # Orchestrator utama (loop 24/7)
│   ├── config.ts          # Konfigurasi dari .env
│   ├── logger.ts          # Winston logger
│   ├── types.ts           # TypeScript type definitions
│   ├── marketService.ts   # Fetch data dari Gamma + CLOB API
│   ├── strategyEngine.ts  # Logika pencarian peluang
│   └── tradingService.ts  # Auth + eksekusi order
├── logs/                  # Log files (auto-created)
├── .env.example           # Template konfigurasi
├── .env                   # Konfigurasi Anda (JANGAN di-commit!)
├── ecosystem.config.js    # PM2 config (untuk 24/7)
├── package.json
└── tsconfig.json
```

---

## ⚙️ Persyaratan

- Node.js v18+
- pnpm
- Wallet Polygon (EOA atau Gnosis Safe)
- pUSD di wallet Polymarket Anda (untuk trading)
- POL untuk gas (jika pakai EOA)

---

## 🚀 Cara Instalasi

### 1. Clone dan install dependencies

```bash
git clone <repo-url> polymarket-bot
cd polymarket-bot
pnpm install
```

### 2. Konfigurasi environment

```bash
cp .env.example .env
```

Edit file `.env`:

```env
# Private key wallet Anda (hex, mulai 0x)
PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HERE

# Alamat wallet EOA Anda
WALLET_ADDRESS=0xYOUR_WALLET_ADDRESS

# Signature type:
# 0 = EOA (MetaMask biasa — butuh POL untuk gas)
# 1 = POLY_PROXY (Magic Link / Google login)
# 2 = GNOSIS_SAFE (paling umum untuk akun Polymarket)
SIGNATURE_TYPE=0

# Funder address = alamat proxy wallet Anda di polymarket.com/settings
FUNDER_ADDRESS=0xYOUR_FUNDER_ADDRESS

# Mode aman (tidak ada order nyata)
DRY_RUN=true
```

### 3. Build TypeScript

```bash
pnpm build
```

### 4. Jalankan

```bash
# Development (dengan hot reload)
pnpm dev

# Production
pnpm start
```

---

## 🌙 Jalankan 24/7 dengan PM2

```bash
# Install PM2 secara global
npm install -g pm2

# Build terlebih dahulu
pnpm build

# Start dengan PM2
pm2 start ecosystem.config.js

# Lihat logs secara live
pm2 logs polymarket-bot

# Status bot
pm2 status

# Restart
pm2 restart polymarket-bot

# Stop
pm2 stop polymarket-bot

# Auto-start saat reboot
pm2 startup
pm2 save
```

---

## 🧠 Strategi Trading

Bot ini menggunakan dua strategi bawaan:

### 1. Undervalued Token Strategy
Mencari token yang diperdagangkan di harga 10–40¢ dengan:
- Spread sempit (< `MAX_SPREAD_THRESHOLD`)
- Volume tinggi (> $1.000)
- Likuiditas cukup (> $500)

### 2. Long Shot Strategy
Mencari token murah (< 8¢) di pasar dengan volume sangat tinggi (> $10.000) yang berpotensi memiliki upside besar.

### Menambah Strategi Sendiri

Edit `src/strategyEngine.ts` dan tambahkan method baru di kelas `StrategyEngine`:

```typescript
private checkMyStrategy(
  market: ParsedMarket,
  tokenId: string,
  outcomeName: string,
  bid: number,
  ask: number,
  spread: number,
  index: number
): MarketOpportunity | null {
  // Logika strategi Anda di sini
  return null;
}
```

Lalu panggil dari `evaluateMarket()`.

---

## ⚙️ Konfigurasi Lengkap

| Variable              | Default | Keterangan                                         |
|-----------------------|---------|----------------------------------------------------|
| `PRIVATE_KEY`         | —       | Private key wallet (wajib)                         |
| `WALLET_ADDRESS`      | —       | Alamat EOA wallet (wajib)                          |
| `FUNDER_ADDRESS`      | —       | Alamat proxy/funder wallet (wajib)                 |
| `SIGNATURE_TYPE`      | `0`     | 0=EOA, 1=Proxy, 2=Gnosis                           |
| `SCAN_INTERVAL_MS`    | `30000` | Interval scan dalam ms (30 detik)                  |
| `DEFAULT_ORDER_SIZE`  | `10`    | Ukuran order dalam USD                             |
| `MAX_POSITION_SIZE`   | `100`   | Maks posisi per market dalam USD                   |
| `MIN_BUY_PRICE`       | `0.05`  | Harga minimum untuk beli (5¢)                      |
| `MAX_BUY_PRICE`       | `0.95`  | Harga maksimum untuk beli (95¢)                    |
| `MAX_SPREAD_THRESHOLD`| `0.05`  | Maks spread yang ditoleransi (5¢)                  |
| `DRY_RUN`             | `true`  | `true` = simulasi saja, `false` = order nyata      |
| `LOG_LEVEL`           | `info`  | Level log: `debug`, `info`, `warn`, `error`        |

---

## 📊 Monitoring

Log tersimpan di folder `logs/`:
- `bot.log` — semua log aktivitas
- `error.log` — error saja
- `trades.jsonl` — riwayat semua trade (JSON Lines)

Contoh membaca riwayat trade:
```bash
cat logs/trades.jsonl | jq .
```

---

## ⚠️ Disclaimer

- Bot ini untuk tujuan edukasi. Trading di prediction market memiliki risiko finansial nyata.
- **Selalu mulai dengan `DRY_RUN=true`** untuk memastikan bot bekerja sesuai ekspektasi.
- Jangan pernah menyimpan private key di version control.
- Pastikan Anda memahami mekanisme Polymarket sebelum live trading.

---

## 📚 Referensi

- [Polymarket Docs](https://docs.polymarket.com)
- [CLOB Client v2 (TypeScript)](https://github.com/Polymarket/clob-client-v2)
- [Gamma API](https://gamma-api.polymarket.com)
- [CLOB API](https://clob.polymarket.com)
