import type { EventType } from '../types';
import { TYPE_META } from '../typeMeta';

export function TypeBadge({ type }: { type: EventType }) {
  const meta = TYPE_META[type];
  return (
    <span className={`type-badge ${meta.className}`}>
      <span className="type-badge-icon">{meta.icon}</span>
      {meta.label}
    </span>
  );
}
