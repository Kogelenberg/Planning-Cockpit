export function DoneCheck({
  done,
  onToggle,
  title,
}: {
  done: boolean;
  onToggle: () => void;
  title: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={done ? `${title} — afgerond, klik om ongedaan te maken` : `${title} — markeer als afgerond`}
      title={done ? 'Afgerond — klik om ongedaan te maken' : 'Markeer als afgerond'}
      className={`done-check ${done ? 'is-checked' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}
