import { config } from './config.js';
import { loadPersistedState } from './eventStore.js';
import { loadAnnotations } from './annotations.js';
import { ensureSingleInstance } from './singleInstance.js';
import { startServer } from './server.js';
import { pollOnce, getLastPollAt } from './sync.js';

// Vaak korter dan de eigenlijke ververssnelheid: dit is een "hartslag" die
// checkt of een verversing inmiddels nodig is, in plaats van blind op
// setInterval te vertrouwen. Reden: als de Mac in slaapstand gaat (dichte
// deksel, schermslaap), lopen alle timers — inclusief setInterval — gewoon
// stil totdat de Mac wakker wordt. Zonder deze hartslag zou de agenda dan
// pas ververst worden bij de eerstvolgende toevallige tik, wat soms
// tientallen minuten kon duren. Nu wordt binnen een paar tellen na het
// wakker worden altijd een verse ophaal getriggerd.
const HEARTBEAT_MS = 15000;

async function main() {
  ensureSingleInstance();
  loadPersistedState();
  loadAnnotations();
  startServer();
  await pollOnce();
  setInterval(() => {
    if (Date.now() - getLastPollAt() >= config.pollIntervalMs) {
      pollOnce();
    }
  }, HEARTBEAT_MS);
}

main();
