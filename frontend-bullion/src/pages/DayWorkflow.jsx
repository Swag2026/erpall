import { useEffect, useMemo, useState } from 'react';
import { Calendar, TrendingUp, ShoppingBag, Receipt, Lock } from 'lucide-react';
import { apiGet } from '../lib/api';
import { useLanguage } from '../context/LanguageContext.jsx';
import { SkeletonPanel } from '../components/Skeleton.jsx';
import RadialOrbitalTimeline from '../components/ui/radial-orbital-timeline.tsx';
import { Typewriter } from '../components/ui/typewriter.tsx';
import { todayLocalStr } from '../lib/dateUtils';

// Same category rules Dashboard.jsx uses to bucket ledger entries.
const isSale = (e) => e.category === 'sale';
const isPurchase = (e) => e.category === 'purchase_jewelry' || e.category === 'purchase_scrap';
const isExpense = (e) => e.category === 'expense';

export default function DayWorkflow() {
  const { t, tf } = useLanguage();
  const [entries, setEntries] = useState([]);
  const [dayOpenings, setDayOpenings] = useState({});
  const [reconciliations, setReconciliations] = useState({});
  const [loading, setLoading] = useState(true);
  const today = todayLocalStr();

  useEffect(() => {
    Promise.all([
      apiGet('/invoices?limit=2000'),
      apiGet('/day-openings'),
      apiGet('/reconciliations'),
    ])
      .then(([invRes, openRes, reconRes]) => {
        setEntries(Array.isArray(invRes) ? invRes : invRes.items || []);
        const openMap = {};
        (openRes || []).forEach((row) => { openMap[row.opening_date] = row; });
        setDayOpenings(openMap);
        const reconMap = {};
        (reconRes || []).forEach((row) => { reconMap[row.reconciliation_date] = row; });
        setReconciliations(reconMap);
      })
      .finally(() => setLoading(false));
  }, []);

  const timelineData = useMemo(() => {
    const dayEntries = entries.filter((e) => e.invoice_date === today && e.status !== 'canceled');
    const sales = dayEntries.filter(isSale);
    const purchases = dayEntries.filter(isPurchase);
    const expenses = dayEntries.filter(isExpense);
    const opened = !!dayOpenings[today];
    const closed = !!reconciliations[today];

    // completed once that stage actually has activity, in-progress once the
    // day is open but this particular stage is still empty, pending if the
    // day hasn't even opened yet.
    const stageStatus = (hasActivity) => (hasActivity ? 'completed' : opened ? 'in-progress' : 'pending');

    return [
      {
        id: 1,
        title: t('wf.opening'),
        date: today,
        content: opened
          ? tf('wf.openedMsg', { day: today })
          : t('wf.notOpened'),
        category: 'opening',
        icon: Calendar,
        relatedIds: [2],
        status: opened ? 'completed' : 'pending',
        energy: opened ? 100 : 10,
      },
      {
        id: 2,
        title: t('wf.sales'),
        date: today,
        content: sales.length > 0
          ? tf('wf.salesN', { n: sales.length })
          : t('wf.noSales'),
        category: 'sales',
        icon: TrendingUp,
        relatedIds: [1, 3],
        status: stageStatus(sales.length > 0),
        energy: Math.min(100, sales.length * 15 + (sales.length > 0 ? 30 : 0)),
      },
      {
        id: 3,
        title: t('wf.purchases'),
        date: today,
        content: purchases.length > 0
          ? tf('wf.purchN', { n: purchases.length })
          : t('wf.noPurch'),
        category: 'purchases',
        icon: ShoppingBag,
        relatedIds: [2, 4],
        status: stageStatus(purchases.length > 0),
        energy: Math.min(100, purchases.length * 15 + (purchases.length > 0 ? 30 : 0)),
      },
      {
        id: 4,
        title: t('wf.expenses'),
        date: today,
        content: expenses.length > 0
          ? tf('wf.expN', { n: expenses.length })
          : t('wf.noExp'),
        category: 'expenses',
        icon: Receipt,
        relatedIds: [3, 5],
        status: stageStatus(expenses.length > 0),
        energy: Math.min(100, expenses.length * 15 + (expenses.length > 0 ? 30 : 0)),
      },
      {
        id: 5,
        title: t('wf.closed'),
        date: today,
        content: closed
          ? t('wf.closedMsg')
          : t('wf.notClosed'),
        category: 'closing',
        icon: Lock,
        relatedIds: [4],
        status: closed ? 'completed' : (dayEntries.length > 0 ? 'in-progress' : 'pending'),
        energy: closed ? 100 : (dayEntries.length > 0 ? 40 : 5),
      },
    ];
  }, [entries, dayOpenings, reconciliations, today, t, tf]);

  if (loading) return <SkeletonPanel />;

  return (
    <section className="view active">
      <div className="topbar">
        <div>
          <div className="page-title">{t('nav.dayWorkflow')}</div>
          <div className="page-subtitle">{today}</div>
        </div>
      </div>
      <div className="panel">
        <div style={{ color: 'var(--cream-faint)', fontSize: 12.5, marginBottom: 10, textAlign: 'center' }}>
          <Typewriter
            text={t('wf.hint')}
            speed={20}
            loop={false}
            showCursor={false}
          />
        </div>
        <RadialOrbitalTimeline timelineData={timelineData} />
      </div>
    </section>
  );
}
