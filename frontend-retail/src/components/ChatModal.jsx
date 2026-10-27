import { useState, useEffect, useRef } from 'react';
import { apiGet, apiPost, apiPut, apiDelete } from '../lib/api';
import { useLanguage } from '../context/LanguageContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { IconX, IconPaperclip, IconSend, IconMegaphone, IconPhone, IconVideo } from './Icons.jsx';
import { useCall } from '../context/CallContext.jsx';

const MAX_ATTACHMENT_BYTES = 1_500_000;
const EDIT_WINDOW_MS = 2 * 60 * 1000; // matches the backend's 2-minute grace period

// A docked side chat panel — works for both a 1-on-1 DM (pass `recipient`)
// and a group chat (pass `group`), so the whole message-list/input/typing
// machinery isn't duplicated between the two.
export default function ChatModal({ recipient, group, onClose, currentUserId }) {
  const { t, tf, lang } = useLanguage();
  const { showToast } = useToast();
  const { startCall } = useCall();
  const [messages, setMessages] = useState([]);
  const [body, setBody] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [pendingFile, setPendingFile] = useState(null);
  const [visible, setVisible] = useState(false);
  const [typingUserIds, setTypingUserIds] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [editBody, setEditBody] = useState('');
  const [now, setNow] = useState(Date.now()); // ticks so edit/delete windows expire live in the UI
  const listRef = useRef(null);
  const pollRef = useRef(null);
  const typingPollRef = useRef(null);
  const fileInputRef = useRef(null);
  const isRtl = lang === 'ar';
  const isGroup = !!group;
  const target = isGroup ? { group_id: group.id } : { recipient_id: recipient.id };
  const title = isGroup ? group.name : (recipient.full_name || recipient.username);

  async function load(silent) {
    if (!silent) setLoading(true);
    try {
      const data = isGroup
        ? await apiGet(`/messages/groups/${group.id}/messages`)
        : await apiGet(`/messages/${recipient.id}`);
      setMessages(data || []);
      if (!isGroup) apiPost(`/messages/${recipient.id}/read`, {}).catch(() => {});
    } catch (err) {
      if (!silent) showToast(err.message, 'error');
    } finally {
      if (!silent) setLoading(false);
    }
  }

  async function checkTyping() {
    try {
      const q = isGroup ? `group_id=${group.id}` : `recipient_id=${recipient.id}`;
      const data = await apiGet(`/messages/typing/status?${q}`);
      setTypingUserIds(data?.typing_user_ids || []);
    } catch (_) { /* non-critical */ }
  }

  useEffect(() => {
    load(false);
    pollRef.current = setInterval(() => load(true), 4000);
    typingPollRef.current = setInterval(checkTyping, 2000);
    const tick = setInterval(() => setNow(Date.now()), 10000);
    return () => { clearInterval(pollRef.current); clearInterval(typingPollRef.current); clearInterval(tick); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recipient?.id, group?.id]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages]);

  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prevOverflow; };
  }, []);

  useEffect(() => {
    const id = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(id);
  }, []);

  function handleClose() {
    setVisible(false);
    setTimeout(onClose, 220);
  }

  const lastTypingSentRef = useRef(0);
  function onInputChange(val) {
    setBody(val);
    const nowMs = Date.now();
    if (nowMs - lastTypingSentRef.current > 2000) {
      lastTypingSentRef.current = nowMs;
      apiPost('/messages/typing', target).catch(() => {});
    }
  }

  function processFile(file) {
    if (!file) return;
    if (file.size > MAX_ATTACHMENT_BYTES) {
      showToast(t('chat.attachmentTooLarge'), 'error');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setPendingFile({ dataUrl: reader.result, name: file.name });
    reader.readAsDataURL(file);
  }

  function handleFilePick(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    processFile(file);
  }

  const [dragOver, setDragOver] = useState(false);
  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    processFile(e.dataTransfer.files?.[0]);
  }

  async function send() {
    if ((!body.trim() && !pendingFile) || sending) return;
    setSending(true);
    const text = body.trim();
    const file = pendingFile;
    setBody('');
    setPendingFile(null);
    try {
      const msg = await apiPost('/messages', {
        ...target,
        body: text || null,
        attachment_data: file?.dataUrl || null,
        attachment_name: file?.name || null,
      });
      setMessages(m => [...m, msg]);
    } catch (err) {
      showToast(err.message, 'error');
      setBody(text);
      setPendingFile(file);
    } finally {
      setSending(false);
    }
  }

  function startEdit(m) {
    setEditingId(m.id);
    setEditBody(m.body || '');
  }

  async function saveEdit(id) {
    if (!editBody.trim()) return;
    try {
      const updated = await apiPut(`/messages/${id}`, { body: editBody.trim() });
      setMessages(ms => ms.map(m => m.id === id ? updated : m));
      setEditingId(null);
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  async function removeMessage(id) {
    try {
      await apiDelete(`/messages/${id}`);
      setMessages(ms => ms.map(m => m.id === id ? { ...m, is_deleted: true, body: null, attachment_data: null } : m));
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  const lastMyMessageId = [...messages].reverse().find(m => m.sender_id === currentUserId)?.id;
  const sideProp = isRtl ? 'left' : 'right';
  const typingLabel = typingUserIds.length > 0
    ? (isGroup ? t('chat.someoneTyping') : tf('chat.isTyping', { name: recipient.full_name || recipient.username }))
    : null;

  return (
    <>
      <div
        onClick={handleClose}
        style={{ position: 'fixed', inset: 0, zIndex: 250, background: visible ? 'rgba(0,0,0,.08)' : 'transparent', transition: 'background .2s ease' }}
      />
      <div
        style={{
          position: 'fixed', top: 0, bottom: 0, [sideProp]: 0,
          width: 380, maxWidth: '92vw', zIndex: 260,
          background: 'var(--surface)', borderInlineStart: '1px solid var(--line)',
          boxShadow: isRtl ? '10px 0 40px rgba(0,0,0,.35)' : '-10px 0 40px rgba(0,0,0,.35)',
          display: 'flex', flexDirection: 'column',
          transform: visible ? 'translateX(0)' : `translateX(${isRtl ? '-100%' : '100%'})`,
          transition: 'transform .28s cubic-bezier(.22,1,.36,1)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '18px', borderBottom: '1px solid var(--line)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div className="presence-avatar-stack" style={{ position: 'static' }}>
              {isGroup ? <IconMegaphone size={15} /> : (recipient.full_name || recipient.username || '?')[0]?.toUpperCase()}
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 14.5 }}>{title}</div>
              <div style={{ fontSize: 11.5, color: 'var(--cream-faint)' }}>
                {isGroup ? tf('chat.memberCount', { n: group.member_ids?.length || 0 }) : `@${recipient.username}`}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              className="btn ghost sm"
              title={t('call.voice')}
              onClick={() => startCall({ recipientId: isGroup ? null : recipient.id, groupId: isGroup ? group.id : null, callType: 'audio' })}
            >
              <IconPhone size={15} />
            </button>
            <button
              className="btn ghost sm"
              title={t('call.video')}
              onClick={() => startCall({ recipientId: isGroup ? null : recipient.id, groupId: isGroup ? group.id : null, callType: 'video' })}
            >
              <IconVideo size={15} />
            </button>
            <button className="btn ghost sm" onClick={handleClose}><IconX size={15} /></button>
          </div>
        </div>

        <div ref={listRef} style={{ flex: 1, overflowY: 'auto', overscrollBehavior: 'contain', padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
          {loading ? (
            <div style={{ color: 'var(--cream-faint)', fontSize: 13, textAlign: 'center', marginTop: 20 }}>{t('common.loading')}</div>
          ) : messages.length === 0 ? (
            <div style={{ color: 'var(--cream-faint)', fontSize: 13, textAlign: 'center', marginTop: 20 }}>{t('chat.noMessages')}</div>
          ) : (
            messages.map(m => {
              const isTheirs = m.sender_id !== currentUserId;
              const isImage = m.attachment_data?.startsWith('data:image');
              const canModify = !isTheirs && !m.is_deleted && (now - new Date(m.created_at).getTime()) < EDIT_WINDOW_MS;
              return (
                <div
                  key={m.id}
                  dir="auto"
                  style={{
                    alignSelf: isTheirs ? 'flex-start' : 'flex-end',
                    maxWidth: '78%',
                    background: m.is_broadcast ? 'rgba(212,170,48,.12)' : (isTheirs ? 'var(--surface-3)' : 'linear-gradient(135deg, var(--gold-21), var(--gold-18))'),
                    border: m.is_broadcast ? '1px solid rgba(212,170,48,.4)' : 'none',
                    color: m.is_broadcast ? 'var(--cream)' : (isTheirs ? 'var(--cream)' : '#1A1508'),
                    padding: '8px 13px', borderRadius: 14,
                    borderBottomLeftRadius: isTheirs ? 4 : 14,
                    borderBottomRightRadius: isTheirs ? 14 : 4,
                    fontSize: 15, lineHeight: 1.5, wordBreak: 'break-word',
                    position: 'relative',
                  }}
                >
                  {isGroup && isTheirs && (
                    <div style={{ fontSize: 11, fontWeight: 700, opacity: .75, marginBottom: 2 }}>{m.sender_name}</div>
                  )}
                  {m.is_broadcast && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, color: 'var(--gold-21)', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '.03em' }}>
                      <IconMegaphone size={12} /> {t('chat.announcementLabel')}
                    </div>
                  )}
                  {m.is_deleted ? (
                    <span style={{ fontStyle: 'italic', opacity: .6 }}>{t('chat.messageDeleted')}</span>
                  ) : editingId === m.id ? (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <input
                        dir="auto" autoFocus value={editBody}
                        onChange={e => setEditBody(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveEdit(m.id); if (e.key === 'Escape') setEditingId(null); }}
                        style={{ fontSize: 13, padding: '4px 8px', color: '#111' }}
                      />
                      <button className="btn ghost sm" onClick={() => saveEdit(m.id)} style={{ padding: '2px 8px' }}>✓</button>
                    </div>
                  ) : (
                    <>
                      {m.attachment_data && (
                        isImage ? (
                          <a href={m.attachment_data} download={m.attachment_name} target="_blank" rel="noreferrer">
                            <img src={m.attachment_data} alt={m.attachment_name || 'attachment'} style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 8, display: 'block', marginBottom: m.body ? 6 : 0 }} />
                          </a>
                        ) : (
                          <a href={m.attachment_data} download={m.attachment_name} style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'inherit', marginBottom: m.body ? 6 : 0, textDecoration: 'underline' }}>
                            <IconPaperclip size={13} /> {m.attachment_name || t('chat.attachment')}
                          </a>
                        )
                      )}
                      {m.body}
                    </>
                  )}
                  <div style={{ fontSize: 10, opacity: .6, marginTop: 3, textAlign: 'right', display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
                    {canModify && !m.is_deleted && editingId !== m.id && (
                      <>
                        <button onClick={() => startEdit(m)} style={{ background: 'none', border: 'none', color: 'inherit', opacity: .8, cursor: 'pointer', fontSize: 10, padding: 0, textDecoration: 'underline' }}>{t('common.edit')}</button>
                        <button onClick={() => removeMessage(m.id)} style={{ background: 'none', border: 'none', color: 'inherit', opacity: .8, cursor: 'pointer', fontSize: 10, padding: 0, textDecoration: 'underline' }}>{t('common.delete')}</button>
                      </>
                    )}
                    {m.edited_at && !m.is_deleted && <span>({t('chat.edited')})</span>}
                    <span>{new Date(m.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    {!isTheirs && !isGroup && m.id === lastMyMessageId && (
                      <span>· {m.is_read ? t('chat.seen') : t('chat.sent')}</span>
                    )}
                    {!isTheirs && isGroup && m.id === lastMyMessageId && (
                      <span>· {groupSeenByLabel(m, group)}</span>
                    )}
                  </div>
                </div>
              );
            })
          )}
          {typingLabel && (
            <div style={{ fontSize: 12, color: 'var(--cream-faint)', fontStyle: 'italic', alignSelf: 'flex-start' }}>{typingLabel}</div>
          )}
        </div>

        <div style={{ padding: 12 }}>
          {pendingFile && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', marginBottom: 8, background: 'var(--surface-3)', borderRadius: 10, fontSize: 12.5, color: 'var(--cream-dim)' }}>
              {pendingFile.dataUrl.startsWith('data:image')
                ? <img src={pendingFile.dataUrl} alt="" style={{ width: 32, height: 32, objectFit: 'cover', borderRadius: 6 }} />
                : <IconPaperclip size={16} />}
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{pendingFile.name}</span>
              <button className="btn ghost sm" onClick={() => setPendingFile(null)}><IconX size={13} /></button>
            </div>
          )}
          <div
            className={`chat-input-pill${dragOver ? ' drag-over' : ''}`}
            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={e => { e.preventDefault(); setDragOver(false); }}
            onDrop={handleDrop}
          >
            <input type="file" ref={fileInputRef} style={{ display: 'none' }} onChange={handleFilePick} accept="image/*,.pdf,.doc,.docx,.xlsx" />
            <button className="chat-icon-btn" onClick={() => fileInputRef.current?.click()} title={t('chat.attachFile')}>
              <IconPaperclip size={16} />
            </button>
            <input
              dir="auto"
              className="chat-pill-input"
              value={body}
              onChange={e => onInputChange(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={dragOver ? t('chat.dropFileHere') : t('chat.typePlaceholder')}
            />
            <button
              className="chat-icon-btn chat-send-btn"
              onClick={send}
              disabled={sending || (!body.trim() && !pendingFile)}
              title={t('chat.send')}
            >
              <IconSend size={15} />
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

// "Seen by Priya, Ahmed" (or "Sent" if nobody's read it yet) for the last
// message you sent in a group — read_by holds the user_ids who've opened
// the group chat since this message arrived (see MessageReadReceipt on
// the backend). Falls back to a count if names aren't loaded for some reason.
function groupSeenByLabel(message, group) {
  const readers = (message.read_by || []).filter((uid) => uid !== message.sender_id);
  if (readers.length === 0) return 'Sent';
  if (!group?.member_ids || !group?.member_names) return `Seen by ${readers.length}`;
  const names = readers
    .map((uid) => group.member_names[group.member_ids.indexOf(uid)])
    .filter(Boolean);
  return `Seen by ${names.length ? names.join(', ') : readers.length}`;
}
