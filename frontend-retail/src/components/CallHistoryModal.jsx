import { useEffect, useState } from 'react';
import { apiGet } from '../lib/api';
import { useLanguage } from '../context/LanguageContext.jsx';
import { IconX, IconPhone, IconVideo, IconPhoneOff } from './Icons.jsx';

export default function CallHistoryModal({ currentUserId, onClose }) {
  const { t } = useLanguage();
  const [calls, setCalls] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet('/calls').then(setCalls).catch(() => {}).finally(() => setLoading(false));
  }, []);

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{t('misc.callHistory')}</div>
          <button className="btn ghost sm" onClick={onClose}><IconX size={15} /></button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1, padding: '8px 0' }}>
          {loading ? (
            <div style={{ textAlign: 'center', color: 'var(--cream-faint)', fontSize: 13, marginTop: 20 }}>{t('common.loading')}</div>
          ) : calls.length === 0 ? (
            <div style={{ textAlign: 'center', color: 'var(--cream-faint)', fontSize: 13, marginTop: 20 }}>{t('misc.noCalls')}</div>
          ) : (
            calls.map((c) => <CallRow key={c.id} call={c} currentUserId={currentUserId} />)
          )}
        </div>
      </div>
    </div>
  );
}

function CallRow({ call, currentUserId }) {
  const { t, tf } = useLanguage();
  const me = call.participants.find((p) => p.user_id === currentUserId);
  const others = call.participants.filter((p) => p.user_id !== currentUserId);
  const wasMissed = me && !me.joined_at;
  const wasOutgoing = call.initiator_id === currentUserId;
  const duration = me?.joined_at && me?.left_at
    ? Math.max(0, Math.round((new Date(me.left_at) - new Date(me.joined_at)) / 1000))
    : null;

  const label = call.group_id
    ? tf('call.group', { n: others.length })
    : (others[0]?.full_name || t('call.unknown'));

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px', borderBottom: '1px solid var(--line)' }}>
      <div style={{
        width: 32, height: 32, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: wasMissed ? 'rgba(209,60,60,.15)' : 'rgba(63,161,94,.15)', color: wasMissed ? '#d13c3c' : '#3fa15e',
      }}>
        {wasMissed ? <IconPhoneOff size={15} /> : (call.call_type === 'video' ? <IconVideo size={15} /> : <IconPhone size={15} />)}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 11.5, color: 'var(--cream-faint)' }}>
          {wasOutgoing ? t('call.outgoing') : wasMissed ? t('call.missed') : t('call.incoming')}
          {duration != null && ` · ${Math.floor(duration / 60)}:${String(duration % 60).padStart(2, '0')}`}
        </div>
      </div>
      <div style={{ fontSize: 11, color: 'var(--cream-faint)', whiteSpace: 'nowrap' }}>
        {new Date(call.started_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
      </div>
    </div>
  );
}

const overlayStyle = {
  position: 'fixed', inset: 0, zIndex: 999997, background: 'rgba(4,6,13,.6)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
};
const panelStyle = {
  background: 'var(--surface-2, #151928)', border: '1px solid var(--line)', borderRadius: 14,
  width: 420, maxWidth: '100%', maxHeight: '70vh', display: 'flex', flexDirection: 'column', overflow: 'hidden',
};
