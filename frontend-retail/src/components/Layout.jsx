import { OTHER_APP_ID, APPS_META } from '../lib/appConfig.js';
import { Suspense, useEffect, useRef, useState } from 'react';
import AppLoader from './AppLoader.jsx';
import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { useLanguage } from '../context/LanguageContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { apiGet, apiPost, apiDelete } from '../lib/api';
import ProfileModal from './ProfileModal.jsx';
import ShortcutsModal from './ShortcutsModal.jsx';
import WelcomeTour from './WelcomeTour.jsx';
import ForcePasswordModal from './ForcePasswordModal.jsx';
import ChatModal from './ChatModal.jsx';
import CallHistoryModal from './CallHistoryModal.jsx';
import WelcomeGreeting from './WelcomeGreeting.jsx';
import BroadcastModal from './BroadcastModal.jsx';
import CreateGroupModal from './CreateGroupModal.jsx';
import NotificationBell from './NotificationBell.jsx';
import { ImagesBadge } from './ui/images-badge.tsx';
import { IconMegaphone, IconHome, IconPlusCircle, IconList, IconMenu, IconPhone } from './Icons.jsx';

// Users have no profile photo — this builds a small gold-gradient circle
// with their initial as a data-URI SVG "image", so ImagesBadge (which
// only knows how to render <img src>) can show them without needing a
// real photo or an external avatar service.
function initialAvatarSrc(name) {
  const letter = (name || '?')[0]?.toUpperCase() || '?';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#D4AA30"/><stop offset="100%" stop-color="#AF8C28"/></linearGradient></defs><rect width="64" height="64" rx="14" fill="url(#g)"/><text x="32" y="42" font-family="Inter, sans-serif" font-size="26" font-weight="700" fill="#1A1508" text-anchor="middle">${letter}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

// data-role from the original nav-item elements — kept as an array so a page
// can be shown to multiple roles ('supervisor', 'admin') or just one.
const NAV_ITEMS = [
  { section: 'nav.main', items: [
    { to: '/', key: 'nav.dashboard', end: true },
    { to: '/entry', key: 'nav.entry' },
    { to: '/history', key: 'nav.history', badge: 'history', permKey: 'page.history.view' },
  ]},
  { section: 'nav.reports_label', items: [
    { to: '/activity', key: 'nav.activity', badge: 'activity', permKey: 'page.activity.view' },
    { to: '/analytics', key: 'nav.analytics', permKey: 'page.analytics.view' },
    { to: '/reports', key: 'nav.reports', permKey: 'page.reports.view' },
    { to: '/day-history', key: 'nav.dayHistory', permKey: 'page.dayhistory.view' },
  ]},
  { section: 'nav.tools', items: [
    { to: '/contacts', key: 'nav.contacts', badge: 'contacts', permKey: 'page.contacts.view' },
    { to: '/cash-deposit', key: 'nav.cashDeposit', permKey: 'page.cashdeposit.view' },
    { to: '/shop-loans', key: 'nav.loans', permKey: 'page.loans.view' },
    { to: '/profit', key: 'nav.profit', permKey: 'page.profitcalc.view' },
    { to: '/external-sync', key: 'nav.externalSync', permKey: 'page.external_sync.view' },
  ]},
  { section: 'nav.system', items: [
    { to: '/settings', key: 'nav.settings', permKey: 'page.settings.view' },
    { to: '/users', key: 'nav.users', permKey: 'page.users.view' },
  ]},
];

// Re-plays a small pop whenever the number it shows changes (ported from
// Swag Maintenance's `bump` counter animation).
function BumpNum({ value }) {
  const prev = useRef(value);
  const [bump, setBump] = useState(false);
  useEffect(() => {
    if (prev.current !== value) {
      prev.current = value;
      setBump(true);
      const id = setTimeout(() => setBump(false), 520);
      return () => clearTimeout(id);
    }
  }, [value]);
  return <span className={bump ? 'bump' : undefined}>{value}</span>;
}

export default function Layout() {
  const { user, logout, can, switchApp } = useAuth();
  const [switching, setSwitching] = useState(false);
  const [showWelcome, setShowWelcome] = useState(() => {
    if (sessionStorage.getItem('sg_just_logged_in') === '1') {
      sessionStorage.removeItem('sg_just_logged_in');
      return true;
    }
    return false;
  });
  const { theme, setTheme, toggleTheme } = useTheme();
  const { lang, toggleLang, t, tf, tx } = useLanguage();
  const { showToast } = useToast();
  const [showProfile, setShowProfile] = useState(false);
  const [chatWith, setChatWith] = useState(null);
  const [showCallHistory, setShowCallHistory] = useState(false);
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [groups, setGroups] = useState([]);
  const [showGroupCreate, setShowGroupCreate] = useState(false);
  const [pendingGroupDelete, setPendingGroupDelete] = useState(null);
  const [deletingGroup, setDeletingGroup] = useState(false);
  const chatWithRef = useRef(null);
  useEffect(() => { chatWithRef.current = chatWith; }, [chatWith]);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem('sg_sidebar_collapsed') === '1');
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  useEffect(() => {
    localStorage.setItem('sg_sidebar_collapsed', collapsed ? '1' : '0');
  }, [collapsed]);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showTour, setShowTour] = useState(() => !localStorage.getItem('sg_tour_seen'));
  const [counts, setCounts] = useState({ history: 0, activity: 0, contacts: 0 });
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [unreadCounts, setUnreadCounts] = useState({});
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    function onKeyDown(e) {
      const tag = document.activeElement?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === 'Escape') { setShowProfile(false); setShowShortcuts(false); return; }
      if (e.key === '?') { setShowShortcuts(true); return; }
      if (e.key === 'n' || e.key === 'N') { navigate('/entry'); return; }
      if (e.key === 'd' || e.key === 'D') { navigate('/'); return; }
      if (e.key === 'a' || e.key === 'A') { navigate('/activity'); return; }
      if (e.key === '/') { e.preventDefault(); navigate('/history'); return; }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [navigate]);

  // Nav badge counts (History/Activity/Contacts totals) — refetched every
  // time the route changes (so deleting an invoice and navigating back
  // updates the number right away) and on a slow background interval as a
  // fallback, since the old one-time-on-mount fetch never updated after
  // that, leaving a stale count in the sidebar all session long.
  useEffect(() => {
    let cancelled = false;
    function refreshCounts() {
      // Previously 3 separate requests every 20s (/invoices/count,
      // /activity-logs/count, /contacts/count) — now one aggregated call.
      apiGet('/dashboard/badge-counts').then((d) => {
        if (cancelled) return;
        setCounts({
          history: d?.invoices || 0,
          activity: d?.activity_logs || 0,
          contacts: d?.contacts || 0,
        });
      }).catch(() => {});
    }
    refreshCounts();
    const interval = setInterval(refreshCounts, 20000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // "Who's online" — a lightweight heartbeat tells the backend this tab is
  // active, and a matching poll fetches everyone else's presence. 30s is
  // frequent enough to feel live without hammering the server.
  useEffect(() => {
    let cancelled = false;
    async function ping() {
      try {
        await apiPost('/auth/heartbeat', {});
        const list = await apiGet('/auth/online');
        if (!cancelled) setOnlineUsers(Array.isArray(list) ? list : []);
      } catch (_) {
        // presence is a nice-to-have — a failed ping shouldn't disrupt anything
      }
    }
    ping();
    const interval = setInterval(ping, 30000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  // New-message notifications — polls every few seconds and compares each
  // conversation's unread count to the last poll. Any increase means a
  // message arrived since then, so pop a toast naming who sent it (skipped
  // entirely while that conversation is already open, since you're already
  // looking at it).
  const prevUnreadRef = useRef({});

  // Ask for notification permission once, quietly — most browsers show
  // their own native prompt, so this just needs to trigger it (guarded so
  // we don't re-ask every time if the person already answered once).
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  function sendBrowserNotification(fromName, preview, onClickAction) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      const n = new Notification(fromName, {
        body: (preview || '').slice(0, 100),
        icon: import.meta.env.BASE_URL + 'logo.png',
        tag: 'swaggold-chat', // replaces any previous notification instead of stacking
      });
      n.onclick = () => {
        onClickAction?.();
        n.close();
      };
    } catch (_) {
      // Notification construction can fail on some platforms (e.g. iOS
      // Safari) — messaging itself still works fine without it.
    }
  }
  useEffect(() => {
    let cancelled = false;
    async function checkNewMessages() {
      try {
        const convos = await apiGet('/messages/conversations');
        if (cancelled || !Array.isArray(convos)) return;
        convos.forEach(c => {
          const prev = prevUnreadRef.current[c.user_id] || 0;
          const isOpenWithThisPerson = chatWithRef.current?.id === c.user_id;
          if (c.unread_count > prev && !isOpenWithThisPerson) {
            showToast(tf('chat.newMessageToast', { name: c.full_name, preview: (c.last_message || '').slice(0, 40) }), 'info', {
              action: {
                label: t('chat.open'),
                onClick: () => setChatWith({ id: c.user_id, full_name: c.full_name, username: c.username }),
              },
              duration: 6000,
            });
            // Browser/desktop notification — fires only when this tab isn't
            // the one the person is actually looking at (background tab,
            // minimized window, different app entirely), since the in-app
            // toast above already covers the "actively using it" case.
            if (document.hidden || !document.hasFocus()) {
              sendBrowserNotification(c.full_name, c.last_message, () => {
                window.focus();
                setChatWith({ id: c.user_id, full_name: c.full_name, username: c.username });
              });
            }
          }
        });
        const nextMap = {};
        convos.forEach(c => { nextMap[c.user_id] = c.unread_count; });
        prevUnreadRef.current = nextMap;
        setUnreadCounts(nextMap);
      } catch (_) {
        // messaging notifications are non-critical — fail silently
      }
    }
    checkNewMessages();
    const interval = setInterval(checkNewMessages, 6000);
    return () => { cancelled = true; clearInterval(interval); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const prevGroupUnreadRef = useRef({});
  useEffect(() => {
    let cancelled = false;
    function loadGroups() {
      apiGet('/messages/groups').then(data => {
        if (cancelled || !Array.isArray(data)) return;
        setGroups(data);
        data.forEach(g => {
          const prev = prevGroupUnreadRef.current[g.id] || 0;
          const isOpenWithThisGroup = chatWithRef.current?.isGroup && chatWithRef.current?.id === g.id;
          if (g.unread_count > prev && !isOpenWithThisGroup && (document.hidden || !document.hasFocus())) {
            sendBrowserNotification(g.name, g.last_message, () => {
              window.focus();
              setChatWith({ ...g, isGroup: true });
            });
          }
        });
        const nextMap = {};
        data.forEach(g => { nextMap[g.id] = g.unread_count; });
        prevGroupUnreadRef.current = nextMap;
      }).catch(() => {});
    }
    loadGroups();
    const interval = setInterval(loadGroups, 15000);
    return () => { cancelled = true; clearInterval(interval); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function confirmDeleteGroup() {
    if (!pendingGroupDelete) return;
    setDeletingGroup(true);
    try {
      await apiDelete(`/messages/groups/${pendingGroupDelete.id}`);
      setGroups(prev => prev.filter(g => g.id !== pendingGroupDelete.id));
      if (chatWith?.isGroup && chatWith?.id === pendingGroupDelete.id) setChatWith(null);
      setPendingGroupDelete(null);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      setDeletingGroup(false);
    }
  }

  const canSee = (item) => !item.permKey || can(item.permKey);

  return (
    <div id="app">
      <div className="notif-bell-fixed">
        <NotificationBell />
      </div>
      <div className="shell">
        {/* Compact top bar — mobile only. The full sidebar becomes an
            off-canvas drawer on small screens instead of stacking
            everything (nav + announce + profile + settings) above the
            page content, which forced a long scroll before reaching
            anything useful. */}
        <div className="mobile-topbar">
          <button className="mobile-hamburger" onClick={() => setMobileNavOpen(true)} aria-label={t('sidebar.expand')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div className="mobile-topbar-brand">
            <img src={import.meta.env.BASE_URL + 'logo.png'} alt="Swag Gold" style={{ width: 22, height: 22, objectFit: 'contain' }} onError={(e) => { e.target.style.display = 'none'; }} />
            <span>{t('brand.name')}</span>
          </div>
          <div style={{ width: 36, display: 'flex', justifyContent: 'flex-end' }} className="mobile-topbar-bell">
            <NotificationBell />
          </div>
        </div>
        {mobileNavOpen && (
          <div className="mobile-nav-backdrop" onClick={() => setMobileNavOpen(false)} />
        )}
        {/* Bottom tab bar — mobile only. The hamburger drawer covers every
            page, but the 3 most-used destinations (plus a Menu shortcut for
            everything else — chat, groups, settings) deserve one-tap access
            instead of opening the drawer every single time. */}
        <nav className="mobile-tabbar">
          <NavLink to="/" end className={({ isActive }) => 'mobile-tab' + (isActive ? ' active' : '')} onClick={() => setMobileNavOpen(false)}>
            <IconHome size={20} />
            <span>{t('nav.dashboard')}</span>
          </NavLink>
          <NavLink to="/entry" className={({ isActive }) => 'mobile-tab' + (isActive ? ' active' : '')} onClick={() => { setMobileNavOpen(false); window.dispatchEvent(new Event('sg:reset-entry')); }}>
            <IconPlusCircle size={20} />
            <span>{t('nav.entry')}</span>
          </NavLink>
          <NavLink to="/history" className={({ isActive }) => 'mobile-tab' + (isActive ? ' active' : '')} onClick={() => setMobileNavOpen(false)}>
            <IconList size={20} />
            {counts.history > 0 && <span className="mobile-tab-badge">{counts.history > 99 ? '99+' : counts.history}</span>}
            <span>{t('nav.history')}</span>
          </NavLink>
          <button className="mobile-tab" onClick={() => setMobileNavOpen(true)}>
            <IconMenu size={20} />
            {Object.values(unreadCounts).some(c => c > 0) && <span className="mobile-tab-badge">•</span>}
            <span>{t('nav.menu')}</span>
          </button>
          {/* Limelight — a soft glowing bar that slides to sit above
              whichever tab is active, with a light-cone gradient beneath
              it. Positioned by percentage since all 4 tabs are equal-width
              flex items, so no ref-measuring is needed. */}
          <div
            className="mobile-tabbar-limelight"
            style={{
              insetInlineStart: `${(
                location.pathname === '/entry' ? 1
                : location.pathname.startsWith('/history') ? 2
                : mobileNavOpen ? 3
                : 0
              ) * 25}%`,
            }}
          />
        </nav>
        <button
          className="sidebar-toggle-btn"
          onClick={() => setCollapsed(c => !c)}
          title={collapsed ? t('sidebar.expand') : t('sidebar.collapse')}
          aria-label={collapsed ? t('sidebar.expand') : t('sidebar.collapse')}
          style={{ [lang === 'ar' ? 'right' : 'left']: collapsed ? 8 : 222 }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: (collapsed !== (lang === 'ar')) ? 'rotate(180deg)' : 'none', transition: 'transform .25s ease' }}>
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
        <aside className={`sidebar${collapsed ? ' sidebar-collapsed' : ''}${mobileNavOpen ? ' mobile-nav-open' : ''}`}>
          <button className="mobile-nav-close" onClick={() => setMobileNavOpen(false)} aria-label={t('common.cancel')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
          <div className="brand">
            <div className="brand-gem">
              <img src={import.meta.env.BASE_URL + 'logo.png'} alt="Swag Gold" style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: 5 }} onError={(e) => { e.target.style.display = 'none'; e.target.parentNode.textContent = '◆'; }} />
            </div>
            <div className="brand-mark">{t('brand.name')}</div>
            <div className="brand-sub">{t('brand.sub')}</div>
          </div>

          <div className="nav-scroll-area">
            <nav className="nav">
              {NAV_ITEMS.map(group => (
                <div key={group.section}>
                <div className="nav-label">{t(group.section)}</div>
                {group.items.filter(canSee).map(item => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.end}
                    onClick={() => {
                      setMobileNavOpen(false);
                      // Clicking "New Entry" while already on that page (mid
                      // category form) previously did nothing — React Router
                      // doesn't remount on a same-path navigation. This event
                      // lets Entry.jsx reset back to the tile launcher.
                      if (item.to === '/entry') window.dispatchEvent(new Event('sg:reset-entry'));
                    }}
                    className={({ isActive }) => 'nav-item' + (isActive ? ' active' : '')}
                  >
                    <span className="nav-left">
                      <span>{t(item.key)}</span>
                    </span>
                    {item.badge && <span className="nav-badge"><BumpNum value={counts[item.badge]} /></span>}
                  </NavLink>
                ))}
              </div>
            ))}
          </nav>
          </div>

          <div className="sidebar-foot">
            {onlineUsers.length > 0 && (
              <div className="sb-online" style={{ marginBottom: 10, paddingBottom: 10, borderBottom: '1px solid var(--line)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '0 8px', marginBottom: 8 }}>
                  <span className="presence-dot"></span>
                  <span style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--cream-faint)', fontWeight: 600 }}>
                    <BumpNum value={onlineUsers.length} /> {t('presence.online')}
                  </span>
                </div>
                <div style={{ padding: '2px 8px 8px' }}>
                  <ImagesBadge
                    images={onlineUsers.slice(0, 6).map(u => ({
                      src: initialAvatarSrc(u.full_name || u.username),
                      alt: u.id === user?.id ? t('presence.you') : (u.full_name || u.username),
                    }))}
                    maxVisible={3}
                    revealCount={3}
                    size="sm"
                    shape="rounded"
                    onImageClick={(i) => {
                      const u = onlineUsers[i];
                      if (!u || u.id === user?.id) return;
                      setChatWith(u);
                      setUnreadCounts(m => ({ ...m, [u.id]: 0 }));
                      setMobileNavOpen(false);
                    }}
                  />
                </div>
              </div>
            )}
            <div className="sb-groups" style={{ marginBottom: 8, paddingBottom: 6, borderBottom: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 8px', marginBottom: groups.length ? 6 : 0 }}>
                <span style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--cream-faint)', fontWeight: 600 }}>
                  {t('chat.groups')}
                </span>
                <button
                  onClick={() => setShowGroupCreate(true)}
                  style={{ background: 'none', border: 'none', color: 'var(--gold-21)', fontSize: 18, cursor: 'pointer', lineHeight: 1, padding: '0 4px' }}
                  title={t('chat.newGroup')}
                >+</button>
              </div>
              {groups.length === 0 ? null : (
                groups.slice(0, 5).map(g => (
                  <div
                    key={g.id}
                    className="group-row"
                    onClick={() => { setChatWith({ ...g, isGroup: true }); setMobileNavOpen(false); }}
                    style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', borderRadius: 8, cursor: 'pointer', fontSize: 13 }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-3)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <IconMegaphone size={13} />
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{g.name}</span>
                    {g.unread_count > 0 && (
                      <span style={{ background: 'var(--red)', color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 999, minWidth: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px' }}>
                        {g.unread_count > 9 ? '9+' : g.unread_count}
                      </span>
                    )}
                    {(g.created_by === user?.id || user?.role === 'admin') && (
                      <button
                        className="group-delete-btn"
                        onClick={e => { e.stopPropagation(); setPendingGroupDelete(g); }}
                        title={t('chat.deleteGroup')}
                        style={{ background: 'none', border: 'none', color: 'var(--cream-faint)', fontSize: 15, cursor: 'pointer', lineHeight: 1, padding: '0 2px', flexShrink: 0 }}
                      >×</button>
                    )}
                  </div>
                ))
              )}
            </div>
            <div className="user-row" onClick={() => setShowProfile(true)} style={{ cursor: 'pointer' }} title={t('profile.edit')}>
              <div className="user-avatar">
                {user?.avatar
                  ? <img src={user.avatar} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
                  : (user?.name || user?.username || '?')[0]?.toUpperCase()}
              </div>
              <div className="user-info">
                <div className="user-name">{user?.name || user?.username}</div>
                <div className="user-role">{tx(`role.${user?.role}`, user?.role)}</div>
              </div>
            </div>
            {user?.apps?.includes(OTHER_APP_ID) && (
              <button
                className="sidebar-btn"
                style={{ width: '100%', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, borderColor: 'var(--gold, #d4af37)' }}
                disabled={switching}
                onClick={async () => {
                  setSwitching(true);
                  try { await switchApp(OTHER_APP_ID); }
                  catch (e) { setSwitching(false); showToast(e.message || t('app.switchFail'), 'error'); }
                }}
              >
                <span aria-hidden="true">⇄</span>
                {switching ? t('app.switching') : tf('app.switchTo', { app: lang === 'ar' ? APPS_META[OTHER_APP_ID].nameAr : APPS_META[OTHER_APP_ID].name })}
              </button>
            )}
            <div className="sidebar-actions sidebar-icon-row">
              <button className="sidebar-btn sidebar-btn-icon" onClick={() => { setShowCallHistory(true); setMobileNavOpen(false); }} title={t('misc.callHistory')} aria-label={t('misc.callHistory')}>
                <IconPhone size={15} />
              </button>
              {user?.role === 'admin' && (
                <button className="sidebar-btn sidebar-btn-icon" onClick={() => { setShowBroadcast(true); setMobileNavOpen(false); }} title={t('chat.broadcastButton')} aria-label={t('chat.broadcastButton')}>
                  <IconMegaphone size={15} />
                </button>
              )}
              <button className="sidebar-btn sidebar-btn-icon" onClick={() => setShowShortcuts(true)} title={t('sidebar.shortcuts')} aria-label={t('sidebar.shortcuts')}>?</button>
              <button className="sidebar-btn" style={{ flex: 2 }} onClick={logout}>{t('sidebar.signout')}</button>
            </div>
            <div className="app-dock" role="group" aria-label={t('dock.quickActions')}>
              <button
                className={'app-dock-btn' + (theme === 'light' ? ' active' : '')}
                onClick={() => setTheme('light')}
                aria-label={t('dock.light')} title={t('dock.light')}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
                </svg>
                <span>{t('dock.light')}</span>
              </button>
              <button
                className={'app-dock-btn' + (theme === 'dark' ? ' active' : '')}
                onClick={() => setTheme('dark')}
                aria-label={t('dock.dark')} title={t('dock.dark')}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                </svg>
                <span>{t('dock.dark')}</span>
              </button>
              <button className="app-dock-btn" onClick={() => navigate('/settings')} aria-label={t('dock.settings')} title={t('dock.settings')}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
                <span>{t('dock.settings')}</span>
              </button>
            </div>
            <div className="theme-toggle" style={{ marginTop: 6 }}>
              <span style={{ fontSize: 12.5, color: 'var(--cream-faint)' }}>Language / اللغة</span>
              <button
                onClick={toggleLang}
                style={{
                  background: 'var(--surface-2)', border: '1.5px solid var(--gold-21)', color: 'var(--gold-24)',
                  padding: '3px 12px', borderRadius: 20, fontSize: 13, fontWeight: 700, cursor: 'pointer',
                  fontFamily: "'IBM Plex Mono',monospace", letterSpacing: '.04em',
                }}
              >
                {lang === 'en' ? 'عربي' : 'English'}
              </button>
            </div>
          </div>
        </aside>

        <main className="main">
          {/* Suspense lives HERE (not above Layout) so a lazy page loading
              only swaps the content area — sidebar stays put, no flicker. */}
          <Suspense fallback={<AppLoader />}>
            <Outlet />
          </Suspense>
        </main>
      </div>
      {showProfile && <ProfileModal onClose={() => setShowProfile(false)} />}
      {showShortcuts && <ShortcutsModal onClose={() => setShowShortcuts(false)} />}
      {chatWith && <ChatModal recipient={chatWith.isGroup ? null : chatWith} group={chatWith.isGroup ? chatWith : null} currentUserId={user?.id} onClose={() => setChatWith(null)} />}
      {showCallHistory && <CallHistoryModal currentUserId={user?.id} onClose={() => setShowCallHistory(false)} />}
      {showGroupCreate && <CreateGroupModal onClose={() => setShowGroupCreate(false)} onCreated={(g) => { setShowGroupCreate(false); setGroups(gs => [g, ...gs]); }} />}

      {pendingGroupDelete && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(4,6,13,.6)', padding: '24px 16px' }}
          onClick={e => { if (e.target === e.currentTarget) setPendingGroupDelete(null); }}
        >
          <div className="panel" style={{ width: 380, maxWidth: '92vw' }}>
            <div className="panel-title">{t('chat.deleteGroupTitle')}</div>
            <p style={{ color: 'var(--cream-dim)', fontSize: 14, margin: '12px 0 20px' }}>
              {tf('chat.deleteGroupWarn', { name: pendingGroupDelete.name })}
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn ghost" onClick={() => setPendingGroupDelete(null)} disabled={deletingGroup}>{t('common.cancel')}</button>
              <button className="btn gold" onClick={confirmDeleteGroup} disabled={deletingGroup} style={{ background: 'var(--red)', borderColor: 'var(--red)' }}>
                {deletingGroup ? '...' : t('common.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
      {showBroadcast && <BroadcastModal onClose={() => setShowBroadcast(false)} />}
      {showWelcome && <WelcomeGreeting name={user?.name || user?.username} />}
      {!user?.mustChangePassword && showTour && <WelcomeTour onClose={() => setShowTour(false)} />}
      {user?.mustChangePassword && <ForcePasswordModal />}
    </div>
  );
}
