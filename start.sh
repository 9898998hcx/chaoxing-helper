#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT_DIR"

echo
echo "================================================"
echo "  Resume Workshop - Local one-click startup"
echo "================================================"
echo

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js was not found. Install Node.js 22.12 or newer from https://nodejs.org/" >&2
  exit 1
fi
if ! command -v npm >/dev/null 2>&1; then
  echo "[ERROR] npm was not found. Install it together with Node.js." >&2
  exit 1
fi

if ! node -e "const v=process.versions.node.split('.').map(Number); if(v[0]<22 || (v[0]===22 && v[1]<12)) process.exit(1)"; then
  echo "[ERROR] Node.js 22.12 or newer is required. Current version: $(node --version)" >&2
  exit 1
fi

if [[ ! -f .env ]]; then
  echo "[1/6] Creating .env from .env.example..."
  cp .env.example .env
fi

echo "[2/6] Checking local encryption key..."
node <<'NODE'
const fs = require('node:fs');
const crypto = require('node:crypto');
const path = '.env';
let contents = fs.readFileSync(path, 'utf8');
const line = `USER_SECRET_ENCRYPTION_KEY=${crypto.randomBytes(32).toString('hex')}`;
const keyLine = /^USER_SECRET_ENCRYPTION_KEY=.*$/mi;
if (!/^USER_SECRET_ENCRYPTION_KEY=[0-9a-f]{64}$/mi.test(contents)) {
  contents = keyLine.test(contents) ? contents.replace(keyLine, line) : `${contents.trimEnd()}\n${line}\n`;
  fs.writeFileSync(path, contents);
}
NODE

if [[ ! -d node_modules ]]; then
  echo "[3/6] Installing npm dependencies..."
  npm ci --no-audit --no-fund
else
  echo "[3/6] npm dependencies already installed."
fi

if [[ ! -d node_modules/.prisma/client ]]; then
  echo "[4/6] Generating Prisma client..."
  npm run db:generate
else
  echo "[4/6] Prisma client already generated."
fi

echo "[5/6] Applying SQLite migrations and seeding local templates..."
npm run db:migrate
npm run db:seed

echo "[6/6] Ensuring Chromium is available for PDF export..."
npx playwright install chromium

echo
echo "Starting the web app at http://127.0.0.1:3000"
echo "Keep this terminal open while using the app. Press Ctrl+C to stop it."
echo
npm run dev
