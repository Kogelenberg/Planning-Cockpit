#!/bin/bash
# Bouwt de frontend (indien nodig) en start de altijd-actieve dienst.
# Gebruikt de lokale, portable Node.js-runtime in .runtime/node — er hoeft
# niets systeemgebreed geïnstalleerd te zijn.
set -e
cd "$(dirname "$0")"

# Machine-eigen instellingen (bv. jouw agenda-namen op een andere Mac) staan
# in .env.local — nooit in git (zie .gitignore), dus elke machine kan zijn
# eigen config hebben zonder de code aan te passen. Zie .env.local.example.
if [ -f .env.local ]; then
  set -a
  source .env.local
  set +a
fi

export PATH="$(pwd)/.runtime/node/bin:$PATH"

if [ ! -d "web/dist" ]; then
  echo "Frontend nog niet gebouwd, bezig met bouwen..."
  npm run build
fi

exec npm run start
