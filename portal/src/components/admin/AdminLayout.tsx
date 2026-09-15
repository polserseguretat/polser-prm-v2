import { useState } from 'react';
import { NavLink, Outlet, Link, useNavigate } from 'react-router-dom';
import { adminLogout, currentAdminEmail } from '../../lib/adminApi';

const nav = [
  { to: '/admin', label: 'Resum', end: true },
  { to: '/admin/partners', label: 'Partners', end: false },
  { to: '/admin/users', label: 'Usuaris', end: false },
  { to: '/admin/services', label: 'Serveis', end: false },
  { to: '/admin/referrals', label: 'Referits', end: false },
  { to: '/admin/notifications', label: 'Notificacions', end: false },
  { to: '/admin/payouts', label: 'Retirades', end: false },
  { to: '/admin/documents', label: 'Materials', end: false },
  { to: '/admin/outbox', label: 'Odoo / Outbox', end: false },
  { to: '/admin/settings', label: 'Ajustos', end: false },
  { to: '/admin/audit', label: 'Auditoria', end: false },
];

export default function AdminLayout() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const email = currentAdminEmail();

  const logout = () => {
    adminLogout();
    navigate('/admin/login', { replace: true });
  };

  return (
    <div className={`admin-shell${open ? ' nav-open' : ''}`}>
      <aside className="admin-sidebar">
        <div className="admin-brand">
          <span className="brand-logo" aria-hidden="true">P</span>
          <span className="admin-brand-text">
            <strong>POLSER</strong>
            <span>Panell de gestió</span>
          </span>
        </div>
        <nav className="admin-nav" aria-label="Navegació del panell">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => (isActive ? 'admin-nav-link active' : 'admin-nav-link')}
              onClick={() => setOpen(false)}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="admin-sidebar-foot">
          <span className="admin-user" title={email || ''}>{email || 'Superusuari'}</span>
          <button type="button" className="admin-btn admin-btn-ghost" onClick={logout}>
            Tanca la sessió
          </button>
        </div>
      </aside>

      <div className="admin-main">
        <header className="admin-topbar">
          <button type="button" className="admin-menu-btn" aria-label="Obre el menú" onClick={() => setOpen((v) => !v)}>
            ☰
          </button>
          <Link to="/admin" className="admin-topbar-title">Panell de gestió · POLSER SEGURETAT</Link>
          <Link to="/" className="admin-topbar-link">Veure portal</Link>
        </header>
        <main className="admin-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
