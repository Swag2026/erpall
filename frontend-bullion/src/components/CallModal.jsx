import { useEffect, useRef, useState, useCallback } from 'react';
import { apiGet } from '../lib/api';
import { useCall } from '../context/CallContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import { IconMic, IconMicOff, IconVideo, IconVideoOff, IconPhoneOff, IconMinimize, IconMaximize } from './Icons.jsx';

const BASE_TITLE = document.title;

// Mesh WebRTC: every participant opens a direct RTCPeerConnection to every
// other participant. Fine for the small group sizes this app's chat groups
// actually have — each added participant means every existing participant
// uploads one more stream, so this isn't meant to scale to large rooms.
// A big group calling feature would need a media server (SFU) instead;
// that's a separate, much bigger project if it's ever needed.
export default function CallModal() {
  const { activeCall, sendSignal, subscribe, endCall } = useCall();
  const { t } = useLanguage();
  const { user } = useAuth();
  const [localStream, setLocalStream] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState({}); // user_id -> MediaStream
  const [names, setNames] = useState({}); // user_id -> full_name
  const [muted, setMuted] = useState(false);
  const [cameraOff, setCameraOff] = useState(false);
  const [connecting, setConnecting] = useState(true);
  const [minimized, setMinimized] = useState(false);
  const [durationSec, setDurationSec] = useState(0);

  const peersRef = useRef({}); // user_id -> RTCPeerConnection
  const iceServersRef = useRef([{ urls: ['stun:stun.l.google.com:19302'] }]);
  const localStreamRef = useRef(null);
  const localVideoRef = useRef(null);

  const isVideo = activeCall?.call_type === 'video';

  const createPeerConnection = useCallback((peerId, isInitiator) => {
    if (peersRef.current[peerId]) return peersRef.current[peerId];
    const pc = new RTCPeerConnection({ iceServers: iceServersRef.current });
    localStreamRef.current?.getTracks().forEach((track) => pc.addTrack(track, localStreamRef.current));

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        sendSignal({ type: 'ice-candidate', to: peerId, call_id: activeCall.call_id, candidate: e.candidate });
      }
    };
    pc.ontrack = (e) => {
      setRemoteStreams((prev) => ({ ...prev, [peerId]: e.streams[0] }));
      setConnecting(false);
    };
    pc.onconnectionstatechange = () => {
      if (['closed', 'failed', 'disconnected'].includes(pc.connectionState)) {
        setRemoteStreams((prev) => {
          const next = { ...prev };
          delete next[peerId];
          return next;
        });
      }
    };

    peersRef.current[peerId] = pc;

    if (isInitiator) {
      pc.createOffer().then(async (offer) => {
        await pc.setLocalDescription(offer);
        sendSignal({ type: 'offer', to: peerId, call_id: activeCall.call_id, sdp: offer });
      });
    }
    return pc;
  }, [activeCall, sendSignal]);

  // Local media + names + ICE servers, once per call.
  useEffect(() => {
    if (!activeCall) return;
    let cancelled = false;
    setMinimized(false);
    setDurationSec(0);
    const timer = setInterval(() => setDurationSec((s) => s + 1), 1000);

    (async () => {
      try {
        const ice = await apiGet('/calls/ice-servers');
        if (!cancelled) iceServersRef.current = ice.ice_servers;
      } catch (_) { /* falls back to public STUN only */ }

      try {
        const call = await apiGet(`/calls/${activeCall.call_id}`);
        if (!cancelled) {
          const map = {};
          call.participants.forEach((p) => { map[p.user_id] = p.full_name; });
          setNames(map);
        }
      } catch (_) { /* names are cosmetic, non-fatal */ }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: isVideo, audio: true });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        localStreamRef.current = stream;
        setLocalStream(stream);
        sendSignal({ type: 'join', call_id: activeCall.call_id });

        // A system-level notification (shows in the Windows action center,
        // next to the clock) so a minimized/backgrounded call is still
        // visible without keeping the tab in view.
        if ('Notification' in window && Notification.permission === 'granted') {
          new Notification('Call in progress', {
            body: activeCall.call_type === 'video' ? 'Video call connected' : 'Voice call connected',
            tag: 'active-call', silent: true,
          });
        }
      } catch (err) {
        alert(t('call.mediaFail') + err.message);
        endCall();
      }
    })();

    return () => {
      cancelled = true;
      clearInterval(timer);
      Object.values(peersRef.current).forEach((pc) => pc.close());
      peersRef.current = {};
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      setRemoteStreams({});
      document.title = BASE_TITLE;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCall?.call_id]);

  // Keep the browser tab's title showing call duration — visible in the
  // taskbar/alt-tab preview even when this tab isn't focused, same spirit
  // as the minimize button: the call stays visible without staying in the way.
  useEffect(() => {
    if (!activeCall) return;
    const mins = String(Math.floor(durationSec / 60)).padStart(2, '0');
    const secs = String(durationSec % 60).padStart(2, '0');
    document.title = `📞 ${mins}:${secs} — ${BASE_TITLE}`;
    return () => { document.title = BASE_TITLE; };
  }, [activeCall, durationSec]);

  // Signaling relay messages.
  useEffect(() => {
    if (!activeCall) return;
    return subscribe(async (data) => {
      if (data.call_id !== activeCall.call_id) return;

      if (data.type === 'existing-peers') {
        data.user_ids.forEach((id) => createPeerConnection(id, false));
      } else if (data.type === 'peer-joined') {
        createPeerConnection(data.user_id, true);
      } else if (data.type === 'offer') {
        const pc = createPeerConnection(data.from, false);
        await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        sendSignal({ type: 'answer', to: data.from, call_id: activeCall.call_id, sdp: answer });
      } else if (data.type === 'answer') {
        await peersRef.current[data.from]?.setRemoteDescription(new RTCSessionDescription(data.sdp));
      } else if (data.type === 'ice-candidate') {
        try { await peersRef.current[data.from]?.addIceCandidate(data.candidate); } catch (_) { /* benign race */ }
      } else if (data.type === 'peer-left') {
        peersRef.current[data.user_id]?.close();
        delete peersRef.current[data.user_id];
        setRemoteStreams((prev) => {
          const next = { ...prev };
          delete next[data.user_id];
          return next;
        });
      } else if (data.type === 'call-declined') {
        // DM: the only other person said no — nobody else is coming, so
        // end it now instead of leaving "Connecting..." on screen forever.
        // Group: other invitees may still join, so just note it happened.
        if (!data.is_group) endCall();
      }
    });
  }, [activeCall, subscribe, createPeerConnection, sendSignal, endCall]);

  useEffect(() => {
    if (localVideoRef.current && localStream) localVideoRef.current.srcObject = localStream;
  }, [localStream, minimized]);

  const toggleMute = () => {
    localStreamRef.current?.getAudioTracks().forEach((t) => { t.enabled = muted; });
    setMuted((m) => !m);
  };
  const toggleCamera = () => {
    localStreamRef.current?.getVideoTracks().forEach((t) => { t.enabled = cameraOff; });
    setCameraOff((c) => !c);
  };

  if (!activeCall) return null;
  const remoteIds = Object.keys(remoteStreams);
  const mm = String(Math.floor(durationSec / 60)).padStart(2, '0');
  const ss = String(durationSec % 60).padStart(2, '0');

  // Minimizing only changes CSS visibility, never unmounts the video/audio
  // elements below — if it unmounted them, the call's audio would cut out
  // the moment you minimized it. The mini bar renders on top instead.
  return (
    <>
      {minimized && (
        <div style={miniBarStyle}>
          {isVideo && <video autoPlay muted playsInline style={miniVideoStyle} ref={(el) => { if (el && localStream) el.srcObject = localStream; }} />}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <div style={{ color: '#f3ecd8', fontSize: 12.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {remoteIds.length + 1} in call
            </div>
            <div style={{ color: '#b8ae94', fontSize: 11 }}>{mm}:{ss}</div>
          </div>
          <button onClick={() => setMinimized(false)} style={miniBtnStyle} title={t('call.expand')}>
            <IconMaximize size={16} />
          </button>
          <button onClick={endCall} style={{ ...miniBtnStyle, background: '#d13c3c', color: '#fff' }} title={t('call.end')}>
            <IconPhoneOff size={16} />
          </button>
        </div>
      )}

      <div style={minimized ? hiddenOverlayStyle : overlayStyle}>
        <div style={{ position: 'absolute', top: 16, right: 16 }}>
          <button onClick={() => setMinimized(true)} style={ctrlBtnStyle(true)} title={t('call.minimize')}>
            <IconMinimize size={18} />
          </button>
        </div>
        <div style={{ color: '#f3ecd8', fontSize: 13, marginBottom: 10, opacity: 0.8 }}>
          {connecting && remoteIds.length === 0 ? 'Connecting…' : `${remoteIds.length + 1} in call · ${mm}:${ss}`}
        </div>

        <div style={gridStyle(remoteIds.length + 1)}>
          {isVideo && (
            <div style={tileStyle}>
              <video ref={localVideoRef} autoPlay muted playsInline style={videoStyle} />
              <div style={labelStyle}>You{cameraOff ? ' (camera off)' : ''}</div>
            </div>
          )}
          {remoteIds.map((id) => (
            <RemoteTile key={id} stream={remoteStreams[id]} name={names[id] || 'Participant'} isVideo={isVideo} />
          ))}
          {!isVideo && (
            <div style={{ color: '#b8ae94', fontSize: 14 }}>
              Audio call — {remoteIds.map((id) => names[id] || 'Participant').join(', ') || 'ringing…'}
            </div>
          )}
        </div>

        <div style={controlsStyle}>
          <button onClick={toggleMute} style={ctrlBtnStyle(muted)} title={muted ? 'Unmute' : 'Mute'}>
            {muted ? <IconMicOff size={20} /> : <IconMic size={20} />}
          </button>
          {isVideo && (
            <button onClick={toggleCamera} style={ctrlBtnStyle(cameraOff)} title={cameraOff ? 'Camera on' : 'Camera off'}>
              {cameraOff ? <IconVideoOff size={20} /> : <IconVideo size={20} />}
            </button>
          )}
          <button onClick={endCall} style={{ ...ctrlBtnStyle(false), background: '#d13c3c' }} title={t('call.end')}>
            <IconPhoneOff size={20} />
          </button>
        </div>
      </div>
    </>
  );
}

function RemoteTile({ stream, name, isVideo }) {
  const ref = useRef(null);
  useEffect(() => { if (ref.current) ref.current.srcObject = stream; }, [stream]);
  return (
    <div style={tileStyle}>
      {isVideo ? <video ref={ref} autoPlay playsInline style={videoStyle} /> : <audio ref={ref} autoPlay />}
      <div style={labelStyle}>{name}</div>
    </div>
  );
}

const overlayStyle = {
  position: 'fixed', inset: 0, zIndex: 999998, background: 'rgba(4,6,13,.92)',
  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20,
};
// Same element as overlayStyle, but visually and interactively out of the
// way — kept mounted (not unmounted) so the video/audio inside keeps
// playing while minimized.
const hiddenOverlayStyle = {
  ...overlayStyle,
  position: 'fixed', top: 0, left: 0, width: 1, height: 1, overflow: 'hidden',
  opacity: 0, pointerEvents: 'none',
};
const miniBarStyle = {
  position: 'fixed', bottom: 20, right: 20, zIndex: 999999,
  background: '#151928', border: '1px solid rgba(212,175,55,.4)', borderRadius: 12,
  padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 10,
  boxShadow: '0 4px 20px rgba(0,0,0,.5)', maxWidth: 260,
};
const miniVideoStyle = { width: 44, height: 44, borderRadius: 8, objectFit: 'cover', background: '#0a0c14', flexShrink: 0 };
const miniBtnStyle = {
  width: 32, height: 32, borderRadius: '50%', border: 'none', cursor: 'pointer', flexShrink: 0,
  background: '#3a3f52', color: '#f3ecd8', display: 'flex', alignItems: 'center', justifyContent: 'center',
};
const gridStyle = (count) => ({
  display: 'grid',
  gridTemplateColumns: `repeat(${Math.min(count, 3) || 1}, minmax(160px, 320px))`,
  gap: 12, maxWidth: '90vw', maxHeight: '70vh', overflow: 'auto',
});
const tileStyle = { position: 'relative', background: '#151928', borderRadius: 10, overflow: 'hidden', border: '1px solid rgba(212,175,55,.25)' };
const videoStyle = { width: '100%', aspectRatio: '4/3', objectFit: 'cover', display: 'block', background: '#0a0c14' };
const labelStyle = { position: 'absolute', bottom: 6, left: 8, color: '#f3ecd8', fontSize: 12, textShadow: '0 1px 3px rgba(0,0,0,.8)' };
const controlsStyle = { display: 'flex', gap: 14, marginTop: 22 };
const ctrlBtnStyle = (active) => ({
  width: 48, height: 48, borderRadius: '50%', border: 'none', cursor: 'pointer',
  background: active ? '#3a3f52' : '#d4af37', color: active ? '#f3ecd8' : '#151928',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
});
