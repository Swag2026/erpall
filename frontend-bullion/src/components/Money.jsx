import { IconSaudiRiyal } from './Icons.jsx';

// Renders an amount with the official Saudi Riyal symbol instead of the
// text "SAR" — usage: <Money value={12000} /> or <Money value={12000} bold />
export default function Money({ value, decimals = 0, style = {}, iconStyle = {}, className = '' }) {
  const formatted = Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: decimals });
  return (
    <span className={className} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.2em', ...style }}>
      <IconSaudiRiyal style={{ flexShrink: 0, ...iconStyle }} />
      {formatted}
    </span>
  );
}
