import { relativeUpdated } from '../dateUtils';

export function SyncStatus({
  lastUpdated,
  hasError,
  connected,
  now,
}: {
  lastUpdated: string | null;
  hasError: boolean;
  connected: boolean;
  now: Date;
}) {
  const label = relativeUpdated(lastUpdated, now);
  const dotClass = !connected ? 'sync-dot-offline' : hasError ? 'sync-dot-warn' : 'sync-dot-ok';
  const title = !connected
    ? 'Verbinding met de dienst wordt hersteld'
    : hasError
      ? 'Even geen verse gegevens op te halen; laatste bekende agenda wordt getoond'
      : 'Verbonden';

  return (
    <div className="sync-status" title={title}>
      <span className={`sync-dot ${dotClass}`} />
      {label}
    </div>
  );
}
