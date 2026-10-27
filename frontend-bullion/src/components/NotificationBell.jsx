import { useEffect, useRef, useState } from 'react';
import { apiGet } from '../lib/api';
import { subscribeToActivityFeed, getActivityFeedBaseline } from '../lib/activityFeed';
import { useLanguage } from '../context/LanguageContext.jsx';

const LAST_SEEN_KEY = 'sg_notif_last_seen_id';

const CATEGORY_ICON = {
  sale: '💰', purchase_jewelry: '💍', purchase_scrap: '🔶',
  supplier_payment: '🏦', expense: '🧾', cash_adjustment: '➕',
  day_close: '🔒',
};

export default function NotificationBell() {
  const { t, tf, lang } = useLanguage();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);       // all recently-seen activity, newest first
  const [unreadCount, setUnreadCount] = useState(0);
  const lastSeenRef = useRef(null);              // the highest activity-log id the user has actually opened the bell to see
  const initializedRef = useRef(false);
  const wrapRef = useRef(null);

  // On first mount, if there's no stored "last seen" marker yet, baseline
  // it to whatever the latest activity already is — otherwise a brand new
  // browser session would show the entire historical log as "unread".
  useEffect(() => {
    async function init() {
      const stored = localStorage.getItem(LAST_SEEN_KEY);
      if (stored) {
        lastSeenRef.current = Number(stored);
        initializedRef.current = true;
        return;
      }
      try {
        const latestId = await getActivityFeedBaseline();
        lastSeenRef.current = latestId;
        localStorage.setItem(LAST_SEEN_KEY, String(latestId));
      } catch (_) {
        lastSeenRef.current = 0;
      }
      initializedRef.current = true;
    }
    init();
  }, []);

  useEffect(() => {
    // Subscribes to the shared poller in lib/activityFeed.js instead of
    // running its own setInterval — Dashboard.jsx subscribes to the exact
    // same feed, so this used to mean two independent network requests to
    // /activity-logs every 6s whenever Dashboard was open. Now there's
    // exactly one underlying poll no matter how many components care.
    const unsubscribe = subscribeToActivityFeed((fresh) => {
      setItems(prev => {
        const merged = [...fresh, ...prev];
        const seen = new Set();
        const deduped = merged.filter(i => (seen.has(i.id) ? false : (seen.add(i.id), true)));
        return deduped.slice(0, 100);
      });
      setUnreadCount(c => c + fresh.length);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    function onClickOutside(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  function toggleOpen() {
    setOpen(o => {
      const next = !o;
      if (next && items.length) {
        // Marking as read = remembering the newest id we've now displayed,
        // so the unread count only ever reflects genuinely new activity
        // that happened since the last time this was actually opened.
        const maxId = Math.max(...items.map(i => i.id));
        lastSeenRef.current = maxId;
        localStorage.setItem(LAST_SEEN_KEY, String(maxId));
        setUnreadCount(0);
      }
      return next;
    });
  }

  function describeItem(item) {
    const icon = CATEGORY_ICON[item.category] || '📋';
    const catLabel = t(`entry.${item.category === 'purchase_jewelry' ? 'purchaseJewelry' : item.category === 'purchase_scrap' ? 'purchaseScrap' : item.category === 'supplier_payment' ? 'supplierPayment' : item.category === 'cash_adjustment' ? 'addCash' : item.category}`) || item.category;
    if (item.action_type === 'day_close') {
      return { icon: '🔒', text: t('notif.dayClosed') };
    }
    const actionLabel = item.action_type === 'cancel' ? t('notif.canceled') : item.action_type === 'edit' ? t('notif.edited') : t('notif.created');
    return { icon, text: tf('notif.activityLine', { user: item.user_name || '—', action: actionLabel, category: catLabel, amount: (item.amount || 0).toLocaleString() }) };
  }

  return (
    <div className="notif-bell-wrap" ref={wrapRef}>
      <button className="notif-bell-btn" onClick={toggleOpen} aria-label={t('notif.title')}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {unreadCount > 0 && <span className="notif-bell-badge">{unreadCount > 99 ? '99+' : unreadCount}</span>}
      </button>
      {open && (
        <div className="notif-dropdown">
          <div className="notif-dropdown-title">{t('notif.title')}</div>
          {items.length === 0 && <div className="notif-empty">{t('notif.empty')}</div>}
          <div className="notif-list">
            {items.map(item => {
              const { icon, text } = describeItem(item);
              return (
                <div key={item.id} className="notif-item">
                  <span className="notif-item-icon">{icon}</span>
                  <div className="notif-item-body">
                    <div className="notif-item-text">{text}</div>
                    <div className="notif-item-time">{new Date(item.created_at || item.timestamp).toLocaleTimeString(lang === 'ar' ? 'ar-SA' : 'en-US')}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
