import type { EventType } from './types';

export const TYPE_META: Record<EventType, { label: string; icon: string; className: string }> = {
  call: { label: 'Bellen', icon: '☎', className: 'type-call' },
  external: { label: 'Extern', icon: '⚑', className: 'type-external' },
  internal: { label: 'Overig', icon: '●', className: 'type-internal' },
};
