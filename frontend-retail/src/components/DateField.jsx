import { useRef } from 'react';

// Native <input type="date"> renders its calendar icon and mm/dd/yyyy text
// left-anchored no matter what CSS direction/text-align says — a browser
// limitation, not something author CSS can override. Rather than leave a
// stray left-clustered field sitting in an otherwise fully right-aligned
// RTL form, this hides the native icon and draws our own in the correct
// spot, while still using the real native input (and its picker) underneath
// so date selection keeps working exactly as before.
export default function DateField({ value, onChange, className = '', disabled = false, ...props }) {
  const ref = useRef(null);

  function openPicker() {
    if (disabled) return;
    if (ref.current?.showPicker) {
      try { ref.current.showPicker(); } catch (_) { ref.current.focus(); }
    } else {
      ref.current?.focus();
    }
  }

  return (
    <div
      className={`date-field-wrap ${className} ${disabled ? 'date-field-disabled' : ''}`}
      onClick={openPicker}
    >
      <svg className="date-field-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="18" rx="2" />
        <path d="M16 2v4M8 2v4M3 10h18" />
      </svg>
      <input ref={ref} type="date" value={value} onChange={onChange} disabled={disabled} {...props} />
    </div>
  );
}
