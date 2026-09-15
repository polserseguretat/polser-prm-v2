import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { adminGetStats, type AdminStats } from '../../lib/adminApi';
import { AdminCard, StatCard, Loading, ErrorBox, Badge } from '../../components/admin/ui';
import { fmtEuro, REFERRAL_STATUS, REFERRAL_STATUS_ORDER, PROFILE_LABEL } from '../../lib/adminFormat';

const CHART_COLORS = ['#042149', '#FF6B00', '#1F9D74', '#C9A227', '#8A94A6', '#B23A48'];

export default function AdminDashboard() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    adminGetStats()
      .then((res) => setStats(res.data))
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <Loading />;
  if (error) return <ErrorBox message={error} onRetry={load} />;
  if (!stats) return null;

  const funnel = REFERRAL_STATUS_ORDER.map((s) => ({
    status: REFERRAL_STATUS[s] ?? s,
    count: stats.referrals.byStatus[s] || 0,
  }));

  const profiles = Object.entries(stats.partners.byProfile).map(([k, v]) => ({
    name: PROFILE_LABEL[k] ?? k,
    value: v,
  }));

  const alerts = [
    { label: 'Events Odoo amb error', value: stats.alerts.outboxErrors, to: '/admin/outbox', tone: stats.alerts.outboxErrors > 0 ? 'red' : 'green' },
    { label: 'Retirades pendents', value: stats.alerts.pendingPayouts, to: '/admin/payouts', tone: stats.alerts.pendingPayouts > 0 ? 'amber' : 'green' },
    { label: 'Contractes per signar', value: stats.alerts.contractsPendingSignature, to: '/admin/partners', tone: 'blue' },
    { label: 'Invitacions caducades', value: stats.alerts.expiredInvitations, to: '/admin/partners', tone: stats.alerts.expiredInvitations > 0 ? 'amber' : 'green' },
  ] as const;

  return (
    <div className="admin-page">
      <div className="admin-page-head">
        <div>
          <h1 className="admin-page-title">Resum general</h1>
          <p className="admin-page-sub">
            Actualitzat el {new Date(stats.generatedAt).toLocaleString('ca-ES')}
          </p>
        </div>
        <button type="button" className="admin-btn" onClick={load}>
          Actualitza
        </button>
      </div>

      <div className="admin-kpis">
        <StatCard label="Partners totals" value={stats.partners.total} hint={`${stats.partners.active} actius · ${stats.partners.pending} pendents`} />
        <StatCard label="Referits totals" value={stats.referrals.total} hint={`${stats.referrals.installed} instal·lats · ${stats.referrals.lost} perduts`} />
        <StatCard label="Taxa de conversió" value={`${stats.referrals.conversionRate}%`} hint="Instal·lats / totals" />
        <StatCard label="Comissions acumulades" value={fmtEuro(stats.wallet.total)} hint="Cartera meritada" />
        <StatCard label="Retirades pendents" value={stats.payouts.pending} hint={`${fmtEuro(stats.payouts.amount)} acumulat`} />
        <StatCard label="Outbox pendent" value={stats.outbox.byStatus['pending'] || 0} hint={`${stats.outbox.byStatus['error'] || 0} errors`} />
      </div>

      <div className="admin-alerts">
        {alerts.map((a) => (
          <Link key={a.label} to={a.to} className={`admin-alert admin-alert-${a.tone}`}>
            <span className="admin-alert-value">{a.value}</span>
            <span className="admin-alert-label">{a.label}</span>
          </Link>
        ))}
      </div>

      <div className="admin-grid-2">
        <AdminCard title="Evolució (últims 12 mesos)">
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={stats.series} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="referrals" name="Referits" stroke="#042149" strokeWidth={2} />
              <Line type="monotone" dataKey="partners" name="Partners" stroke="#FF6B00" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        </AdminCard>

        <AdminCard title="Comissions per període (€)">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={stats.series} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="month" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v: number) => fmtEuro(v)} />
              <Bar dataKey="commissions" name="Comissions" fill="#1F9D74" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </AdminCard>

        <AdminCard title="Embudo de referits">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={funnel} layout="vertical" margin={{ top: 8, right: 12, left: 24, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="status" width={80} tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="count" name="Referits" fill="#042149" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </AdminCard>

        <AdminCard title="Partners per perfil">
          {profiles.length === 0 ? (
            <p className="admin-empty">Sense partners.</p>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={profiles} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90} paddingAngle={2}>
                  {profiles.map((_, i) => (
                    <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          )}
        </AdminCard>
      </div>

      <AdminCard title="Referits per estat">
        <div className="admin-chip-row">
          {REFERRAL_STATUS_ORDER.map((s) => (
            <span key={s} className="admin-chip">
              <Badge tone={s === 'perdido' ? 'red' : s === 'instalado' ? 'green' : 'blue'}>
                {REFERRAL_STATUS[s] ?? s}
              </Badge>
              <strong>{stats.referrals.byStatus[s] || 0}</strong>
            </span>
          ))}
        </div>
      </AdminCard>
    </div>
  );
}
