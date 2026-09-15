import type { ViewFilter } from '../types';

const OPTIONS: { value: ViewFilter; label: string }[] = [
  { value: 'all', label: 'Alles' },
  { value: 'work', label: 'Werk' },
  { value: 'personal', label: 'Privé' },
  { value: 'calls', label: 'Alleen belafspraken' },
];

export function Filters({ value, onChange }: { value: ViewFilter; onChange: (value: ViewFilter) => void }) {
  return (
    <select
      className="view-filter-select"
      value={value}
      onChange={(e) => onChange(e.target.value as ViewFilter)}
      aria-label="Weergave"
    >
      {OPTIONS.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
