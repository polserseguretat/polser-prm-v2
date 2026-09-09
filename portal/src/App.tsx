import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import RequireAuth from './components/RequireAuth';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Referrals from './pages/Referrals';
import ReferralDetail from './pages/ReferralDetail';
import Wallet from './pages/Wallet';
import Materials from './pages/Materials';
import Notifications from './pages/Notifications';
import Profile from './pages/Profile';
import Onboarding from './pages/Onboarding';

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
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
  );
}