import { useCall } from '../context/CallContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import { IconPhone, IconPhoneOff, IconVideo } from './Icons.jsx';

export default function IncomingCallBanner() {
  const { incomingCall, acceptCall, declineCall } = useCall();
  const { t, lang } = useLanguage();
  if (!incomingCall) return null;

  return (
    <div style={overlayStyle}>
      <div style={cardStyle}>
        <div style={{ fontSize: 15, color: '#b8ae94', marginBottom: 4 }}>
          {incomingCall.group_id ? t('call.group').replace(/\s*\(.*\)\s*$/, '') : (incomingCall.call_type === 'video' ? t('call.video') : t('call.voice'))}
        </div>
        <div style={{ fontSize: 20, fontWeight: 700, color: '#f3ecd8', marginBottom: 22 }}>
          {lang === 'ar' ? `${incomingCall.from_name || 'شخص ما'} يتصل بك…` : `${incomingCall.from_name || 'Someone'} is calling…`}
        </div>
        <div style={{ display: 'flex', gap: 20, justifyContent: 'center' }}>
          <button onClick={declineCall} style={{ ...btnStyle, background: '#d13c3c' }} title={t('call.decline')}>
            <IconPhoneOff size={22} />
          </button>
          <button onClick={acceptCall} style={{ ...btnStyle, background: '#3fa15e' }} title={t('call.accept')}>
            {incomingCall.call_type === 'video' ? <IconVideo size={22} /> : <IconPhone size={22} />}
          </button>
        </div>
      </div>
    </div>
  );
}

const overlayStyle = {
  position: 'fixed', inset: 0, zIndex: 999999, background: 'rgba(4,6,13,.75)',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
};
const cardStyle = {
  background: '#151928', border: '1px solid #d4af37', borderRadius: 14,
  padding: '30px 36px', textAlign: 'center', minWidth: 280,
};
const btnStyle = {
  width: 56, height: 56, borderRadius: '50%', border: 'none', cursor: 'pointer',
  color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
};
