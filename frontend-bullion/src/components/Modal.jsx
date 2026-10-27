import { IconX } from './Icons.jsx';

export default function Modal({ title, onClose, children, width = 480 }) {
  return (
    <div
      className="modal-overlay show"
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'rgba(4,6,13,.6)', overflowY: 'auto', padding: '24px 16px',
      }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="panel"
        style={{ width, maxWidth: '92vw', margin: 'auto', maxHeight: '86vh', overflowY: 'auto' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div className="page-title" style={{ fontSize: 17 }}>{title}</div>
          <button className="btn ghost sm" onClick={onClose}><IconX size={15} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}
