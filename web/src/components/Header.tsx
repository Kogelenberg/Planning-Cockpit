import { formatClock, formatDate, greeting } from '../dateUtils';

export function Header({ now, onAddEvent }: { now: Date; onAddEvent: () => void }) {
  return (
    <header className="header">
      <div className="header-greeting">
        <h1>{greeting(now)}</h1>
        <p className="header-date">{formatDate(now)}</p>
      </div>
      <div className="header-right">
        <button className="header-add-button" onClick={onAddEvent} title="Afspraak toevoegen" aria-label="Afspraak toevoegen">
          +
        </button>
        <div className="header-clock">{formatClock(now)}</div>
      </div>
    </header>
  );
}
