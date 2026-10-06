import { useRef } from 'react';
import { formatDuration, formatMinutes } from '../eventUtils';

const STEP = 5;
const DEFAULT_RANGE_MIN = 7 * 60;
const DEFAULT_RANGE_MAX = 22 * 60;

type DragMode = 'start' | 'end' | 'move';

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Tijdbalk met een begin- en een eindgreep (van hoe laat tot hoe laat), in
 * stappen van 5 minuten. Klik ergens op de balk om het blok daar neer te
 * zetten, sleep de middelste balk om het te verschuiven (duur blijft gelijk),
 * of sleep een van de twee uiteinden om begin of eind aan te passen. Met het
 * toetsenbord: pijltjes = 5 min, Shift+pijl = 30 min. Het zichtbare bereik
 * rekt vanzelf mee als de gekozen tijd er buiten valt.
 */
export function TimeRangeSlider({
  startMin,
  endMin,
  onChange,
  disabled,
}: {
  startMin: number;
  endMin: number;
  onChange: (startMin: number, endMin: number) => void;
  disabled?: boolean;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ mode: DragMode; grab: number } | null>(null);
  // Tijdens het slepen blijft het zichtbare bereik vastgezet, anders schuift de
  // schaal onder je vinger weg als het bereik meerekt met de gekozen tijd.
  const dragRangeRef = useRef<{ min: number; max: number } | null>(null);

  const liveRange = {
    min: Math.min(DEFAULT_RANGE_MIN, Math.floor(startMin / 60) * 60),
    max: Math.max(DEFAULT_RANGE_MAX, Math.ceil(endMin / 60) * 60),
  };
  const { min: rangeMin, max: rangeMax } = dragRangeRef.current ?? liveRange;
  const span = rangeMax - rangeMin;
  const duration = endMin - startMin;

  function minutesAt(clientX: number): number {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return startMin;
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
    return Math.round((rangeMin + ratio * span) / STEP) * STEP;
  }

  function apply(mode: DragMode, pointerMinutes: number, grab: number) {
    if (mode === 'start') {
      const next = clamp(pointerMinutes, rangeMin, endMin - STEP);
      if (next !== startMin) onChange(next, endMin);
    } else if (mode === 'end') {
      const next = clamp(pointerMinutes, startMin + STEP, rangeMax);
      if (next !== endMin) onChange(startMin, next);
    } else {
      const next = clamp(pointerMinutes - grab, rangeMin, rangeMax - duration);
      if (next !== startMin) onChange(next, next + duration);
    }
  }

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (disabled) return;
    const part = (e.target as HTMLElement).closest<HTMLElement>('[data-part]')?.dataset.part;
    const minutes = minutesAt(e.clientX);
    let mode: DragMode;
    let grab = 0;
    if (part === 'start') mode = 'start';
    else if (part === 'end') mode = 'end';
    else if (part === 'bar') {
      mode = 'move';
      grab = minutes - startMin;
    } else {
      mode = 'move';
    }
    dragRef.current = { mode, grab };
    dragRangeRef.current = { min: rangeMin, max: rangeMax };
    e.currentTarget.setPointerCapture(e.pointerId);
    apply(mode, minutes, grab);
  }

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    apply(drag.mode, minutesAt(e.clientX), drag.grab);
  }

  function handlePointerUp() {
    dragRef.current = null;
    dragRangeRef.current = null;
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLDivElement>, mode: 'start' | 'end') {
    if (disabled) return;
    const big = e.shiftKey ? 30 : STEP;
    let delta = 0;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') delta = -big;
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') delta = big;
    else if (e.key === 'PageDown') delta = -60;
    else if (e.key === 'PageUp') delta = 60;
    if (delta === 0) return;
    e.preventDefault();
    apply(mode, (mode === 'start' ? startMin : endMin) + delta, 0);
  }

  const leftPercent = ((startMin - rangeMin) / span) * 100;
  const widthPercent = (duration / span) * 100;

  const labels: number[] = [];
  for (let hour = Math.ceil(rangeMin / 60); hour * 60 <= rangeMax; hour += 1) {
    if (hour % 3 === 0) labels.push(hour * 60);
  }

  return (
    <div className={`timerange ${disabled ? 'is-disabled' : ''}`}>
      <div className="timerange-readout">
        <span className="timerange-times">
          {formatMinutes(startMin)} – {formatMinutes(endMin)}
        </span>
        <span className="timerange-duration">{formatDuration(duration)}</span>
      </div>
      <div
        ref={trackRef}
        className="timerange-track"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        <div className="timerange-rail" />
        <div
          className="timerange-bar"
          data-part="bar"
          style={{ left: `${leftPercent}%`, width: `${widthPercent}%` }}
        />
        <div
          className="timerange-handle timerange-handle-start"
          data-part="start"
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-label="Begintijd"
          aria-valuemin={rangeMin}
          aria-valuemax={endMin - STEP}
          aria-valuenow={startMin}
          aria-valuetext={formatMinutes(startMin)}
          style={{ left: `${leftPercent}%` }}
          onKeyDown={(e) => handleKeyDown(e, 'start')}
        />
        <div
          className="timerange-handle timerange-handle-end"
          data-part="end"
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-label="Eindtijd"
          aria-valuemin={startMin + STEP}
          aria-valuemax={rangeMax}
          aria-valuenow={endMin}
          aria-valuetext={formatMinutes(endMin)}
          style={{ left: `${leftPercent + widthPercent}%` }}
          onKeyDown={(e) => handleKeyDown(e, 'end')}
        />
      </div>
      <div className="timerange-scale">
        {labels.map((minutes) => (
          <span key={minutes} style={{ left: `${((minutes - rangeMin) / span) * 100}%` }}>
            {String(minutes / 60).padStart(2, '0')}
          </span>
        ))}
      </div>
    </div>
  );
}
