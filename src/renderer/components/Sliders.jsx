import { useRef } from 'react';

// a slider that snaps to one notch per option, with each option's name under its notch.
// an option can be disabled, and onDrag says when a drag starts and ends.
export function NotchedSlider({ label, options, value, onChange, onDrag, disabled = false }) {
  const trackRef = useRef(null);
  const index = Math.max(0, options.findIndex((o) => o.id === value));
  const last = options.length - 1;
  const at = (i) => `${(i / last) * 100}%`;

  const select = (i) => {
    const next = options[Math.min(last, Math.max(0, i))];
    if (next.id !== value && !next.disabled) onChange(next.id);
  };

  // the nearest notch to the pointer, so dragging snaps from one to the next.
  const pick = (e) => {
    const rect = trackRef.current.getBoundingClientRect();
    select(Math.round(((e.clientX - rect.left) / rect.width) * last));
  };

  const handleKeyDown = (e) => {
    const step = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1, Home: -last, End: last }[e.key];
    if (step === undefined) return;
    e.preventDefault();
    select(index + step);
  };

  return (
    <div className={`notched-slider${disabled ? ' slider-disabled' : ''}`}>
      <div
        className="notched-slider-hit"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-disabled={disabled}
        aria-valuemin={0}
        aria-valuemax={last}
        aria-valuenow={index}
        aria-valuetext={options[index].name}
        onPointerDown={(e) => {
          if (disabled) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          onDrag?.(true);
          pick(e);
        }}
        onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && pick(e)}
        onPointerUp={() => onDrag?.(false)}
        onLostPointerCapture={() => onDrag?.(false)}
        onKeyDown={disabled ? undefined : handleKeyDown}
      >
        <div className="notched-slider-track" ref={trackRef}>
          <div className="notched-slider-fill" style={{ width: at(index) }} />
          {options.map((option, i) => (
            <span
              key={option.id}
              className={`notched-slider-notch${i <= index ? ' notched-slider-notch-on' : ''}${option.disabled ? ' notched-slider-notch-off' : ''}`}
              style={{ left: at(i) }}
            />
          ))}
          <div className="notched-slider-thumb" style={{ left: at(index) }} />
        </div>
      </div>
      <div className="notched-slider-labels">
        {options.map((option, i) => (
          <button
            key={option.id}
            className={`notched-slider-label${i === index ? ' notched-slider-label-active' : ''}`}
            style={{ left: at(i) }}
            tabIndex={-1}
            disabled={disabled || option.disabled}
            onClick={() => select(i)}
          >
            {option.name}
          </button>
        ))}
      </div>
    </div>
  );
}

// a smooth slider in the same style, with a small mark at the original setting so it's easy to find again.
// the ends are named, and the value can be shown beside the label by whoever uses it.
export function RangeSlider({ label, min, max, step, value, onChange, onDrag, original, ends, disabled = false }) {
  const trackRef = useRef(null);
  const share = (v) => (v - min) / (max - min);
  const at = (v) => `${share(v) * 100}%`;

  const set = (v) => {
    const snapped = Math.round(Math.min(max, Math.max(min, v)) / step) * step;
    const next = Number(snapped.toFixed(4));
    if (next !== value) onChange(next);
  };

  const pick = (e) => {
    const rect = trackRef.current.getBoundingClientRect();
    set(min + ((e.clientX - rect.left) / rect.width) * (max - min));
  };

  const handleKeyDown = (e) => {
    const big = (max - min) / 10;
    const move = { ArrowLeft: -step, ArrowDown: -step, ArrowRight: step, ArrowUp: step, PageDown: -big, PageUp: big }[e.key];
    if (e.key === 'Home') set(min);
    else if (e.key === 'End') set(max);
    else if (move !== undefined) set(value + move);
    else return;
    e.preventDefault();
  };

  return (
    <div className={`notched-slider range-slider${disabled ? ' slider-disabled' : ''}`}>
      <div
        className="notched-slider-hit"
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-disabled={disabled}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        onPointerDown={(e) => {
          if (disabled) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          onDrag?.(true);
          pick(e);
        }}
        onPointerMove={(e) => e.currentTarget.hasPointerCapture(e.pointerId) && pick(e)}
        onPointerUp={() => onDrag?.(false)}
        onLostPointerCapture={() => onDrag?.(false)}
        onDoubleClick={() => original !== undefined && !disabled && set(original)}
        onKeyDown={disabled ? undefined : handleKeyDown}
        title={original !== undefined ? 'Double-click to go back to the original' : undefined}
      >
        <div className="notched-slider-track" ref={trackRef}>
          <div className="notched-slider-fill range-slider-fill" style={{ width: at(value) }} />
          {original !== undefined && <span className="range-slider-original" style={{ left: at(original) }} />}
          <div className="notched-slider-thumb range-slider-thumb" style={{ left: at(value) }} />
        </div>
      </div>
      {ends && (
        <div className="range-slider-ends">
          <span>{ends[0]}</span>
          <span>{ends[1]}</span>
        </div>
      )}
    </div>
  );
}
