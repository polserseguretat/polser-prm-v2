import { NavLink, Link, Outlet } from 'react-router-dom';
import { HomeIcon, ListIcon, WalletIcon, BellIcon, UserIcon } from './Icons';

const tabs = [
  { to: '/', label: 'Inici', end: true, Icon: HomeIcon },
  { to: '/referrals', label: 'Referits', end: false, Icon: ListIcon },
  { to: '/wallet', label: 'Cartera', end: false, Icon: WalletIcon },
];

export default function Layout() {
  return (
    <div className="app-shell">
      {/* Capçalera (mòbil i escriptori) */}
      <header className="topnav">
        <Link className="brand" to="/" aria-label="Inici">
          <span className="brand-logo" aria-hidden="true">
            P
          </span>
          <span className="brand-text">
            <strong>POLSER SEGURETAT</strong>
            <span>Portal de Partners</span>
          </span>
        </Link>

        <nav className="topnav-links" aria-label="Navegació principal">
          {tabs.map((tab) => (
            <NavLink
              key={tab.to}
              to={tab.to}
              end={tab.end}
              className={({ isActive }) => (isActive ? 'topnav-link active' : 'topnav-link')}
            >
              {tab.label}
            </NavLink>
          ))}
        </nav>

        <div className="topnav-actions">
          <NavLink
            to="/notifications"
            className="icon-btn"
            aria-label="Notificacions"
            title="Notificacions"
          >
            <BellIcon />
          </NavLink>
          <NavLink to="/profile" className="icon-btn" aria-label="El meu perfil" title="El meu perfil">
            <UserIcon />
          </NavLink>
        </div>
      </header>

      <main className="page">
        <Outlet />
      </main>

      {/* Barra de navegació inferior fixa (mòbil) */}
      <nav className="bottomnav" aria-label="Navegació principal">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.end}
            className={({ isActive }) => (isActive ? 'bottomnav-item active' : 'bottomnav-item')}
          >
            <tab.Icon size={22} />
            <span>{tab.label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}