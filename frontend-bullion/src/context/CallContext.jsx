import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import { API_BASE, apiPost } from '../lib/api';
import { useAuth } from './AuthContext.jsx';

const CallContext = createContext(null);

// wss://api.swag.sa/api/calls/ws  (derived from API_BASE, whatever host/path it points at)
function wsUrl(token) {
  const httpBase = API_BASE.replace(/\/api\/?$/, '');
  const wsBase = httpBase.replace(/^http/, 'ws');
  return `${wsBase}/api/calls/ws?token=${encodeURIComponent(token)}`;
}

export function CallProvider({ children }) {
  const { user } = useAuth();
  const [incomingCall, setIncomingCall] = useState(null); // { call_id, call_type, from, from_name, group_id }
  const [activeCall, setActiveCall] = useState(null);     // { call_id, call_type, group_id, recipient_id, mode: 'outgoing'|'active' }
  const wsRef = useRef(null);
  const listenersRef = useRef(new Set()); // CallModal subscribes here for signaling events once a call is active
  const reconnectTimer = useRef(null);

  const connect = useCallback(() => {
    const token = localStorage.getItem('sg_token');
    if (!token || !user) return;
    const ws = new WebSocket(wsUrl(token));
    wsRef.current = ws;

    ws.onmessage = (event) => {
      let data;
      try { data = JSON.parse(event.data); } catch { return; }

      if (data.type === 'incoming-call') {
        setIncomingCall(data);
      } else if (data.type === 'peer-left' && incomingCall?.call_id === data.call_id) {
        // Caller hung up before we answered.
        setIncomingCall(null);
      } else {
        // Anything else (offer/answer/ice-candidate/peer-joined/existing-peers)
        // is only relevant once a call is actually active — CallModal
        // subscribes to these directly rather than this context knowing
        // anything about WebRTC.
        listenersRef.current.forEach((fn) => fn(data));
      }
    };

    ws.onclose = () => {
      wsRef.current = null;
      // Reconnect after a short delay so a brief network blip doesn't
      // permanently kill the ability to receive calls for the rest of
      // the session.
      reconnectTimer.current = setTimeout(connect, 3000);
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  useEffect(() => {
    if (user) connect();
    return () => {
      clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  const sendSignal = useCallback((message) => {
    wsRef.current?.readyState === WebSocket.OPEN && wsRef.current.send(JSON.stringify(message));
  }, []);

  const subscribe = useCallback((fn) => {
    listenersRef.current.add(fn);
    return () => listenersRef.current.delete(fn);
  }, []);

  const startCall = useCallback(async ({ recipientId, groupId, callType = 'video' }) => {
    const call = await apiPost('/calls', { recipient_id: recipientId, group_id: groupId, call_type: callType });
    setActiveCall({ call_id: call.id, call_type: call.call_type, group_id: groupId, recipient_id: recipientId, mode: 'outgoing' });
    return call;
  }, []);

  const acceptCall = useCallback(async () => {
    if (!incomingCall) return;
    const { call_id, call_type, from, group_id } = incomingCall;
    await apiPost(`/calls/${call_id}/respond`, { action: 'accept' });
    setActiveCall({ call_id, call_type, group_id, recipient_id: group_id ? null : from, mode: 'active' });
    setIncomingCall(null);
  }, [incomingCall]);

  const declineCall = useCallback(async () => {
    if (!incomingCall) return;
    await apiPost(`/calls/${incomingCall.call_id}/respond`, { action: 'decline' }).catch(() => {});
    setIncomingCall(null);
  }, [incomingCall]);

  const endCall = useCallback(async () => {
    if (activeCall) {
      await apiPost(`/calls/${activeCall.call_id}/end`, {}).catch(() => {});
    }
    setActiveCall(null);
  }, [activeCall]);

  return (
    <CallContext.Provider value={{
      incomingCall, activeCall, startCall, acceptCall, declineCall, endCall, sendSignal, subscribe,
    }}>
      {children}
    </CallContext.Provider>
  );
}

export function useCall() {
  return useContext(CallContext);
}
