import AppLoader from './components/AppLoader.jsx';
import { CallProvider } from './context/CallContext.jsx';
import CallModal from './components/CallModal.jsx';
import IncomingCallBanner from './components/IncomingCallBanner.jsx';
import IdleScreensaver from './components/IdleScreensaver.jsx';
import { registerPushNotifications } from './lib/push.js';
import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.jsx';
import { ThemeProvider } from './context/ThemeContext.jsx';
import { LanguageProvider } from './context/LanguageContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import Login from './pages/Login.jsx';
import Layout from './components/Layout.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Entry from './pages/Entry.jsx';

// Hybrid strategy: these load lazily (keeping the true first-paint bundle
// small), but get silently PREFETCHED in the background the moment the
// person logs in (see PrefetchRoutes below) — so by the time they actually
// click to one of these pages, the browser already has it cached and
// navigation feels instant, same as if it had been bundled eagerly.
const importHistory = () => import('./pages/History.jsx');
const importActivityLog = () => import('./pages/ActivityLog.jsx');
const importAnalytics = () => import('./pages/Analytics.jsx');
const importReports = () => import('./pages/Reports.jsx');
const importContacts = () => import('./pages/Contacts.jsx');
const importProfitCalc = () => import('./pages/ProfitCalc.jsx');
const importSettings = () => import('./pages/Settings.jsx');
const importUsers = () => import('./pages/Users.jsx');
const importExternalSync = () => import('./pages/ExternalSync.jsx');
const importDayHistory = () => import('./pages/DayHistory.jsx');
const importCashDeposit = () => import('./pages/CashDeposit.jsx');
const importShopLoans = () => import('./pages/ShopLoans.jsx');

const History = lazy(importHistory);
const ActivityLog = lazy(importActivityLog);
const Analytics = lazy(importAnalytics);
const Reports = lazy(importReports);
const Contacts = lazy(importContacts);
const ProfitCalc = lazy(importProfitCalc);
const Settings = lazy(importSettings);
const Users = lazy(importUsers);
const ExternalSync = lazy(importExternalSync);
const DayHistory = lazy(importDayHistory);
const CashDeposit = lazy(importCashDeposit);
const ShopLoans = lazy(importShopLoans);

const ALL_LAZY_IMPORTS = [
  importHistory, importActivityLog, importAnalytics, importReports,
  importContacts, importProfitCalc, importSettings, importUsers,
  importExternalSync, importDayHistory, importCashDeposit, importShopLoans,
];

function PrefetchRoutes() {
  const { user } = useAuth();
  useEffect(() => {
    if (!user) return;
    // Idle-time background prefetch — runs after the browser has handled
    // anything more urgent, so it never competes with what the person is
    // actively waiting on (the Dashboard render, its API calls, etc.).
    const schedule = window.requestIdleCallback || (fn => setTimeout(fn, 300));
    const cancel = window.cancelIdleCallback || clearTimeout;
    const handle = schedule(() => {
      ALL_LAZY_IMPORTS.forEach(importFn => importFn().catch(() => {}));
    });
    return () => cancel(handle);
  }, [user]);
  return null;
}

// Registers for web push right after login (once per user, not every render).
function PushRegistrar() {
  const { user } = useAuth();
  useEffect(() => {
    if (user) registerPushNotifications();
  }, [user?.id]);
  return null;
}

function RouteLoading() {
  return <AppLoader />;
}

function Protected({ children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

// Nav links were already hidden per-role, but the routes themselves had no
// actual guard — typing /settings or /users directly in the address bar
// worked for anyone logged in, regardless of role. This closes that gap.
// Previously checked a hardcoded role array; now checks the same dynamic
// permission key the sidebar and backend both use, so an admin flipping a
// permission in Settings actually controls page access everywhere at once.
function RequirePermission({ permKey, children }) {
  const { can } = useAuth();
  if (!can(permKey)) return <Navigate to="/" replace />;
  return children;
}

// Dashboard sits at "/" itself, so RequirePermission's usual "redirect to /"
// fallback would infinite-loop for someone who lacks page.dashboard.view —
// send them to Entry instead, which every logged-in person can reach.
function DashboardGuard({ children }) {
  const { can } = useAuth();
  if (!can('page.dashboard.view')) return <Navigate to="/entry" replace />;
  return children;
}

function AppRoutes() {
  const { user } = useAuth();
  return (
    <>
      <PrefetchRoutes />
      <PushRegistrar />
      <Suspense fallback={<RouteLoading />}>
        <Routes>
          <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
          <Route
            path="/"
            element={
              <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route index element={<DashboardGuard><Dashboard /></DashboardGuard>} />
        <Route path="entry" element={<Entry />} />
        <Route path="entry/:id" element={<Entry />} />
        <Route path="history" element={<RequirePermission permKey="page.history.view"><History /></RequirePermission>} />
        <Route path="activity" element={<RequirePermission permKey="page.activity.view"><ActivityLog /></RequirePermission>} />
        <Route path="analytics" element={<RequirePermission permKey="page.analytics.view"><Analytics /></RequirePermission>} />
        <Route path="reports" element={<RequirePermission permKey="page.reports.view"><Reports /></RequirePermission>} />
        <Route path="contacts" element={<RequirePermission permKey="page.contacts.view"><Contacts /></RequirePermission>} />
        <Route path="profit" element={<RequirePermission permKey="page.profitcalc.view"><ProfitCalc /></RequirePermission>} />
        <Route path="settings" element={<RequirePermission permKey="page.settings.view"><Settings /></RequirePermission>} />
        <Route path="users" element={<RequirePermission permKey="page.users.view"><Users /></RequirePermission>} />
        <Route path="external-sync" element={<RequirePermission permKey="page.external_sync.view"><ExternalSync /></RequirePermission>} />
        <Route path="day-history" element={<RequirePermission permKey="page.dayhistory.view"><DayHistory /></RequirePermission>} />
        <Route path="cash-deposit" element={<RequirePermission permKey="page.cashdeposit.view"><CashDeposit /></RequirePermission>} />
        <Route path="shop-loans" element={<RequirePermission permKey="page.loans.view"><ShopLoans /></RequirePermission>} />
      </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}

export default function App() {
  return (
    <LanguageProvider>
      <ToastProvider>
        <ThemeProvider>
          <AuthProvider>
            <CallProvider>
              <BrowserRouter>
                <AppRoutes />
              </BrowserRouter>
              <IncomingCallBanner />
              <CallModal />
            </CallProvider>
          </AuthProvider>
        </ThemeProvider>
      </ToastProvider>
      <IdleScreensaver />
    </LanguageProvider>
  );
}
