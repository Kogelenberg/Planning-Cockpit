#!/bin/bash
# Bouwt de frontend (indien nodig) en start de altijd-actieve dienst.
# Gebruikt de lokale, portable Node.js-runtime in .runtime/node — er hoeft
# niets systeemgebreed geïnstalleerd te zijn.
set -e
cd "$(dirname "$0")"
export PATH="$(pwd)/.runtime/node/bin:$PATH"

if [ ! -d "web/dist" ]; then
  echo "Frontend nog niet gebouwd, bezig met bouwen..."
  npm run build
fi

exec npm run start
