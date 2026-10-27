import { createContext, useContext, useState, useCallback } from 'react';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  // options: { action: { label, onClick }, duration }
  const showToast = useCallback((message, type = 'info', options = {}) => {
    const id = Date.now() + Math.random();
    const duration = options.duration || (options.action ? 5000 : 3800);
    setToasts(t => [...t, { id, message, type, action: options.action }]);
    setTimeout(() => {
      setToasts(t => t.filter(x => x.id !== id));
    }, duration);
    return id;
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts(t => t.filter(x => x.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast, dismissToast }}>
      {children}
      <div style={{
        position: 'fixed', bottom: 'max(24px, env(safe-area-inset-bottom, 24px))', left: '50%', transform: 'translateX(-50%)',
        zIndex: 999, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center',
        width: 'calc(100% - 32px)', maxWidth: 420, pointerEvents: 'none',
      }}>
        {toasts.map(t => (
          <div key={t.id} style={{
            background: t.type === 'error' ? '#4A2420' : t.type === 'success' ? '#1A4A38' : '#252A3D',
            border: `1px solid ${t.type === 'error' ? 'var(--red)' : t.type === 'success' ? 'var(--emerald)' : 'var(--line-2)'}`,
            color: '#F3EFE4', padding: '10px 14px 10px 18px', borderRadius: 12,
            fontSize: 14, boxShadow: '0 10px 30px rgba(0,0,0,.5), 0 2px 8px rgba(0,0,0,.3)',
            width: '100%', boxSizing: 'border-box', textAlign: 'center',
            animation: 'toastIn .2s ease', backdropFilter: 'blur(8px)', pointerEvents: 'auto',
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            <span>{t.message}</span>
            {t.action && (
              <button
                onClick={() => { t.action.onClick(); dismissToast(t.id); }}
                style={{
                  background: 'var(--gold-21)', color: '#1A1508', border: 'none',
                  borderRadius: 6, padding: '5px 12px', fontSize: 13, fontWeight: 700,
                  cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
      <style>{`@keyframes toastIn { from { opacity:0; transform:translateY(8px);} to {opacity:1; transform:translateY(0);} }`}</style>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
