import { formatClock, formatDate, greeting } from '../dateUtils';

export function Header({ now }: { now: Date }) {
  return (
    <header className="header">
      <div className="header-greeting">
        <h1>{greeting(now)}</h1>
        <p className="header-date">{formatDate(now)}</p>
      </div>
      <div className="header-clock">{formatClock(now)}</div>
    </header>
  );
}
