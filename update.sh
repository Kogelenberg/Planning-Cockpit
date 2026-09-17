#!/bin/bash
# Haalt de laatste versie van Planning Cockpit op van GitHub en past hem toe.
# Je eigen instellingen (.env.local) en agendadata (data/) blijven altijd staan,
# want die staan niet in git (zie .gitignore) en worden dus nooit aangeraakt.
#
# Gebruik: open Terminal, ga naar deze map en typ: ./update.sh
set -e
cd "$(dirname "$0")"

echo "Stap 1/4: laatste versie ophalen van GitHub..."
git fetch origin
if ! git merge --ff-only origin/main; then
  echo ""
  echo "Kon niet automatisch bijwerken: er zijn lokale wijzigingen die"
  echo "conflicteren met de nieuwe versie op GitHub. Los dit handmatig op"
  echo "(bekijk 'git status' en 'git diff'), of vraag het aan Claude."
  exit 1
fi

echo "Stap 2/4: dependencies installeren..."
npm install

echo "Stap 3/4: frontend bouwen..."
npm run build

echo "Stap 4/4: dienst herstarten..."
mkdir -p logs
if [ -f data/server.pid ]; then
  OLD_PID=$(cat data/server.pid)
  if kill -0 "$OLD_PID" 2>/dev/null; then
    kill "$OLD_PID"
    sleep 1
  fi
fi

# Draait de cockpit als LaunchAgent (autostart)? Dan herstart launchd het
# proces vanzelf na de kill hierboven (KeepAlive). Zo niet, start het hier
# gewoon zelf weer op.
sleep 1
if ! pgrep -f "node src/index.js" > /dev/null 2>&1; then
  nohup ./start.sh > logs/update-restart.log 2>&1 &
  disown
fi

sleep 1
echo ""
echo "Klaar! Planning Cockpit draait weer op http://localhost:4173 met de nieuwste versie van GitHub."
