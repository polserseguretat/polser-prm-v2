import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import RequireAuth from './components/RequireAuth';
import RequireSuperuser from './components/admin/RequireSuperuser';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Referrals from './pages/Referrals';
import ReferralDetail from './pages/ReferralDetail';
import Wallet from './pages/Wallet';
import Materials from './pages/Materials';
import Notifications from './pages/Notifications';
import Profile from './pages/Profile';
import Onboarding from './pages/Onboarding';
import Register from './pages/Register';

// El panell d'administració es carrega en un chunk a part perquè el portal
// de partners no inclogui les llibreries del panell (recharts, etc.).
const AdminLogin = lazy(() => import('./pages/admin/AdminLogin'));
const AdminLayout = lazy(() => import('./components/admin/AdminLayout'));
const AdminDashboard = lazy(() => import('./pages/admin/AdminDashboard'));
const AdminPartners = lazy(() => import('./pages/admin/AdminPartners'));
const AdminPartnerDetail = lazy(() => import('./pages/admin/AdminPartnerDetail'));
const AdminUsers = lazy(() => import('./pages/admin/AdminUsers'));
const AdminReferrals = lazy(() => import('./pages/admin/AdminReferrals'));
const AdminNotifications = lazy(() => import('./pages/admin/AdminNotifications'));
const AdminPayouts = lazy(() => import('./pages/admin/AdminPayouts'));
const AdminDocuments = lazy(() => import('./pages/admin/AdminDocuments'));
const AdminOutbox = lazy(() => import('./pages/admin/AdminOutbox'));
const AdminSettings = lazy(() => import('./pages/admin/AdminSettings'));
const AdminAudit = lazy(() => import('./pages/admin/AdminAudit'));

function AdminFallback() {
  return <p className="admin-muted admin-fallback">Carregant…</p>;
}

export default function App() {
  return (
    <Suspense fallback={<AdminFallback />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/registre" element={<Register />} />

        <Route path="/admin/login" element={<AdminLogin />} />
        <Route
          path="/admin"
          element={
            <RequireSuperuser>
              <AdminLayout />
            </RequireSuperuser>
          }
        >
          <Route index element={<AdminDashboard />} />
          <Route path="partners" element={<AdminPartners />} />
          <Route path="partners/:id" element={<AdminPartnerDetail />} />
          <Route path="users" element={<AdminUsers />} />
          <Route path="referrals" element={<AdminReferrals />} />
          <Route path="notifications" element={<AdminNotifications />} />
          <Route path="payouts" element={<AdminPayouts />} />
          <Route path="documents" element={<AdminDocuments />} />
          <Route path="outbox" element={<AdminOutbox />} />
          <Route path="settings" element={<AdminSettings />} />
          <Route path="audit" element={<AdminAudit />} />
        </Route>

        <Route
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route path="/" element={<Dashboard />} />
          <Route path="/referrals" element={<Referrals />} />
          <Route path="/referrals/:id" element={<ReferralDetail />} />
          <Route path="/wallet" element={<Wallet />} />
          <Route path="/materials" element={<Materials />} />
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/profile" element={<Profile />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}
