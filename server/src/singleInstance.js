import fs from 'node:fs';
import path from 'node:path';
import { config, ensureDataDir } from './config.js';

/**
 * Voorkomt dat er per ongeluk meerdere achtergrondprocessen tegelijk draaien.
 * Dat gebeurde eerder echt: elke herstart liet het oude proces per ongeluk
 * doorlopen, en meerdere processen die onafhankelijk van elkaar naar dezelfde
 * data/*.json-bestanden schreven, overschreven elkaars wijzigingen willekeurig
 * (een net opgeslagen notitie of verzet-actie kon zo weer verdwijnen).
 */
const PID_FILE = path.join(path.dirname(config.dataFile), 'server.pid');

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function ensureSingleInstance() {
  ensureDataDir();

  if (fs.existsSync(PID_FILE)) {
    const existingPid = Number(fs.readFileSync(PID_FILE, 'utf-8').trim());
    if (existingPid && existingPid !== process.pid && isProcessAlive(existingPid)) {
      console.error(
        `Er draait al een Planning Cockpit-proces (pid ${existingPid}). Sluit dat eerst af (bv. \`kill ${existingPid}\`) voordat je een nieuwe start.`
      );
      process.exit(1);
    }
    // Bestaand bestand hoort bij een proces dat niet meer leeft — veilig te overschrijven.
  }

  fs.writeFileSync(PID_FILE, String(process.pid));

  const cleanup = () => {
    try {
      if (fs.existsSync(PID_FILE) && fs.readFileSync(PID_FILE, 'utf-8').trim() === String(process.pid)) {
        fs.unlinkSync(PID_FILE);
      }
    } catch {
      // Best effort.
    }
  };

  process.on('exit', cleanup);
  process.on('SIGINT', () => {
    cleanup();
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });
}
